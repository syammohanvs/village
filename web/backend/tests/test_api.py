from __future__ import annotations

import asyncio
import json

import pytest

from conftest import FakeVoice, RecordingDevice, client_for, make_settings


@pytest.mark.asyncio
async def test_health_and_state_are_honest(tmp_path):
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, gateway, app):
        health = (await client.get("/api/v1/system/health")).json()
        assert health["status"] == "ok"
        assert health["device_mode"] == "simulator"
        assert health["physical"] is False

        state = (await client.get("/api/v1/state?mode=live")).json()
        assert state["physical"] is False
        assert state["source"]["kind"] == "simulator"
        assert state["connection"]["connected"] is True
        status = state["status"]
        assert status["sensors"]["soil"]["calibrated"] is True
        assert status["sensors"]["reservoir"]["state"] in {"available", "low"}
        assert "capacity" not in str(status["sensors"]["reservoir"]).lower()
        assert "litre" not in str(status).lower()


@pytest.mark.asyncio
async def test_demo_mode_never_touches_the_real_device(tmp_path):
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    async with client_for(settings, device=real) as (client, gateway, app):
        response = await client.post(
            "/api/v1/commands",
            json={
                "mode": "demo",
                "type": "LIGHTS_ON",
                "parameters": {},
                "request_id": "demo-light-0001",
                "source": "browser",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["confirmed"] is True
        assert body["physical"] is False
        assert body["mode"] == "demo"
        assert real.calls == []  # the real device was never called

        demo = (await client.get("/api/v1/state?mode=demo")).json()
        assert demo["status"]["actuators"]["streetlights"]["mode"] == "manual_on"
        live = (await client.get("/api/v1/state?mode=live")).json()
        assert live["status"]["actuators"]["streetlights"]["mode"] == "auto"


@pytest.mark.asyncio
async def test_demo_scenario_does_not_change_live_state(tmp_path):
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, gateway, app):
        live_before = (await client.get("/api/v1/state?mode=live")).json()
        response = await client.post(
            "/api/v1/demo/scenario",
            json={"soil_pct": 61.0, "reservoir": "low", "light": "bright"},
        )
        assert response.status_code == 200
        demo = (await client.get("/api/v1/state?mode=demo")).json()
        assert demo["status"]["sensors"]["soil"]["percent"] == 61.0
        assert demo["status"]["sensors"]["reservoir"]["state"] == "low"
        live_after = (await client.get("/api/v1/state?mode=live")).json()
        assert live_after["status"]["sensors"]["soil"]["percent"] == live_before["status"]["sensors"]["soil"]["percent"]


@pytest.mark.asyncio
async def test_unacknowledged_command_is_not_reported_as_success(tmp_path):
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    real.unreachable = True
    async with client_for(settings, device=real) as (client, gateway, app):
        response = await client.post(
            "/api/v1/commands",
            json={
                "mode": "live",
                "type": "LIGHTS_ON",
                "parameters": {},
                "request_id": "unreachable-0001",
                "source": "browser",
            },
        )
        assert response.status_code == 503
        body = response.json()
        assert body["confirmed"] is False
        assert body["ack"] is None
        assert body["error"]["code"] == "DEVICE_UNREACHABLE"


@pytest.mark.asyncio
async def test_retry_reuses_the_same_command_id(tmp_path):
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    real.fail_next = 1
    async with client_for(settings, device=real) as (client, gateway, app):
        response = await client.post(
            "/api/v1/commands",
            json={
                "mode": "live",
                "type": "LIGHTS_OFF",
                "parameters": {},
                "request_id": "retry-command-01",
                "source": "browser",
            },
        )
        assert response.status_code == 200
        assert response.json()["confirmed"] is True
        assert len(real.calls) == 2
        assert real.calls[0]["command_id"] == real.calls[1]["command_id"] == "retry-command-01"


@pytest.mark.asyncio
async def test_duplicate_request_id_is_not_sent_twice(tmp_path):
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    async with client_for(settings, device=real) as (client, gateway, app):
        payload = {
            "mode": "live",
            "type": "LIGHTS_AUTO",
            "parameters": {},
            "request_id": "same-request-01",
            "source": "browser",
        }
        first = (await client.post("/api/v1/commands", json=payload)).json()
        second = (await client.post("/api/v1/commands", json=payload)).json()
        assert first["confirmed"] is True
        assert second["duplicate_request"] is True
        assert len(real.calls) == 1

        changed = dict(payload)
        changed["type"] = "LIGHTS_ON"
        response = await client.post("/api/v1/commands", json=changed)
        assert response.status_code == 409


@pytest.mark.asyncio
async def test_waste_recognition_logs_and_warns_full_bin(tmp_path):
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, gateway, app):
        scenario = await client.post(
            "/api/v1/demo/scenario", json={"bins": {"plastic": 96.0}}
        )
        assert scenario.status_code == 200

        model = (await client.get("/api/v1/waste/model-status")).json()
        assert model["installed"] is False
        assert model["message"].startswith("Recognition model not installed")

        response = await client.post(
            "/api/v1/waste/recognition",
            json={
                "mode": "demo",
                "category": "plastic",
                "confidence": 0.91,
                "model": "test",
                "request_id": "recognition-01",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["bin_alert"] is not None
        assert body["bin_alert"]["bin_id"] == "plastic"
        # The correct category is still indicated; it is never redirected.
        assert body["indication"]["confirmed"] is True
        assert body["indication"]["ack"]["result"] == "ACCEPTED"
        recognition_id = body["recognition"]["id"]

        disposal = await client.post(
            "/api/v1/waste/disposals",
            json={"mode": "demo", "recognition_id": recognition_id},
        )
        assert disposal.status_code == 200
        assert disposal.json()["disposal"]["points"] == 2

        events = (await client.get("/api/v1/events?mode=demo")).json()["events"]
        assert any(event["kind"] == "waste" for event in events)


@pytest.mark.asyncio
async def test_config_revision_and_validation(tmp_path):
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, gateway, app):
        current = (await client.get("/api/v1/device/config?mode=demo")).json()
        revision = current["config_revision"]
        config = current["config"]

        conflict = await client.put(
            "/api/v1/device/config",
            json={"mode": "demo", "config_revision": revision + 9, "config": config},
        )
        assert conflict.status_code == 409
        assert conflict.json()["error"]["current_revision"] == revision

        bad = dict(config)
        bad = {**config, "soil": {**config["soil"], "dry_raw": 2000, "wet_raw": 2000}}
        invalid = await client.put(
            "/api/v1/device/config",
            json={"mode": "demo", "config_revision": revision, "config": bad},
        )
        assert invalid.status_code == 400
        assert invalid.json()["error"]["field"] == "soil.dry_raw/wet_raw"

        good = {**config, "soil": {**config["soil"], "dry_raw": 2700, "wet_raw": 1000}}
        saved = await client.put(
            "/api/v1/device/config",
            json={"mode": "demo", "config_revision": revision, "config": good},
        )
        assert saved.status_code == 200
        assert saved.json()["config_revision"] == revision + 1
        assert saved.json()["config"]["soil"]["dry_raw"] == 2700


@pytest.mark.asyncio
async def test_voice_rejections_do_not_actuate(tmp_path):
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    voice = FakeVoice("do not start irrigation")
    async with client_for(settings, device=real, voice=voice) as (client, gateway, app):
        response = await client.post(
            "/api/v1/voice/transcribe",
            files={"audio": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
            data={"language": "en"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["intent"] == "NEGATED"
        assert body["command"] is None
        assert real.calls == []

        voice.text = "start irrigation"
        response = await client.post(
            "/api/v1/voice/transcribe",
            files={"audio": ("test.wav", b"RIFF" + b"\x00" * 100, "audio/wav")},
            data={"language": "en"},
        )
        body = response.json()
        assert body["intent"] == "IRRIGATION_START"
        assert body["command"] == "IRRIGATION_REQUEST"
        # Transcription never actuates by itself; the browser sends the command.
        assert real.calls == []


@pytest.mark.asyncio
async def test_stale_and_disconnected_state_is_not_invented(tmp_path):
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    real.unreachable = True
    async with client_for(settings, device=real) as (client, gateway, app):
        state = (await client.get("/api/v1/state?mode=live")).json()
        assert state["connection"]["connected"] is False
        assert state["status"] is None
        assert state["connection"]["last_error"]

        health = (await client.get("/api/v1/device/health?mode=live")).json()
        assert health["reachable"] is False


@pytest.mark.asyncio
async def test_setup_checklist_and_settings(tmp_path):
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, gateway, app):
        checklist = (await client.get("/api/v1/setup/checklist")).json()
        assert len(checklist["items"]) >= 6
        assert any(item["id"] == "voice" for item in checklist["items"])
        assert any(item["id"] == "waste_model" for item in checklist["items"])

        settings_response = await client.put(
            "/api/v1/settings", json={"language": "ml", "tts_enabled": False}
        )
        assert settings_response.status_code == 200
        assert settings_response.json()["settings"]["language"] == "ml"

        read_back = (await client.get("/api/v1/settings")).json()["settings"]
        assert read_back["language"] == "ml"


@pytest.mark.asyncio
async def test_other_waste_is_referred_without_a_bin_command(tmp_path):
    """Cloth, leather, footwear, glass, metal, thermocol and e-waste share one
    referral outcome: recorded, no bin, and no INDICATE_WASTE command."""
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    async with client_for(settings, device=real) as (client, gateway, app):
        response = await client.post(
            "/api/v1/waste/recognition",
            json={
                "mode": "live",
                "category": "other",
                "confidence": 0.93,
                "model": "test",
                "request_id": "referral-01",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["recognition"]["category"] == "other"
        assert body["recognition"]["bin_state"] == "unavailable"
        assert body["indication"] is None
        assert body["bin_alert"] is None
        assert "recycling agent" in body["note"]
        # A referral must not touch the controller: no LED can light.
        assert real.calls == []
        events = (await client.get("/api/v1/events?mode=live")).json()["events"]
        assert any(event["title"] == "Recyclable item recognised" for event in events)
        # Confirming a handover records zero points and does not claim a bin deposit.
        disposal = await client.post(
            "/api/v1/waste/disposals",
            json={"mode": "live", "recognition_id": body["recognition"]["id"]},
        )
        assert disposal.status_code == 200
        assert disposal.json()["disposal"]["points"] == 0
        events = (await client.get("/api/v1/events?mode=live")).json()["events"]
        assert any(event["title"] == "Recyclable item handed over" for event in events)


@pytest.mark.asyncio
async def test_waste_model_status_reads_a_teachable_machine_export(tmp_path):
    """A real export writes labels as strings, not {"name": ...} objects."""
    settings = make_settings(tmp_path)
    folder = settings.waste_model_dir
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "model.json").write_text("{}", encoding="utf-8")
    (folder / "weights.bin").write_bytes(b"")
    (folder / "metadata.json").write_text(
        json.dumps(
            {
                "labels": ["Organic", "Plastic", "Paper", "Background"],
                "imageSize": 224,
            }
        ),
        encoding="utf-8",
    )

    async with client_for(settings) as (client, gateway, app):
        model = (await client.get("/api/v1/waste/model-status")).json()
        assert model["installed"] is True
        assert model["error"] is None
        assert model["labels"] == ["Organic", "Plastic", "Paper", "Background"]
        assert model["message"] == "Recognition model installed."

        # Older hand-written metadata uses objects; both shapes are read.
        (folder / "metadata.json").write_text(
            json.dumps({"labels": [{"name": "Organic"}, {"name": "Plastic"}]}),
            encoding="utf-8",
        )
        model = (await client.get("/api/v1/waste/model-status")).json()
        assert model["labels"] == ["Organic", "Plastic"]


@pytest.mark.asyncio
async def test_medical_waste_is_referred_without_a_bin_command(tmp_path):
    """Syringes, cotton, napkins and the rest are hazardous waste: recorded,
    no bin, and no INDICATE_WASTE command."""
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    async with client_for(settings, device=real) as (client, gateway, app):
        response = await client.post(
            "/api/v1/waste/recognition",
            json={
                "mode": "live",
                "category": "medical",
                "confidence": 0.91,
                "model": "test",
                "request_id": "medical-01",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["recognition"]["category"] == "medical"
        assert body["recognition"]["bin_state"] == "unavailable"
        assert body["indication"] is None
        assert body["bin_alert"] is None
        assert "Hazardous" in body["note"]
        assert real.calls == []
        events = (await client.get("/api/v1/events?mode=live")).json()["events"]
        assert any(event["title"] == "Hazardous waste recognised" for event in events)
