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
    for name in (
        "VILLAGE_CF_API_TOKEN",
        "VILLAGE_CF_ACCOUNT_ID",
        "VILLAGE_CF_VISION_MODEL",
        "VILLAGE_VISION_API_KEY",
        "VILLAGE_VISION_PROVIDER",
        "VILLAGE_VISION_BASE_URL",
    ):
        monkeypatch.delenv(name, raising=False)
    vision._CACHE.clear()
    vision._CACHE_ORDER.clear()
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

    def fake_ask(jpeg: bytes, which: str) -> str:
        asked.append(jpeg)
        return "A clear plastic lid."

    monkeypatch.setattr(vision, "_ask", fake_ask)

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

    def boom(jpeg: bytes, which: str) -> str:
        raise RuntimeError("HTTP Error 500: upstream")

    monkeypatch.setattr(vision, "_ask", boom)

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
    monkeypatch.setattr(vision, "_ask", lambda jpeg, which: "Remote control")

    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, _gateway, _app):
        response = await client.post("/api/v1/waste/identify", json={"image": CROP})

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "Remote control"
    assert body["provider"] == "cloudflare"
    assert body["model"]
