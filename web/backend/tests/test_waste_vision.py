from __future__ import annotations

from pathlib import Path

import pytest

from app import vision

from conftest import client_for, make_settings

# A 24-byte JPEG header is enough: the module only decodes the data URL, the
# model itself is always stubbed in these tests (nothing here touches a network).
CROP = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAARCAABAAEDASIAAhEBAxEB"


@pytest.fixture(autouse=True)
def no_provider(monkeypatch: pytest.MonkeyPatch):
    """Every test starts with no vision provider and an empty answer cache.

    `Settings.load()` reads the repository's `.env`, so without this a machine
    that has a Cloudflare token would make the suite call the real API.
    """
    names = [
        "VILLAGE_CF_ACCOUNT_ID",
        "VILLAGE_CF_VISION_MODEL",
        "VILLAGE_VISION_API_KEY",
        "VILLAGE_VISION_PROVIDER",
        "VILLAGE_VISION_BASE_URL",
    ]
    # The provider chain can hold several Cloudflare accounts, so every one of
    # them has to go or a machine with a token calls the real API in a test.
    for suffix in ("", "_2", "_3", "_4", "_5"):
        names += [f"VILLAGE_CF_API_TOKEN{suffix}", f"VILLAGE_CF_ACCOUNT_ID{suffix}"]
    for name in names:
        monkeypatch.delenv(name, raising=False)
    vision._CACHE.clear()
    vision._CACHE_ORDER.clear()
    vision._INDEX[0] = 0
    yield


def test_no_provider_means_no_object_and_no_wait() -> None:
    # A deployment with no key must behave exactly as before this existed.
    answer = vision.identify(CROP)
    assert answer["object"] is None
    assert answer["reason"] == "not configured"
    assert answer["ms"] == 0
    assert vision.status()["ready"] is False


def test_the_name_is_cleaned_into_a_noun_phrase() -> None:
    assert vision._clean("A clear plastic lid.") == "clear plastic lid"
    assert vision._clean('  "Remote control" ') == "Remote control"
    assert vision._clean("An orange pencil") == "orange pencil"
    # A refusal is not a name.
    assert vision._clean("nothing") is None
    assert vision._clean("I cannot tell what this is") is None
    assert vision._clean("") is None


def test_a_configured_model_names_the_object_and_is_asked_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VILLAGE_VISION_PROVIDER", "cloudflare")
    monkeypatch.setenv("VILLAGE_CF_API_TOKEN", "cfut_test")
    asked: list[bytes] = []

    def fake_ask(candidate: dict, jpeg: bytes) -> str:
        asked.append(jpeg)
        return "A clear plastic lid."

    monkeypatch.setattr(vision, "_ask_candidate", fake_ask)

    first = vision.identify(CROP)
    second = vision.identify(CROP)

    assert first["object"] == "clear plastic lid"
    assert first["provider"] == "cloudflare"
    assert len(asked) == 1
    # The same crop is answered from the cache: a correction or a retry must not
    # pay for the same question twice.
    assert second["object"] == "clear plastic lid"
    assert second["cached"] is True
    assert len(asked) == 1


def test_a_failing_model_leaves_the_page_with_the_classifier(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VILLAGE_VISION_PROVIDER", "cloudflare")
    monkeypatch.setenv("VILLAGE_CF_API_TOKEN", "cfut_test")

    def boom(candidate: dict, jpeg: bytes) -> str:
        raise RuntimeError("HTTP Error 500: upstream")

    monkeypatch.setattr(vision, "_ask_candidate", boom)

    answer = vision.identify(CROP)
    assert answer["object"] is None
    assert "500" in (answer["reason"] or "")


@pytest.mark.asyncio
async def test_the_route_answers_with_a_null_object_when_unconfigured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Booting the app re-reads the repository's `.env` (dotenv fills in what the
    # fixture deleted), so the *decision* is what is stubbed here: no provider.
    monkeypatch.setattr(vision, "provider", lambda: None)
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, _gateway, _app):
        response = await client.post("/api/v1/waste/identify", json={"image": CROP})

    assert response.status_code == 200
    body = response.json()
    assert body["object"] is None
    assert body["provider"] is None


