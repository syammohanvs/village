"""Name the object in a waste crop with a hosted vision model.

**It names the item; the page's rules decide the route.**  `wasteDecision.ts`
reads the name's material word, so this *can* choose a bin ("clear plastic
bottle" → plastic) — it is an input to the answer, not a caption on it.  What
it does not do is pick the bin by itself: the special-care and object rules are
checked first, and a name with no usable material word falls through to the
local classifier's thresholds.

Why the rules and not "whatever it says": measured 2026-11-19 the hosted model
scored 43.9 % exact on 41 probe photos against the local ResNet50's 70.7 % — a
vision model answers with *objects* and the bins are *materials* (it calls the
plastic casing of a remote "plastic").  The name is also the only thing that can
say what the object is, which is what a visitor asks first: the local classifier
called a plastic cap **Ewaste 0.40**, and the same crop came back "Plastic
circular container".  So the name is spoken and routed, and the classifier is
the fallback when no name arrives.

Syntax is deliberately small: no prompt can turn a picture into a bin — the
decision is over words this module returns, and the rules are what make it safe.

**A chain, not one provider.**  Naming has three layers, tried stickily: the
Cloudflare Workers AI free allowance is per account per day, so the exhibit
carries more than one (`VILLAGE_CF_API_TOKEN`, `VILLAGE_CF_API_TOKEN_2`, … each
with its own account id, all answering with
`@cf/meta/llama-3.2-11b-vision-instruct`).  When one answers
"quota/limit/expired", the next is used — stickily, so the rest of the session
does not keep hitting the exhausted one.  If every Cloudflare account is spent,
`VILLAGE_VISION_API_KEY` (DeepSeek `deepseek-v4.1-flash` on OpenCode Go) is the
last resort: ~7 s instead of ~1 s, but an answer rather than "unavailable".

  VILLAGE_VISION_PROVIDER=cloudflare  →  cf token 1, cf token 2, …, opencode
  VILLAGE_VISION_PROVIDER=opencode    →  opencode, then any cf tokens

Nothing here runs unless a key is configured: `status()["ready"]` is False and
`identify()` answers `object: None` in microseconds, so the page behaves exactly
as it did before — and the local classifier decides on its own.
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
    # Measured 2026-11-20 on two real onion photos: the old prompt asked for
    # "including what it is made of", and a vegetable has no material, so the
    # model answered **"nothing"** for a clear photo of onions — which the page
    # correctly showed as "nothing to sort".  Naming food as the food itself
    # fixes it ("onion", "onion pile") while the material hint still names a
    # "Blue plastic bottle" and a "Paper bag", and a blank frame still answers
    # exactly "nothing".
    "Name the object in this photo in one to three words. For food, name the "
    "vegetable or fruit itself (onion, carrot, tomato, banana). Add what it is "
    "made of only when that is clear (for example 'clear plastic bottle'). "
    "If there is no object, answer exactly: nothing"
)

TIMEOUT_S = float(os.getenv("VILLAGE_VISION_TIMEOUT_SECS", "8"))
# The last resort is a reasoning model on a slower lane: measured 8.1 s, 10.2 s
# and 0.9 s (warm) for three calls on 2026-11-19, so the 8 s used for Workers AI
# would cut it off exactly when it is needed.  Two Cloudflare calls run first at
# ~1.6–2.0 s each in the usual case.
TIMEOUT_LAST_S = float(os.getenv("VILLAGE_VISION_TIMEOUT_LAST_SECS", "12"))
# The whole chain, not one call.  The page waits `VISION_WAIT_MS` (15 s) for the
# name before giving the local classifier's answer; this budget must fit inside
# it, or the last provider is cut off by the deadline it was added for.
# Measured worst realistic path: two fast quota failures (~1 s) + 10.2 s = 11 s.
TOTAL_S = float(os.getenv("VILLAGE_VISION_TOTAL_SECS", "14"))

# The same crop is asked once: the page sends the frame it just classified, and
# a correction or a retry must not pay for the same answer twice.  The cached
# value is the answer itself (`object` + `empty`), because "nothing visible" is a
# different fact from "no answer" and must survive a cache hit.
_CACHE: dict[str, dict[str, Any]] = {}
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
        # The redundancy in full, in the order it is tried: the Cloudflare
        # accounts (each one the same model) and then the OpenCode Go /
        # DeepSeek last resort.  The page shows this in Model details, so a
        # presenter can answer "what is naming the item, and what happens when
        # that stops answering?" without reading the source.
        "attempts": [
            {"provider": item["provider"], "model": model_name(item["provider"])}
            for item in chain
        ],
        "timeout_s": TIMEOUT_S,
        # The whole chain's budget, and the slower last resort's own timeout —
        # the page waits `VISION_WAIT_MS` (15 s) for a name, so these have to fit
        # inside it or the fallback is cut off by the deadline it exists for.
        "total_s": TOTAL_S,
        "last_timeout_s": TIMEOUT_LAST_S,
    }


def identify(image: str) -> dict[str, Any]:
    """`{object, provider, model, ms, cached, reason}` for one crop.

    `object` is None when no provider is configured, the model answered nothing,
    or the call failed — the page then says nothing about the object and shows
    only the classifier, which is the behaviour before this feature existed.
    """
    started = time.time()
    # One absolute deadline for the whole operation: account discovery, the two
    # Cloudflare request shapes and the last resort all spend from it.  `time.time`
    # only measures; the deadline is monotonic so a clock change cannot extend it.
    deadline = time.monotonic() + TOTAL_S
    which = provider()
    base = {"provider": which, "model": model_name(which) if which else None}
    if not which:
        return {**base, "object": None, "ms": 0, "reason": "not configured"}

    key = hashlib.sha256(image.encode("utf-8")).hexdigest()
    if key in _CACHE:
        return {**base, **_CACHE[key], "ms": 0, "cached": True}

    jpeg = _decode(image)
    if jpeg is None:
        return {**base, "object": None, "ms": 0, "reason": "the crop could not be read"}

    chain = candidates()
    first_error: Exception | None = None
    start = min(_INDEX[0], len(chain) - 1)
    for offset in range(len(chain)):
        index = (start + offset) % len(chain)
        candidate = chain[index]
        # An attempt that cannot finish before the deadline is not started:
        # answering with the local classifier is better than a request cut off
        # mid-flight.  The functions below re-read the same deadline themselves,
        # so a retry inside one provider cannot outlive it either.
        remaining = deadline - time.monotonic()
        if remaining < 1.5:
            first_error = first_error or RuntimeError(
                f"the naming chain ran out of time after {TOTAL_S:.0f} s"
            )
            break
        try:
            text = _ask_candidate(candidate, jpeg, deadline)
        except Exception as exc:  # noqa: BLE001 - try the next account
            first_error = first_error or exc
            # Move on: this one is spent, expired or broken.  The index is
            # sticky so the next press does not pay for the same failure.
            _INDEX[0] = (index + 1) % len(chain)
            continue
        _INDEX[0] = index
        # An empty scene is decided from the model's own words, NOT from what
        # `_clean()` happened to return: `_clean("empty")` is the string "empty",
        # so testing it afterwards missed every phrase except the literal
        # "nothing" and the classifier could then choose a bin for an empty base.
        empty = _says_nothing(text)
        name = None if empty else _clean(text)
        answer = {
            "provider": candidate["provider"],
            "model": model_name(candidate["provider"]),
            "object": name,
            "ms": int((time.time() - started) * 1000),
        }
        # "Nothing visible" is an ANSWER, not a failure.  The page must be able
        # to tell it apart from "the service did not answer", because the first
        # is "nothing to sort" and the second falls back to the classifier.
        if empty:
            answer["empty"] = True
            answer["reason"] = "the model saw no object"
        # The provider that answered is kept with the answer: a cached reply must
        # not be attributed to whichever account happens to be current later.
        _remember(key, {
            "object": answer["object"],
            "empty": bool(answer.get("empty")),
            "provider": answer["provider"],
            "model": answer["model"],
        })
        return answer
    return {**base, "object": None, "ms": int((time.time() - started) * 1000),
            "reason": str(first_error)[:200] if first_error else "no provider answered"}


# --------------------------------------------------------------------- helpers ---

def _remember(key: str, value: dict[str, Any]) -> None:
    _CACHE[key] = value
    _CACHE_ORDER.append(key)
    while len(_CACHE_ORDER) > _CACHE_MAX:
        _CACHE.pop(_CACHE_ORDER.pop(0), None)


_NOTHING_WORDS = {
    "nothing", "none", "no object", "no objects", "no item", "no items", "empty",
    "n/a", "nothing visible", "no object visible",
}


def _says_nothing(text: str) -> bool:
    """True when the model literally answered "nothing".

    Deliberately narrow: `unknown` and a refusal ("I cannot tell") are *not* an
    empty scene — they are an unusable answer, and the page falls back to the
    classifier for those.
    """
    name = " ".join((text or "").split()).strip(" \"'`*.").rstrip(".").strip().lower()
    return name in _NOTHING_WORDS


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


def _attempt_timeout(provider: str) -> float:
    return TIMEOUT_LAST_S if provider == "opencode" else TIMEOUT_S


def _remaining(deadline: float) -> float:
    """Seconds left before the chain's absolute deadline (never negative)."""
    return max(0.0, deadline - time.monotonic())


