"""One place that asks a hosted vision model to name the thing in a photo.

Two providers, chosen by `VILLAGE_VISION_PROVIDER` in `.env`:

  opencode    DeepSeek on OpenCode Go — an OpenAI-compatible chat endpoint.
              Measured 2026-11-19: good at naming objects (a remote, a water
              pump, a glue bottle), poor at this app's material classes.
  cloudflare  Cloudflare Workers AI (free tier).  Needs `VILLAGE_CF_ACCOUNT_ID`
              and `VILLAGE_CF_API_TOKEN` (permission "Workers AI: Read").

**This module names objects.  It never decides a bin.**  This app's classes are
materials (Glass, Metal, Thermocol, Plastic) and a vision model answers with
objects ("a glass jar"), which measured 43.9 % exact against the local
classifier's 74.7 % on the venue probe.  The bin stays a local decision; the
name is what a visitor is told first.

Used by `scripts/waste/label_captures.py`, `scripts/waste/vision_bench.py` and
the backend's `app/vision.py` (same rules, same env names).
"""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

# Which candidate answered last; sticky, so a dead or spent account is not paid
# for on every photo.
_INDEX = [0]


def settings() -> dict[str, str]:
    """`VILLAGE_*` from `.env`, then `.env.secrets` on top (the app's own order)."""
    values: dict[str, str] = {}
    for name in (".env", ".env.secrets"):
        path = ROOT / name
        if not path.is_file():
            continue
        for match in re.finditer(r"^([A-Z0-9_]+)=(.*)$", path.read_text(), re.M):
            values[match.group(1)] = match.group(2).strip().strip("'\"")
    return values


def candidates(conf: dict[str, str] | None = None) -> list[dict[str, str]]:
    """The chain the labeller tries, in order: Cloudflare accounts, then DeepSeek."""
    conf = conf or settings()
    cloud = []
    for suffix in ("", "_2", "_3", "_4", "_5"):
        token = (conf.get(f"VILLAGE_CF_API_TOKEN{suffix}") or "").strip()
        if not token:
            continue
        cloud.append({
            "provider": "cloudflare",
            "token": token,
            "account": (conf.get(f"VILLAGE_CF_ACCOUNT_ID{suffix}") or "").strip(),
        })
    key = (conf.get("VILLAGE_VISION_API_KEY") or "").strip()
    deepseek = [{"provider": "opencode", "token": key, "account": ""}] if key else []
    wanted = (conf.get("VILLAGE_VISION_PROVIDER") or "cloudflare").strip().lower()
    return cloud + deepseek if wanted == "cloudflare" else deepseek + cloud


def provider(conf: dict[str, str] | None = None) -> str | None:
    """Which provider is usable, or None when none is configured."""
    conf = conf or settings()
    wanted = (conf.get("VILLAGE_VISION_PROVIDER") or "opencode").strip().lower()
    # A token alone is enough: the account id is looked up from it when it is
    # blank (a user API token can list its own accounts).
    has_cf = bool(conf.get("VILLAGE_CF_API_TOKEN"))
    has_opencode = bool(conf.get("VILLAGE_VISION_API_KEY"))
    if wanted == "cloudflare":
        return "cloudflare" if has_cf else ("opencode" if has_opencode else None)
    return "opencode" if has_opencode else ("cloudflare" if has_cf else None)


def model_name(conf: dict[str, str] | None = None, which: str | None = None) -> str:
    conf = conf or settings()
    which = which or provider(conf)
    if which == "cloudflare":
        return conf.get("VILLAGE_CF_VISION_MODEL") or "@cf/meta/llama-3.2-11b-vision-instruct"
    return conf.get("VILLAGE_VISION_MODEL") or "deepseek-v4.1-flash"


