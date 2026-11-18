from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from .auth import hash_password

DEFAULT_ADMIN_USER = "admin"
DEFAULT_ADMIN_PASSWORD = "village"


def _capture_dir(name: str, default: Path) -> Path | None:
    """A directory for saved crops, or None when the setting is switched off.

    An explicit empty value disables it; unset uses the default.  The directory
    is not created here -- the first capture does that -- so a deployment that
    never classifies anything leaves no empty folder behind.
    """
    raw = os.getenv(name)
    if raw is None:
        return default
    raw = raw.strip()
    return Path(raw) if raw else None


def _path(name: str, default: Path) -> Path:
    """A directory that must stay useful: unset or blank means the default."""
    raw = (os.getenv(name) or "").strip()
    return Path(raw) if raw else default


def _admin_password_hash() -> str:
    """An explicit hash wins, then an explicit password, then the default.

    Hashing a supplied hash again would be a silent footgun, so
    `VILLAGE_ADMIN_PASSWORD_HASH` is taken as already-hashed (`pbkdf2$...`).
    """
    stored = (os.getenv("VILLAGE_ADMIN_PASSWORD_HASH") or "").strip()
    if stored:
        return stored
    return hash_password(os.getenv("VILLAGE_ADMIN_PASSWORD") or DEFAULT_ADMIN_PASSWORD)


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _flag(name: str, default: bool) -> bool:
    """A boolean that treats unset as the default and anything else as itself."""
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    repo_root: Path
    device_mode: str
    device_url: str
    device_token: str
    device_timeout_s: float
    # Look for the controller on its own subnet when the configured address
    # stops answering.  The board's address is DHCP and it moves.
    device_discover: bool
    device_discover_interval_s: float
    poll_interval_ms: int
    stale_after_ms: int
    disconnect_after_ms: int
    whisper_url: str
    whisper_model_path: Path
    # A Whisper-small fine-tuned on Malayalam (`models/whisper/ml-asr`).  It is
    # what makes a spoken Malayalam sentence usable — the multilingual base
    # model writes Malayalam sounds in Tamil letters (measured 2026-11-18).
    # Missing, it simply falls back to whisper-server.
    ml_asr_dir: Path
    whisper_timeout_s: float
    models_dir: Path
    waste_model_dir: Path
    # Where the crops the camera sends are kept, so a misread can be looked at
    # afterwards.  Empty disables it.
    waste_capture_dir: Path | None
    waste_capture_keep: int
    # Where a corrected crop is filed, one folder per class.  This is the tree
    # `train_handheld_head.py --extra-train` reads, so a venue mistake becomes a
    # training photo with one press.
    waste_samples_dir: Path
    # One account for the exhibit.  The default is a convenience for a fresh
    # install; docs/operation.md says to change it, and the startup log warns
    # while it is still in place.
    auth_enabled: bool
    admin_user: str
    admin_password_hash: str
    # True while the built-in "village" password is in use, so start-up can say
    # so out loud instead of leaving a default to be discovered.
    admin_password_default: bool
    session_hours: int
    # The share link: a visit link that signs in as "guest" and can only use
    # Simulation.  On by default because the exhibit is shared with students;
    # `VILLAGE_SHARE_LINK=0` takes it away.
    share_link_enabled: bool
    db_path: Path
    dist_dir: Path
    frontend_dir: Path
    intents_path: Path
    audio_manifest_path: Path
    app_version: str
    poll_enabled: bool
    sample_loop_enabled: bool
    voice_max_bytes: int
    voice_max_seconds: float
    piper_bin: Path
    piper_voices_dir: Path
    piper_cache_dir: Path

    @property
    def device_is_simulator(self) -> bool:
        return self.device_mode == "simulator"

    @property
    def source_kind(self) -> str:
        return "simulator" if self.device_is_simulator else "esp32"

    @property
    def source_label(self) -> str:
        return "Local simulator" if self.device_is_simulator else "ESP32 over Wi-Fi"

    @classmethod
    def load(cls, repo_root: Path | None = None) -> "Settings":
        root = (repo_root or Path(__file__).resolve().parents[3]).resolve()
        load_dotenv(root / ".env", override=False)

        mode = os.getenv("VILLAGE_DEVICE_MODE", "simulator").strip().lower()
        if mode not in {"real", "simulator"}:
            mode = "simulator"

        models = Path(os.getenv("VILLAGE_MODELS_DIR", root / "models"))
        dist = Path(os.getenv("VILLAGE_DIST_DIR", root / "web" / "frontend" / "dist"))
        frontend = root / "web" / "frontend"

        return cls(
            repo_root=root,
            device_mode=mode,
            device_url=os.getenv("VILLAGE_DEVICE_URL", "http://192.168.1.50").rstrip("/"),
            device_token=os.getenv("VILLAGE_DEVICE_TOKEN", "dev-village-token-change-me"),
            device_timeout_s=_float("VILLAGE_DEVICE_TIMEOUT_SECS", 3.0),
            device_discover=_flag("VILLAGE_DEVICE_DISCOVER", True),
            device_discover_interval_s=_float("VILLAGE_DEVICE_DISCOVER_SECS", 60.0),
            poll_interval_ms=_int("VILLAGE_POLL_INTERVAL_MS", 1000),
            stale_after_ms=_int("VILLAGE_STALE_AFTER_MS", 4000),
            disconnect_after_ms=_int("VILLAGE_DISCONNECT_AFTER_MS", 9000),
            whisper_url=os.getenv("VILLAGE_WHISPER_URL", "http://127.0.0.1:8080").rstrip("/"),
            whisper_model_path=Path(
                os.getenv("VILLAGE_WHISPER_MODEL", models / "whisper" / "ggml-base.bin")
            ),
            ml_asr_dir=Path(
                os.getenv("VILLAGE_ML_ASR_DIR", models / "whisper" / "ml-asr")
            ),
            whisper_timeout_s=_float("VILLAGE_WHISPER_TIMEOUT_SECS", 90.0),
            models_dir=models,
            waste_model_dir=models / "waste",
            waste_capture_dir=_capture_dir("VILLAGE_WASTE_CAPTURE_DIR",
                                          root / "data" / "waste-captures"),
            waste_capture_keep=_int("VILLAGE_WASTE_CAPTURE_KEEP", 20000),
            waste_samples_dir=_path("VILLAGE_WASTE_SAMPLES_DIR",
                                    root / "data" / "waste-samples"),
            auth_enabled=_bool("VILLAGE_AUTH_ENABLED", True),
            admin_user=(os.getenv("VILLAGE_ADMIN_USER") or DEFAULT_ADMIN_USER).strip(),
            # The password is read once and hashed here, so the plaintext never
            # lives in settings (or in a repr, or in a log line).
            admin_password_hash=_admin_password_hash(),
            admin_password_default=not (
                os.getenv("VILLAGE_ADMIN_PASSWORD") or os.getenv("VILLAGE_ADMIN_PASSWORD_HASH")
            ),
            session_hours=_int("VILLAGE_SESSION_HOURS", 12),
            share_link_enabled=_bool("VILLAGE_SHARE_LINK", True),
            db_path=Path(os.getenv("VILLAGE_DB_PATH", root / "data" / "village.db")),
            dist_dir=dist,
            frontend_dir=frontend,
            intents_path=root / "shared" / "intents.json",
            audio_manifest_path=frontend / "public" / "audio" / "manifest.json",
            app_version="0.1.0",
            poll_enabled=_bool("VILLAGE_POLL_ENABLED", True),
            sample_loop_enabled=_bool("VILLAGE_SAMPLE_LOOP", True),
            voice_max_bytes=_int("VILLAGE_VOICE_MAX_BYTES", 5 * 1024 * 1024),
            voice_max_seconds=_float("VILLAGE_VOICE_MAX_SECONDS", 12.0),
            piper_bin=Path(os.getenv("VILLAGE_PIPER_BIN", models / "piper" / "piper")),
            piper_voices_dir=Path(
                os.getenv("VILLAGE_PIPER_VOICES", models / "piper" / "voices")
            ),
            piper_cache_dir=Path(
                os.getenv(
                    "VILLAGE_PIPER_CACHE",
                    Path(os.getenv("VILLAGE_DB_PATH", root / "data" / "village.db")).parent
                    / "cache"
                    / "tts",
                )
            ),
        )