def _ask_candidate(candidate: dict[str, str], jpeg: bytes, deadline: float) -> str:
    """One provider, bounded by the *chain's* deadline, not just by its own.

    Every request below recomputes `_remaining(deadline)` immediately before it
    goes out, so an internal retry (Cloudflare's two request shapes, account
    discovery) cannot add a second full timeout on top of the first.
    """
    if candidate["provider"] == "cloudflare":
        return _cloudflare(jpeg, candidate, deadline)
    return _opencode(jpeg, deadline)


def _opencode(jpeg: bytes, deadline: float) -> str:
    base = (os.getenv("VILLAGE_VISION_BASE_URL") or "https://opencode.ai/inference/go/v1").rstrip("/")
    key = os.getenv("VILLAGE_VISION_API_KEY", "")
    if not key:
        return ""
    timeout = min(TIMEOUT_LAST_S, _remaining(deadline))
    if timeout <= 0:
        raise TimeoutError("no time left for the last-resort namer")
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
        timeout,
    )
    message = body["choices"][0]["message"]
    return (message.get("content") or "").strip()


def _cloudflare(jpeg: bytes, candidate: dict[str, str] | None = None,
                deadline: float | None = None) -> str:
    candidate = candidate or {
        "token": os.getenv("VILLAGE_CF_API_TOKEN", ""),
        "account": os.getenv("VILLAGE_CF_ACCOUNT_ID", "").strip(),
    }
    deadline = deadline if deadline is not None else time.monotonic() + TIMEOUT_S
    token = candidate.get("token", "")
    if not token:
        return ""
    account = candidate.get("account", "") or _first_account(token, deadline)
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
                # A name is two to four words.  A small cap bounds a chatty
                # answer, and temperature 0 makes the same crop answer the same
                # way twice: measured 2026-11-20, the same onion photo came back
                # "nothing" once and "Onions." the next time at the default
                # temperature, which reads to a visitor as "it did not
                # recognise it".
                "max_tokens": 60,
                "temperature": 0,
            }
            if wants_chat
            else {"image": list(jpeg), "prompt": PROMPT, "max_tokens": 60, "temperature": 0}
        )
        # Each shape gets only what is left of the chain budget, so trying the
        # other request format cannot double the time this provider may take.
        timeout = min(TIMEOUT_S, _remaining(deadline))
        if timeout <= 0:
            last = last or TimeoutError("no time left for the Cloudflare request")
            break
        try:
            body = _post(url, payload, headers, timeout)
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


def _first_account(token: str, deadline: float | None = None) -> str:
    """The account id behind a user API token, when `.env` leaves it blank.

    Bounded by the chain's deadline: this lookup used to have its own 20 s
    timeout, which alone outlived the 14 s budget the page waits for.
    """
    timeout = min(20.0, _remaining(deadline)) if deadline is not None else 20.0
    if timeout <= 0:
        return ""
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/accounts",
        headers={"Authorization": "Bearer " + token},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.load(response)
    except Exception:  # noqa: BLE001
        return ""
    rows = body.get("result") or []
    return (rows[0].get("id") or "") if rows else ""