@pytest.mark.asyncio
async def test_the_route_names_the_object_when_a_provider_is_configured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VILLAGE_VISION_PROVIDER", "cloudflare")
    monkeypatch.setenv("VILLAGE_CF_API_TOKEN", "cfut_test")
    monkeypatch.setattr(vision, "_ask_candidate", lambda candidate, jpeg: "Remote control")

    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, _gateway, _app):
        response = await client.post("/api/v1/waste/identify", json={"image": CROP})

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "Remote control"
    assert body["provider"] == "cloudflare"
    assert body["model"]


def test_the_second_cloudflare_account_is_used_when_the_first_is_spent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Two free accounts, each with its own daily allowance.  The first answers
    # "quota", so the same press must be answered by the second — and the next
    # press must go straight to the second instead of failing on the first
    # again.
    monkeypatch.setenv("VILLAGE_VISION_PROVIDER", "cloudflare")
    monkeypatch.setenv("VILLAGE_CF_API_TOKEN", "cfut_one")
    monkeypatch.setenv("VILLAGE_CF_ACCOUNT_ID", "acct-one")
    monkeypatch.setenv("VILLAGE_CF_API_TOKEN_2", "cfut_two")
    monkeypatch.setenv("VILLAGE_CF_ACCOUNT_ID_2", "acct-two")
    seen: list[str] = []

    def ask(candidate: dict, jpeg: bytes) -> str:
        seen.append(candidate["token"])
        if candidate["token"] == "cfut_one":
            raise RuntimeError("HTTP Error 429: quota exceeded")
        return "clear plastic lid"

    monkeypatch.setattr(vision, "_ask_candidate", ask)

    first = vision.identify(CROP)
    assert first["object"] == "clear plastic lid"
    assert seen == ["cfut_one", "cfut_two"]

    second = vision.identify(
        "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL"
    )
    assert second["object"] == "clear plastic lid"
    # Sticky: the spent account is not tried again.
    assert seen == ["cfut_one", "cfut_two", "cfut_two"]


def test_deepseek_is_the_last_resort_when_every_cloudflare_account_is_spent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VILLAGE_VISION_PROVIDER", "cloudflare")
    monkeypatch.setenv("VILLAGE_CF_API_TOKEN", "cfut_one")
    monkeypatch.setenv("VILLAGE_CF_ACCOUNT_ID", "acct-one")
    monkeypatch.setenv("VILLAGE_CF_API_TOKEN_2", "cfut_two")
    monkeypatch.setenv("VILLAGE_CF_ACCOUNT_ID_2", "acct-two")
    monkeypatch.setenv("VILLAGE_VISION_API_KEY", "oc_sk_test")
    seen: list[str] = []

    def ask(candidate: dict, jpeg: bytes) -> str:
        seen.append(candidate["provider"])
        if candidate["provider"] == "cloudflare":
            raise RuntimeError("HTTP Error 429: quota exceeded")
        return "clear plastic lid"

    monkeypatch.setattr(vision, "_ask_candidate", ask)

    answer = vision.identify(CROP)
    assert answer["object"] == "clear plastic lid"
    assert answer["provider"] == "opencode"
    assert seen == ["cloudflare", "cloudflare", "opencode"]
    # The page is told how many chances there are, not a guess.
    assert vision.status()["chain"] == 3


def test_any_lead_in_is_stripped_to_the_name() -> None:
    """The models phrase the lead-in differently every time.

    Measured 2026-11-19: `llama-3.2-11b-vision` answered "object in this image is
    a clear plastic lid" — the old list of prefixes did not include it, so that
    whole sentence was shown to the visitor and spoken by Sara.
    """
    assert vision._clean("object in this image is a clear plastic lid") == "clear plastic lid"
    assert vision._clean("The single object in this photo is a clear plastic lid.") == "clear plastic lid"
    assert (
        vision._clean("The object in this image appears to be a piece of black plastic with metal attached.")
        == "piece of black plastic with metal attached"
    )
    assert vision._clean("It is a white plastic remote control") == "white plastic remote control"
    # A name that already is a name is untouched.
    assert vision._clean("Clear plastic lid") == "Clear plastic lid"
    # ...and silence stays silent.
    assert vision._clean("nothing") is None
