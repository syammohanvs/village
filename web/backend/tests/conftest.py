from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.db import Database
from app.device import DeviceGateway, DeviceUnreachable
from app.main import create_app
from app.simulator import SimulatedDevice
from app.voice import WhisperClient


class RecordingDevice:
    """A real-device stand-in that records every call.  Used to prove that
    demo mode never reaches it and that retries reuse the same command id."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.fail_next = 0
        self.unreachable = False
        self._sim = SimulatedDevice()

    def status(self) -> dict[str, Any]:
        if self.unreachable:
            raise DeviceUnreachable("fake controller is unreachable")
        return self._sim.status()

    def health(self) -> dict[str, Any]:
        if self.unreachable:
            raise DeviceUnreachable("fake controller is unreachable")
        return self._sim.health()

    def get_config(self) -> dict[str, Any]:
        return self._sim.get_config()

    def put_config(self, revision: int, config: dict[str, Any]) -> dict[str, Any]:
        return self._sim.put_config(revision, config)

    def command(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(dict(payload))
        if self.unreachable:
            raise DeviceUnreachable("fake controller is unreachable")
        if self.fail_next > 0:
            self.fail_next -= 1
            raise DeviceUnreachable("one lost response")
        return self._sim.command(payload)

    async def close(self) -> None:
        return None


class FakeVoice:
    def __init__(self, text: str = "start irrigation") -> None:
        self.text = text

    async def transcribe(self, data: bytes, language: str) -> dict[str, Any]:
        return {"text": self.text, "duration_s": 1.0}

    async def readiness(self) -> dict[str, Any]:
        return {
            "ready": True,
            "server_reachable": True,
            "model_name": "ggml-base.bin",
            "message": "ok",
        }


def make_settings(tmp_path: Path) -> Settings:
    base = Settings.load()
    return replace(
        base,
        db_path=tmp_path / "test.db",
        poll_enabled=False,
        sample_loop_enabled=False,
        device_mode="simulator",
        stale_after_ms=0,
        disconnect_after_ms=0,
    )


@asynccontextmanager
async def client_for(
    settings: Settings,
    *,
    device: Any | None = None,
    voice: Any | None = None,
    tts: Any | None = None,
):
    gateway = DeviceGateway(
        settings,
        device=device or SimulatedDevice(),
        demo=SimulatedDevice(demo=True),
    )
    app = create_app(
        settings,
        gateway=gateway,
        database=Database(settings.db_path),
        voice=voice or WhisperClient(settings),
        tts=tts,
    )
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, gateway, app


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)