def ask_object(
    jpeg: bytes,
    prompt: str,
    *,
    which: str | None = None,
    model: str | None = None,
    conf: dict[str, str] | None = None,
    timeout: int = 120,
) -> str:
    """The model's answer as text, or '' when it could not be asked.

    `prompt` is the whole instruction.  Asking for a bare object name works
    better than asking for a class: the latter is the question this app can
    answer locally and better.
    """
    conf = conf or settings()
    chain = candidates(conf)
    if which == "cloudflare":
        chain = [c for c in chain if c["provider"] == "cloudflare"] or chain
    elif which == "opencode":
        chain = [c for c in chain if c["provider"] == "opencode"] or chain
    if not chain:
        return ""
    model = model or model_name(conf, chain[0]["provider"])
    last: Exception | None = None
    start = min(_INDEX[0], len(chain) - 1)
    for offset in range(len(chain)):
        index = (start + offset) % len(chain)
        candidate = chain[index]
        try:
            if candidate["provider"] == "cloudflare":
                text = _cloudflare(jpeg, prompt, model, conf, timeout, candidate)
            else:
                text = _opencode(jpeg, prompt, model, conf, timeout)
            if text:
                _INDEX[0] = index
                return text
            last = RuntimeError("no answer")
        except Exception as error:  # noqa: BLE001 - try the next account
            last = error
            _INDEX[0] = (index + 1) % len(chain)
            continue
    if last is not None:
        print(f"vision: {last}")
    return ""


def _first_account(token: str) -> str:
    """The account id behind a user API token, when `.env` leaves it blank."""
    import urllib.request  # noqa: PLC0415

    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/accounts",
        headers={"Authorization": "Bearer " + token},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.load(response)
    except Exception:  # noqa: BLE001 - the caller reports the failure
        return ""
    rows = body.get("result") or []
    return (rows[0].get("id") or "") if rows else ""


def _data_url(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()


def _post(url: str, payload: dict, headers: dict, timeout: int) -> dict:
    import urllib.request  # noqa: PLC0415 - keep the module import-light

    request = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers, method="POST"
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def _opencode(jpeg: bytes, prompt: str, model: str, conf: dict[str, str], timeout: int) -> str:
    base = (conf.get("VILLAGE_VISION_BASE_URL") or "https://opencode.ai/inference/go/v1").rstrip("/")
    key = conf.get("VILLAGE_VISION_API_KEY", "")
    if not key:
        return ""
    body = _post(
        base + "/chat/completions",
        {
            "model": model,
            "temperature": 0,
            "max_tokens": 600,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": _data_url(jpeg)}},
                ],
            }],
        },
        {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
            # Cloudflare in front of this endpoint answers a bare python client
            # with `error code: 1010`, and OpenCode Go refuses a request with no
            # session id (`MissingSessionID`).  Both measured 2026-11-19.
            "User-Agent": "village-waste-classifier/1.0",
            "x-opencode-session": "village-waste-classifier-session",
        },
        timeout,
    )
    message = body["choices"][0]["message"]
    return (message.get("content") or "").strip()


def _cloudflare(
    jpeg: bytes,
    prompt: str,
    model: str,
    conf: dict[str, str],
    timeout: int,
    candidate: dict[str, str] | None = None,
) -> str:
    candidate = candidate or {
        "token": conf.get("VILLAGE_CF_API_TOKEN", ""),
        "account": conf.get("VILLAGE_CF_ACCOUNT_ID", ""),
    }
    token = candidate.get("token", "")
    if not token:
        return ""
    account = candidate.get("account", "") or _first_account(token)
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}"
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}

    # Two request shapes exist in the Workers AI catalogue: `{image: [bytes],
    # prompt}` (llava, uform) and a chat `messages` list with an image_url
    # (llama 3.2 vision, qwen2.5-vl).  Chosen by model name, with the other
    # shape tried once on a 4xx so a new model needs no code change.
    chat = any(word in model.lower() for word in ("llama", "qwen", "pixtral", "gemma"))
    shapes = [chat, not chat]
    last: Exception | None = None
    for wants_chat in shapes:
        payload = (
            {
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": _data_url(jpeg)}},
                    ],
                }],
                "max_tokens": 512,
            }
            if wants_chat
            else {"image": list(jpeg), "prompt": prompt, "max_tokens": 512}
        )
        try:
            body = _post(url, payload, headers, timeout)
        except Exception as error:  # noqa: BLE001 - the second shape may be the right one
            last = error
            continue
        if not body.get("success", True):
            last = RuntimeError(json.dumps(body.get("errors", body))[:300])
            continue
        result = body.get("result") or {}
        if isinstance(result, dict):
            # Workers AI returns one of three shapes depending on the model:
            #   {response}                       (llama-3.2 vision, llava)
            #   {choices: [{message: {content}}]} (llama-4, qwen)
            #   {choices: [{text}]}               (llama-4 with a raw prompt)
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
        return json.dumps(result)[:400]
    if last is not None:
        print(f"cloudflare {model}: {last}")
    return ""
