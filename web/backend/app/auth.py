"""One account, one password, one signed cookie.

What this is for: the venue runs on a laptop on a hotspot, in a room full of
visitors.  The point is that somebody cannot wander into **Setup**, change the
calibration or press **Water**, on a screen nobody is watching.  It is not built
to withstand an attacker who already has the machine — the whole application is
one local process with its data in `data/village.db`.

Deliberately stdlib only, no extra dependency and no user table:

  * the password is stored as **PBKDF2-HMAC-SHA256** with a random salt;
  * the session is `username|expiry|HMAC`, signed with a key derived from the
    stored hash, so changing the password invalidates every cookie and a restart
    does not log anyone out;
  * the cookie is `HttpOnly` and `SameSite=Lax`, so a page cannot read it and a
    cross-site form cannot use it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time

PBKDF2_ROUNDS = 120_000
COOKIE_NAME = "village_session"


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    """`pbkdf2$rounds$salt$digest` — self-describing, so the rounds can change."""
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return f"pbkdf2${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, rounds, salt_hex, digest_hex = stored.split("$")
        if scheme != "pbkdf2":
            return False
        expected = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds)
        )
    except (ValueError, TypeError):
        return False
    # compare_digest, not ==: a timing side channel on a password check is free
    # to avoid.
    return hmac.compare_digest(expected.hex(), digest_hex)


class Sessions:
    """Issue and read the session cookie for one account."""

    def __init__(self, username: str, password_hash: str, *, hours: int = 12) -> None:
        self.username = username
        self._secret = hashlib.sha256(f"village-session:{password_hash}".encode("utf-8")).digest()
        self.ttl = max(1, hours) * 3600

    def _sign(self, payload: str) -> str:
        return hmac.new(self._secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()[:32]

    def issue(self, *, now: float | None = None) -> str:
        expires = int((now if now is not None else time.time()) + self.ttl)
        payload = f"{self.username}|{expires}"
        token = f"{payload}|{self._sign(payload)}"
        return base64.urlsafe_b64encode(token.encode("utf-8")).decode("ascii")

    def read(self, token: str | None, *, now: float | None = None) -> str | None:
        """The username, or None when the token is absent, forged or expired."""
        if not token:
            return None
        try:
            raw = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
            username, expires, signature = raw.rsplit("|", 2)
        except (ValueError, UnicodeError, base64.binascii.Error):
            return None
        if not hmac.compare_digest(signature, self._sign(f"{username}|{expires}")):
            return None
        if int(expires) <= int(now if now is not None else time.time()):
            return None
        return username if username == self.username else None
