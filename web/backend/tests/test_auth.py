from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from app.auth import hash_password, verify_password
from app.config import Settings

from conftest import client_for, make_settings

PASSWORD = "exhibit-test-password"


def secured(tmp_path: Path) -> Settings:
    """The normal test settings with one known account and the gate closed."""
    return replace(
        make_settings(tmp_path),
        auth_enabled=True,
        admin_user="examiner",
        admin_password_hash=hash_password(PASSWORD),
        session_hours=1,
    )


@pytest.mark.asyncio
async def test_the_api_needs_a_session_and_the_login_form_is_open(tmp_path: Path) -> None:
    async with client_for(secured(tmp_path)) as (client, _gateway, _app):
        # Nothing under /api/v1 answers without a cookie...
        assert (await client.get("/api/v1/state?mode=live")).status_code == 401
        # ...except the form's own questions and the health probe.
        session = await client.get("/api/v1/auth/session")
        assert session.status_code == 200
        assert session.json()["authenticated"] is False
        assert session.json()["auth_enabled"] is True
        assert (await client.get("/api/v1/system/health")).status_code == 200

        wrong = await client.post(
            "/api/v1/auth/login", json={"username": "examiner", "password": "guess"}
        )
        assert wrong.status_code == 401
        # The same sentence whichever half was wrong.
        assert "do not match" in wrong.json()["detail"]

        ok = await client.post(
            "/api/v1/auth/login", json={"username": "examiner", "password": PASSWORD}
        )
        assert ok.status_code == 200
        assert ok.json() == {"authenticated": True, "username": "examiner"}

        # The cookie the login set is enough from here on.
        assert (await client.get("/api/v1/state?mode=live")).status_code == 200

        await client.post("/api/v1/auth/logout")
        assert (await client.get("/api/v1/state?mode=live")).status_code == 401


@pytest.mark.asyncio
async def test_a_forged_or_expired_cookie_is_not_a_session(tmp_path: Path) -> None:
    settings = secured(tmp_path)
    async with client_for(settings) as (client, _gateway, _app):
        client.cookies.set("village_session", "not-a-real-token")
        assert (await client.get("/api/v1/state?mode=live")).status_code == 401


@pytest.mark.asyncio
async def test_guessing_is_slowed_after_five_tries(tmp_path: Path) -> None:
    async with client_for(secured(tmp_path)) as (client, _gateway, _app):
        for _ in range(5):
            await client.post(
                "/api/v1/auth/login", json={"username": "examiner", "password": "guess"}
            )
        paused = await client.post(
            "/api/v1/auth/login", json={"username": "examiner", "password": PASSWORD}
        )
        assert paused.status_code == 429
        assert "wait a minute" in paused.json()["detail"]


