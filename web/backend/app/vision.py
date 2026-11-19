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

Two providers, chosen by `VILLAGE_VISION_PROVIDER`:

  cloudflare  Workers AI, ~1 s on this account, free tier
  opencode    DeepSeek on OpenCode Go, ~7 s

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


def provider() -> str | None:
    wanted = (os.getenv("VILLAGE_VISION_PROVIDER") or "opencode").strip().lower()
    if wanted == "cloudflare":
        if os.getenv("VILLAGE_CF_API_TOKEN"):
            return "cloudflare"
        return "opencode" if os.getenv("VILLAGE_VISION_API_KEY") else None
    if os.getenv("VILLAGE_VISION_API_KEY"):
        return "opencode"
    return "cloudflare" if os.getenv("VILLAGE_CF_API_TOKEN") else None


def model_name(which: str | None = None) -> str:
    which = which or provider()
    if which == "cloudflare":
        return os.getenv("VILLAGE_CF_VISION_MODEL") or "@cf/meta/llama-3.2-11b-vision-instruct"
    return os.getenv("VILLAGE_VISION_MODEL") or "deepseek-v4.1-flash"


def status() -> dict[str, Any]:
    which = provider()
    return {
        "provider": which,
        "model": model_name(which) if which else None,
        "ready": which is not None,
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

    try:
        text = _ask(jpeg, which)
    except Exception as exc:  # noqa: BLE001 - a namer must never fail a press
        return {**base, "object": None, "ms": int((time.time() - started) * 1000),
                "reason": str(exc)[:200]}

    name = _clean(text)
    _remember(key, name)
    return {**base, "object": name, "ms": int((time.time() - started) * 1000)}


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
    if which == "cloudflare":
        return _cloudflare(jpeg)
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


def _cloudflare(jpeg: bytes) -> str:
    token = os.getenv("VILLAGE_CF_API_TOKEN", "")
    if not token:
        return ""
    account = os.getenv("VILLAGE_CF_ACCOUNT_ID", "").strip() or _first_account(token)
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
