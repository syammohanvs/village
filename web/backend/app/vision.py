"""Name the object in a waste crop with a hosted vision model.

**This never decides a bin.**  The classifier's classes are materials (Plastic,
Glass, Metal, Thermocol) and a vision model answers with objects — measured
2026-11-19 it scored 53.7 % exact on the venue probe against the local model's
70.7 % — so the bin stays a local decision and this only answers the question a
visitor asks first: *what do you think this is?*

Why it exists: the local classifier called a plastic cap **Ewaste 0.40**, and
the same crop sent to `llama-3.2-11b-vision` came back **"Plastic circular
container"** (2026-11-19).  Saying the object out loud before the category is
what lets a visitor — and the operator — see a wrong answer instead of being
told one.

**A chain, not one provider.**  The free Workers AI allowance is per account
per day, so the exhibit can carry more than one: `VILLAGE_CF_API_TOKEN`,
`VILLAGE_CF_API_TOKEN_2`, … each with its own account id (resolved from the
token when blank).  When one answers "quota/limit/expired", the next is used —
stickily, so the rest of the session does not keep hitting the exhausted one.
If every Cloudflare account is spent, `VILLAGE_VISION_API_KEY` (DeepSeek on
OpenCode Go) is the last resort: ~7 s instead of ~1 s, but an answer rather
than an "unavailable".

  VILLAGE_VISION_PROVIDER=cloudflare  →  cf token 1, cf token 2, …, opencode
  VILLAGE_VISION_PROVIDER=opencode    →  opencode, then any cf tokens

Nothing here runs unless a key is configured: `status()["ready"]` is False and
`identify()` answers `object: None` in microseconds, so the page behaves exactly
as it did before.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import time
import urllib.request
from typing import Any

# Ask for the object **and its material**, because "plastic cap" is what lets a
# person check the category; "cap" alone does not.
PROMPT = (
    "Name the single object in this photo in two to four words, including what "
    "it is made of when you can see it (for example 'clear plastic bottle'). "
    "If there is no object, answer exactly: nothing"
)

TIMEOUT_S = float(os.getenv("VILLAGE_VISION_TIMEOUT_SECS", "8"))

# The same crop is asked once: the page sends the frame it just classified, and
# a correction or a retry must not pay for the same answer twice.
_CACHE: dict[str, str | None] = {}
_CACHE_ORDER: list[str] = []
_CACHE_MAX = 256


# Which candidate answered last.  Sticky on purpose: once account 1 is spent,
# every later request should start at account 2 instead of re-failing on 1.
_INDEX = [0]


def _cloudflare_candidates() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for suffix in ("", "_2", "_3", "_4", "_5"):
        token = (os.getenv(f"VILLAGE_CF_API_TOKEN{suffix}") or "").strip()
        if not token:
            continue
        out.append({
            "provider": "cloudflare",
            "token": token,
            "account": (os.getenv(f"VILLAGE_CF_ACCOUNT_ID{suffix}") or "").strip(),
        })
    return out


def candidates() -> list[dict[str, str]]:
    """The provider chain, in the order it is tried."""
    cloud = _cloudflare_candidates()
    opencode = (os.getenv("VILLAGE_VISION_API_KEY") or "").strip()
    deepseek = [{"provider": "opencode", "token": opencode, "account": ""}] if opencode else []
    wanted = (os.getenv("VILLAGE_VISION_PROVIDER") or "cloudflare").strip().lower()
    # The configured provider first; the other one is the fallback either way.
    return cloud + deepseek if wanted == "cloudflare" else deepseek + cloud


def provider() -> str | None:
    chain = candidates()
    if not chain:
        return None
    return chain[min(_INDEX[0], len(chain) - 1)]["provider"]


def model_name(which: str | None = None) -> str:
    which = which or provider()
    if which == "cloudflare":
        return os.getenv("VILLAGE_CF_VISION_MODEL") or "@cf/meta/llama-3.2-11b-vision-instruct"
    return os.getenv("VILLAGE_VISION_MODEL") or "deepseek-v4.1-flash"


def status() -> dict[str, Any]:
    chain = candidates()
    which = provider()
    return {
        "provider": which,
        "model": model_name(which) if which else None,
        "ready": bool(chain),
        # How many accounts/providers can answer before the page must say
        # "identification unavailable".
        "chain": len(chain),
        "timeout_s": TIMEOUT_S,
    }


def identify(image: str) -> dict[str, Any]:
    """`{object, provider, model, ms, cached, reason}` for one crop.

    `object` is None when no provider is configured, the model answered nothing,
    or the call failed — the page then says nothing about the object and shows
    only the classifier, which is the behaviour before this feature existed.
    """
    started = time.time()
    which = provider()
    base = {"provider": which, "model": model_name(which) if which else None}
    if not which:
        return {**base, "object": None, "ms": 0, "reason": "not configured"}

    key = hashlib.sha256(image.encode("utf-8")).hexdigest()
    if key in _CACHE:
        return {**base, "object": _CACHE[key], "ms": 0, "cached": True}

    jpeg = _decode(image)
    if jpeg is None:
        return {**base, "object": None, "ms": 0, "reason": "the crop could not be read"}

    chain = candidates()
    first_error: Exception | None = None
    start = min(_INDEX[0], len(chain) - 1)
    for offset in range(len(chain)):
        index = (start + offset) % len(chain)
        candidate = chain[index]
        try:
            text = _ask_candidate(candidate, jpeg)
        except Exception as exc:  # noqa: BLE001 - try the next account
            first_error = first_error or exc
            # Move on: this one is spent, expired or broken.  The index is
            # sticky so the next press does not pay for the same failure.
            _INDEX[0] = (index + 1) % len(chain)
            continue
        _INDEX[0] = index
        name = _clean(text)
        _remember(key, name)
        return {
            "provider": candidate["provider"],
            "model": model_name(candidate["provider"]),
            "object": name,
            "ms": int((time.time() - started) * 1000),
        }
    return {**base, "object": None, "ms": int((time.time() - started) * 1000),
            "reason": str(first_error)[:200] if first_error else "no provider answered"}


# --------------------------------------------------------------------- helpers ---

def _remember(key: str, value: str | None) -> None:
    _CACHE[key] = value
    _CACHE_ORDER.append(key)
    while len(_CACHE_ORDER) > _CACHE_MAX:
        _CACHE.pop(_CACHE_ORDER.pop(0), None)


def _clean(text: str) -> str | None:
    """A short noun phrase, or None when the model saw no object."""
    name = " ".join((text or "").split())
    name = name.strip(" \"'`*.")
    if name.lower().endswith("."):
        name = name[:-1].strip()
    lowered = name.lower()
    if not lowered or lowered in {"nothing", "none", "no object", "unknown", "n/a"}:
        return None
    if lowered.startswith(("i can", "i cannot", "i'm sorry", "sorry")):
        return None
    # Some models answer the question instead of naming the object ("the single
    # object in this photo is a clear plastic lid"), and they phrase the lead-in
    # differently every time — "object in this image is", "the item appears to
    # be", "this looks like".  Rather than list them all, take what follows the
    # first copula when the words before it are about the picture, not the thing.
    for marker in (" is ", " appears to be ", " looks like ", " seems to be "):
        if marker in lowered:
            lead = lowered[: lowered.index(marker)]
            if any(word in lead for word in (
                "object", "item", "image", "photo", "picture", "this", "it",
            )):
                name = name[lowered.index(marker) + len(marker):]
                lowered = name.lower()
                break
    for article in ("a ", "an ", "the "):
        if lowered.startswith(article):
            name = name[len(article):]
            break
    return name[:80] or None


def _decode(image: str) -> bytes | None:
    text = (image or "").strip()
    if text.startswith("data:"):
        _, _, text = text.partition(",")
    try:
        return base64.b64decode(text, validate=False)
    except Exception:  # noqa: BLE001
        return None


def _data_url(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()


def _post(url: str, payload: dict, headers: dict, timeout: float) -> dict:
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers, method="POST"
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def _ask(jpeg: bytes, which: str) -> str:
    """Ask one provider with the primary key (kept for tests and callers)."""
    if which == "cloudflare":
        chain = _cloudflare_candidates()
        if not chain:
            return ""
        return _cloudflare(jpeg, chain[0])
    return _opencode(jpeg)


def _ask_candidate(candidate: dict[str, str], jpeg: bytes) -> str:
    if candidate["provider"] == "cloudflare":
        return _cloudflare(jpeg, candidate)
    return _opencode(jpeg)


def _opencode(jpeg: bytes) -> str:
    base = (os.getenv("VILLAGE_VISION_BASE_URL") or "https://opencode.ai/inference/go/v1").rstrip("/")
    key = os.getenv("VILLAGE_VISION_API_KEY", "")
    if not key:
        return ""
    body = _post(
        base + "/chat/completions",
        {
            "model": model_name("opencode"),
            "temperature": 0,
            "max_tokens": 600,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": _data_url(jpeg)}},
                ],
            }],
        },
        {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
            # Cloudflare in front of that endpoint answers a bare python client
            # with `error code: 1010`, and OpenCode Go refuses a request without
            # a session id.  Both measured 2026-11-19.
            "User-Agent": "village-waste-classifier/1.0",
            "x-opencode-session": "village-waste-classifier-session",
        },
        TIMEOUT_S,
    )
    message = body["choices"][0]["message"]
    return (message.get("content") or "").strip()


def _cloudflare(jpeg: bytes, candidate: dict[str, str] | None = None) -> str:
    candidate = candidate or {
        "token": os.getenv("VILLAGE_CF_API_TOKEN", ""),
        "account": os.getenv("VILLAGE_CF_ACCOUNT_ID", "").strip(),
    }
    token = candidate.get("token", "")
    if not token:
        return ""
    account = candidate.get("account", "") or _first_account(token)
    if not account:
        return ""
    model = model_name("cloudflare")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}"
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}

    # Workers AI has two request shapes and the catalogue decides which: a chat
    # `messages` list with an image_url (llama 3.2 vision, llama-4, qwen) or
    # `{image: [bytes], prompt}` (llava, uform).  The other is tried once on a
    # failure so a new model needs no code change.
    chat = any(word in model.lower() for word in ("llama", "qwen", "pixtral", "gemma"))
    last: Exception | None = None
    for wants_chat in (chat, not chat):
        payload = (
            {
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT},
                        {"type": "image_url", "image_url": {"url": _data_url(jpeg)}},
                    ],
                }],
                "max_tokens": 512,
            }
            if wants_chat
            else {"image": list(jpeg), "prompt": PROMPT, "max_tokens": 512}
        )
        try:
            body = _post(url, payload, headers, TIMEOUT_S)
        except Exception as error:  # noqa: BLE001
            last = error
            continue
        if not body.get("success", True):
            last = RuntimeError(json.dumps(body.get("errors", body))[:200])
            continue
        result = body.get("result") or {}
        if isinstance(result, dict):
            for key in ("response", "description", "text", "output"):
                value = result.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
            choices = result.get("choices")
            if isinstance(choices, list) and choices:
                first = choices[0] or {}
                message = first.get("message") or {}
                for value in (message.get("content"), first.get("text")):
                    if isinstance(value, str) and value.strip():
                        return value.strip()
        if isinstance(result, str) and result.strip():
            return result.strip()
        return ""
    if last is not None:
        raise last
    return ""


def _first_account(token: str) -> str:
    """The account id behind a user API token, when `.env` leaves it blank."""
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/accounts",
        headers={"Authorization": "Bearer " + token},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.load(response)
    except Exception:  # noqa: BLE001
        return ""
    rows = body.get("result") or []
    return (rows[0].get("id") or "") if rows else ""