def test_the_default_password_is_flagged_so_startup_can_warn(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv("VILLAGE_ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("VILLAGE_ADMIN_PASSWORD_HASH", raising=False)
    assert Settings.load().admin_password_default is True

    # An explicit hash is taken as already hashed -- re-hashing it would make a
    # correct password fail for reasons nobody could see.
    monkeypatch.setenv("VILLAGE_ADMIN_PASSWORD_HASH", hash_password("chosen-by-the-operator"))
    loaded = Settings.load()
    assert loaded.admin_password_default is False
    assert verify_password("chosen-by-the-operator", loaded.admin_password_hash)


def test_the_password_is_salted_and_compared_safely() -> None:
    first = hash_password("same-password")
    second = hash_password("same-password")
    # Salted: two hashes of one password differ, both verify.
    assert first != second
    assert verify_password("same-password", first)
    assert verify_password("same-password", second)
    assert not verify_password("other", first)
    # A malformed stored value is a refusal, not an exception.
    assert not verify_password("same-password", "nonsense")
    assert not verify_password("same-password", "")


# ---------------------------------------------------------------------------
# The share link
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_share_link_signs_in_a_simulation_only_visitor(tmp_path: Path) -> None:
    """The link is a look, not a hand.

    It lands a student in the village with no password - and the same cookie is
    refused a live command, a settings write and a calibration, because the
    session it carries is the guest, not the account.
    """
    settings = secured(tmp_path)
    async with client_for(settings) as (client, gateway, app):
        key = app.state.sessions.magic_key()
        opened = await client.get(f"/api/v1/auth/magic?key={key}", follow_redirects=False)
        assert opened.status_code == 303
        # Simulation is where a visitor belongs, and the redirect says so.
        assert opened.headers["location"] == "/?mode=demo"
        cookie = opened.headers["set-cookie"]
        assert cookie.startswith("village_session=")

        session = (await client.get("/api/v1/auth/session")).json()
        assert session["authenticated"] is True
        assert session["guest"] is True
        assert session["username"] == "guest"

        # Reading the village is the point of the link.
        assert (await client.get("/api/v1/state?mode=demo")).status_code == 200

        # Simulation is theirs: the lights, the pump switch, Sara, the waste
        # classifier and the two simulation knobs all still answer.
        demo_light = await client.post(
            "/api/v1/commands",
            json={
                "mode": "demo",
                "type": "LIGHTS_ON",
                "parameters": {},
                "request_id": "guest-demo-light-1",
                "source": "browser",
            },
        )
        assert demo_light.status_code == 200
        assert demo_light.json()["confirmed"] is True

        # Live is not: the board would move.
        live_light = await client.post(
            "/api/v1/commands",
            json={
                "mode": "live",
                "type": "LIGHTS_ON",
                "parameters": {},
                "request_id": "guest-live-light-1",
                "source": "browser",
            },
        )
        assert live_light.status_code == 403
        assert "Simulation" in live_light.json()["detail"]

        # Operator writes are refused outright - the whole rest of the API.
        for call in (
            client.put("/api/v1/settings", json={"language": "ml"}),
            client.put("/api/v1/device/config", json={}),
            client.post(
                "/api/v1/calibration/soil", json={"dry_raw": 1, "wet_raw": 2}
            ),
            client.post("/api/v1/profiles", json={"name": "probe", "settings": {}}),
            # A correction writes a training photo, which is not a look either.
            client.post(
                "/api/v1/waste/correction",
                json={"file": "x.jpg", "category": "Plastic"},
            ),
        ):
            refused = await call
            assert refused.status_code == 403, refused.text
            assert "Simulation" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_a_bad_or_switched_off_share_link_is_a_refusal(tmp_path: Path) -> None:
    async with client_for(secured(tmp_path)) as (client, _gateway, _app):
        assert (await client.get("/api/v1/auth/magic?key=made-up")).status_code == 403
        assert (await client.get("/api/v1/auth/magic")).status_code == 403

    switched_off = replace(secured(tmp_path), share_link_enabled=False)
    async with client_for(switched_off) as (client, _gateway, app):
        key = app.state.sessions.magic_key()
        assert (await client.get(f"/api/v1/auth/magic?key={key}")).status_code == 404


@pytest.mark.asyncio
async def test_the_operator_can_copy_the_share_link_from_setup(tmp_path: Path) -> None:
    """The link is behind the account, because handing it out is the call of
    whoever runs the exhibit - not of whoever opened the page."""
    async with client_for(secured(tmp_path)) as (client, _gateway, app):
        assert (await client.get("/api/v1/auth/share-link")).status_code == 401

        ok = await client.post(
            "/api/v1/auth/login", json={"username": "examiner", "password": PASSWORD}
        )
        assert ok.status_code == 200

        body = (await client.get("/api/v1/auth/share-link")).json()
        assert body["enabled"] is True
        assert body["guest"] == "guest"
        assert body["url"].startswith("http://test/api/v1/auth/magic?key=")
        # The link really opens a session, which is what makes the copy worth
        # anything.
        url = body["url"].replace("http://test", "")
        assert (await client.get(url, follow_redirects=False)).status_code == 303
        # ...and it is a guest, even though the account minted it.
        assert (await client.get("/api/v1/auth/session")).json()["guest"] is True
