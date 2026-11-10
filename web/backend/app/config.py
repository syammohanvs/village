from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


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
    poll_interval_ms: int
    stale_after_ms: int
    disconnect_after_ms: int
    whisper_url: str
    whisper_model_path: Path
    whisper_timeout_s: float
    models_dir: Path
    waste_model_dir: Path
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
            poll_interval_ms=_int("VILLAGE_POLL_INTERVAL_MS", 1000),
            stale_after_ms=_int("VILLAGE_STALE_AFTER_MS", 4000),
            disconnect_after_ms=_int("VILLAGE_DISCONNECT_AFTER_MS", 9000),
            whisper_url=os.getenv("VILLAGE_WHISPER_URL", "http://127.0.0.1:8080").rstrip("/"),
            whisper_model_path=Path(
                os.getenv("VILLAGE_WHISPER_MODEL", models / "whisper" / "ggml-base.bin")
            ),
            whisper_timeout_s=_float("VILLAGE_WHISPER_TIMEOUT_SECS", 90.0),
            models_dir=models,
            waste_model_dir=models / "waste",
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
