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
