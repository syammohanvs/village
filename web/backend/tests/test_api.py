from __future__ import annotations

import asyncio
import base64
import dataclasses
import json
import time

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
        # The solar panel reports volts, the drop across its sense resistor,
        # the current that implies and the power, so the dashboard can show all
        # three without doing the arithmetic itself.
        solar = status["sensors"]["solar"]
        for field in ("millivolts", "junction_millivolts", "sense_ohms", "current_ma", "power_mw"):
            assert field in solar
        assert solar["valid"] is True
        assert solar["current_ma"] == pytest.approx(
            solar["drop_millivolts"] / solar["sense_ohms"]
        )
        assert solar["power_mw"] == pytest.approx(
            (solar["millivolts"] / 1000.0) * solar["current_ma"]
        )


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
async def test_the_demo_light_slider_drives_auto_mode(tmp_path):
    """The exhibit's dark/light slider is the room's own calibration.

    Metric = 4095 - raw, dark below 2100 and bright above 2500, with the band
    between them holding the last decision — the same two thresholds the
    firmware uses, so the slider exercises Auto rather than pretending to.
    """
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, gateway, app):

        async def set_metric(value: int) -> dict:
            response = await client.post(
                "/api/v1/demo/scenario", json={"light_metric": value}
            )
            assert response.status_code == 200
            return (await client.get("/api/v1/state?mode=demo")).json()["status"]

        dark = await set_metric(1500)
        assert dark["sensors"]["light"]["brightness"] == "dark"
        assert dark["sensors"]["light"]["raw"] == 2595
        assert dark["actuators"]["streetlights"]["commanded"] is True

        bright = await set_metric(3000)
        assert bright["sensors"]["light"]["brightness"] == "bright"
        assert bright["actuators"]["streetlights"]["commanded"] is False

        # Inside the band nothing changes, so a hand on the slider cannot make
        # the lamps flap.
        band = await set_metric(2300)
        assert band["sensors"]["light"]["brightness"] == "bright"

        # An explicit reading still wins, and moves the slider's own value.
        response = await client.post("/api/v1/demo/scenario", json={"light": "dark"})
        assert response.status_code == 200
        after = (await client.get("/api/v1/state?mode=demo")).json()["status"]
        assert after["sensors"]["light"]["metric"] == 1820
        assert after["actuators"]["streetlights"]["commanded"] is True


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
async def test_waste_recognition_lights_the_indicator_without_a_fill_level(tmp_path):
    """The bins have indicator LEDs only.  A recognition lights the matching
    LED and records nothing about how full the bin is, because nothing measures
    that."""
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, gateway, app):
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
        assert "bin_alert" not in body
        assert body["recognition"]["bin_state"] is None
        # The correct category is indicated; there is no fill state to warn on.
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
        assert body["indication"] is None
        assert "bin_alert" not in body
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
        assert body["indication"] is None
        assert "bin_alert" not in body
        assert "Hazardous" in body["note"]
        assert real.calls == []
        events = (await client.get("/api/v1/events?mode=live")).json()["events"]
        assert any(event["title"] == "Hazardous waste recognised" for event in events)


@pytest.mark.asyncio
async def test_an_offline_controller_is_reported_not_crashed(tmp_path):
    """The board is switched off most of the time in ordinary use.

    Every configuration route reads the controller's current config before it
    writes, so an unreachable board used to fall through as a 500 with a stack
    trace in the log.  That reads as "the server is broken", and the operator
    has no idea whether their change was saved.  A 503 that names the
    controller is the honest answer, and the write says nothing was changed.
    """
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    real.unreachable = True
    async with client_for(settings, device=real) as (client, gateway, app):
        read = await client.get("/api/v1/device/config", params={"mode": "live"})
        assert read.status_code == 503
        body = read.json()["error"]
        assert body["code"] == "DEVICE_UNREACHABLE"
        assert "unreachable" in body["message"].lower()

        current = (await client.get("/api/v1/device/config", params={"mode": "demo"})).json()
        write = await client.put(
            "/api/v1/device/config",
            json={
                "mode": "live",
                "config_revision": current["config_revision"],
                "config": current["config"],
            },
        )
        assert write.status_code == 503
        # A refused write must not read as a saved one.
        assert "nothing was changed" in write.json()["error"]["message"].lower()

        # Both calibration routes read the config first, so they go the same way.
        soil = await client.post(
            "/api/v1/calibration/soil",
            json={"mode": "live", "dry_raw": 3000, "wet_raw": 1200},
        )
        assert soil.status_code == 503
        assert soil.json()["error"]["code"] == "DEVICE_UNREACHABLE"

        # And demo mode still works while the board is off: the simulator is
        # always available, which is what makes the app usable without it.
        assert (
            await client.get("/api/v1/device/config", params={"mode": "demo"})
        ).status_code == 200


@pytest.mark.asyncio
async def test_recording_a_recyclable_never_waits_for_the_controller(tmp_path):
    """The sentence must not wait for the bin levels.

    Measured in the app: with the board switched off, POST
    /api/v1/waste/recognition took 19-21 s, because the handler asked the
    controller for its state before answering -- and each attempt costs a
    connect timeout, with readers queueing behind it.  Sara speaks after that
    call returns, so the delay was heard as "she says nothing for ages".

    A referral needs nothing from the board, so the path must not touch it.
    """
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    real.unreachable = True
    async with client_for(settings, device=real) as (client, gateway, app):
        started = time.monotonic()
        response = await client.post(
            "/api/v1/waste/recognition",
            json={"mode": "live", "category": "other", "confidence": 0.9,
                  "model": "resnet50", "request_id": "no-wait-for-board"},
        )
        elapsed = time.monotonic() - started
        assert response.status_code == 200
        body = response.json()
        assert body["recognition"]["category"] == "other"
        assert body["indication"] is None
        # Not one poll: the answer does not depend on the controller.
        assert real.status_calls == 0
        assert elapsed < 0.5


@pytest.mark.asyncio
async def test_a_controller_that_never_answered_does_not_retry_per_reader(tmp_path):
    """With the board off from the start, a state read must stay instant.

    The gateway used to poll at the configured cadence with no failure backoff,
    so every reader queued behind a fresh connect timeout: /api/v1/state took
    6-12 s.  A board that has never answered is answered from what is already
    known rather than retried for every request.
    """
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    real.unreachable = True
    async with client_for(settings, device=real) as (client, gateway, app):
        first = await client.get("/api/v1/state", params={"mode": "live"})
        assert first.status_code == 200
        assert first.json()["connection"]["connected"] is False
        calls_after_first = real.status_calls
        assert calls_after_first >= 1

        for _ in range(5):
            started = time.monotonic()
            again = await client.get("/api/v1/state", params={"mode": "live"})
            elapsed = time.monotonic() - started
            assert again.status_code == 200
            # Backoff means these are answered from the cached view...
            assert elapsed < 0.5
        # ...without a new attempt each time.
        assert real.status_calls == calls_after_first


@pytest.mark.asyncio
async def test_the_poll_gap_grows_while_the_controller_is_away(tmp_path):
    """The backoff curve itself, which no request-level test can see.

    A gateway that answers slowly enough to exceed the poll interval would keep
    polling at the configured cadence, and every reader would wait behind it.
    """
    settings = make_settings(tmp_path)
    base = settings.poll_interval_ms
    async with client_for(settings, device=RecordingDevice()) as (client, gateway, app):
        assert gateway._poll_interval_ms() == pytest.approx(base)

        gateway._failures = 1
        assert gateway._poll_interval_ms() == pytest.approx(base * 2)
        gateway._failures = 3
        assert gateway._poll_interval_ms() == pytest.approx(base * 8)
        # Capped: a board left off overnight must not go quiet for an hour.
        gateway._failures = 40
        assert gateway._poll_interval_ms() == pytest.approx(30000)

        # A success resets it.
        gateway._failures = 0
        assert gateway._poll_interval_ms() == pytest.approx(base)


@pytest.mark.asyncio
async def test_the_material_the_model_named_is_kept_with_the_record(tmp_path):
    """A recycler is posted as "other", so the material has to be recorded too.

    Without it, "the key fob was identified wrongly" cannot be answered after
    the fact: the row says "other" and the label the visitor saw is gone.
    """
    settings = make_settings(tmp_path)
    async with client_for(settings, device=RecordingDevice()) as (client, gateway, app):
        response = await client.post(
            "/api/v1/waste/recognition",
            json={
                "mode": "demo",
                "category": "other",
                "confidence": 0.93,
                "model": "resnet50",
                "request_id": "material-recorded",
                "material": "Leather",
                "top": [
                    {"className": "Leather", "probability": 0.93},
                    {"className": "Metal", "probability": 0.04},
                ],
            },
        )
        assert response.status_code == 200
        events = await client.get("/api/v1/events", params={"mode": "demo", "limit": 5})
        rows = events.json()["events"]
        titled = [row for row in rows if row["title"] == "Recyclable item recognised"]
        assert titled, rows
        meta = titled[0]["meta"]
        assert meta["material"] == "Leather"
        assert meta["top"][0]["className"] == "Leather"


def test_every_crop_the_camera_sends_is_kept_with_what_was_said(tmp_path):
    """A misread has to be inspectable afterwards.

    "It called my key fob paper" is unanswerable from an event log. The backend
    therefore keeps the exact 224x224 picture the model judged, named after the
    time, the chosen class and the confidence, with the whole distribution in an
    index. Measured live: a plain white plate -- what the paint-out leaves when it
    keeps almost nothing -- is `Paper 0.69`, which is exactly the kind of thing
    that can only be found by looking at the image.
    """
    from io import BytesIO

    from PIL import Image

    from app import waste_resnet

    folder = tmp_path / "captures"
    settings = make_settings(tmp_path)
    settings = dataclasses.replace(
        settings, waste_capture_dir=folder, waste_capture_keep=3
    )
    waste_resnet.configure(settings)

    image = Image.new("RGB", (224, 224), (255, 255, 255))
    buffer = BytesIO()
    image.save(buffer, format="JPEG")
    raw = buffer.getvalue()
    predictions = [
        {"className": "Paper", "probability": 0.69},
        {"className": "Background", "probability": 0.06},
    ]

    for _ in range(5):
        assert waste_resnet._capture(raw, predictions) is not None

    saved = sorted(folder.glob("*.jpg"))
    assert len(saved) == 3, "the folder is bounded by waste_capture_keep"
    assert all(p.stat().st_size > 0 for p in saved)
    assert all("paper-0.69" in p.name for p in saved)

    lines = (folder / "index.jsonl").read_text().strip().splitlines()
    assert len(lines) == 5, "the index keeps the whole history"
    first = json.loads(lines[0])
    assert first["predictions"][0] == {"className": "Paper", "probability": 0.69}
    assert first["file"].endswith(".jpg")

    # The status route says where they are and how many.
    report = waste_resnet.captures()
    assert report["enabled"] is True
    assert report["count"] == 3
    assert report["folder"] == str(folder)


def test_saved_crops_can_be_switched_off(tmp_path):
    from app import waste_resnet

    settings = dataclasses.replace(make_settings(tmp_path), waste_capture_dir=None)
    waste_resnet.configure(settings)
    assert waste_resnet._capture(b"not a jpeg", [{"className": "Paper", "probability": 0.5}]) is None
    assert waste_resnet.captures() == {"enabled": False, "folder": None, "count": 0, "newest": None}


def test_classify_saves_the_crop_it_judged(tmp_path, monkeypatch):
    """The wiring, not just the helper: a real classification keeps its picture.

    `predict` is replaced so the test needs neither torch nor the 95 MB
    checkpoint; everything around it -- decoding the data URL, naming the file,
    writing the index -- is the real code.
    """
    from io import BytesIO

    from PIL import Image

    from app import waste_resnet

    folder = tmp_path / "captures"
    settings = dataclasses.replace(make_settings(tmp_path), waste_capture_dir=folder)
    waste_resnet.configure(settings)
    monkeypatch.setattr(
        waste_resnet,
        "predict",
        lambda image: [
            {"className": "Paper", "probability": 0.81},
            {"className": "Background", "probability": 0.05},
        ],
    )

    image = Image.new("RGB", (224, 224), (250, 250, 250))
    buffer = BytesIO()
    image.save(buffer, format="JPEG")
    payload = "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()

    assert waste_resnet.classify(payload)[0]["className"] == "Paper"
    saved = list(folder.glob("*.jpg"))
    assert len(saved) == 1
    assert "paper-0.81" in saved[0].name
    assert saved[0].stat().st_size > 0


@pytest.mark.asyncio
async def test_test_output_is_normalised_and_refused_when_unknown(tmp_path):
    """Setup → Test outputs: the wire shape is checked here, the gate lives in
    the controller (test mode off refuses every output)."""
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    async with client_for(settings, device=real) as (client, gateway, app):
        response = await client.post(
            "/api/v1/commands",
            json={
                "mode": "live",
                "type": "TEST_OUTPUT",
                "parameters": {"output": "LED_PLASTIC", "on": "truthy"},
                "request_id": "test-output-0001",
                "source": "browser",
            },
        )
        assert response.status_code == 200
        forwarded = real.calls[-1]
        assert forwarded["type"] == "TEST_OUTPUT"
        assert forwarded["parameters"]["output"] == "led_plastic"
        assert forwarded["parameters"]["on"] is True

        bad = await client.post(
            "/api/v1/commands",
            json={
                "mode": "live",
                "type": "TEST_OUTPUT",
                "parameters": {"output": "explode"},
                "request_id": "test-output-0002",
                "source": "browser",
            },
        )
        assert bad.status_code == 422
        assert "led_organic" in bad.json()["detail"]

@pytest.mark.asyncio
async def test_test_mode_is_the_master_switch_above_the_outputs(tmp_path):
    """TEST_MODE turns the five output switches on and off.

    The refusal itself is in the firmware -- an output with test mode off is
    answered REJECTED there -- so all this route owes is an honest wire shape
    and a real boolean, which is what a UI switch sends.
    """
    settings = make_settings(tmp_path)
    real = RecordingDevice()
    async with client_for(settings, device=real) as (client, gateway, app):
        on = await client.post(
            "/api/v1/commands",
            json={
                "mode": "live",
                "type": "TEST_MODE",
                "parameters": {"on": "yes"},
                "request_id": "test-mode-0001",
                "source": "browser",
            },
        )
        assert on.status_code == 200
        forwarded = real.calls[-1]
        assert forwarded["type"] == "TEST_MODE"
        assert forwarded["parameters"]["on"] is True

        off = await client.post(
            "/api/v1/commands",
            json={
                "mode": "live",
                "type": "TEST_MODE",
                "parameters": {"on": 0},
                "request_id": "test-mode-0002",
                "source": "browser",
            },
        )
        assert off.status_code == 200
        assert real.calls[-1]["parameters"]["on"] is False


@pytest.mark.asyncio
async def test_a_bin_answer_survives_a_board_that_cannot_be_reached(tmp_path):
    """Classifying without the board is a legitimate mode.

    The camera and the model live on this laptop; the board only lights the LED.
    This used to fail the whole request, so with the controller off the page
    showed an error instead of the bin it had just decided on -- while a referral
    (which never asks the board anything) answered normally (reported 2026-11-16).
    """
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, gateway, app):
        async def unreachable(**kwargs):
            raise RuntimeError("Provider error: controller unreachable")

        gateway.send_command = unreachable  # type: ignore[assignment]
        response = await client.post(
            "/api/v1/waste/recognition",
            json={
                "mode": "live",
                "category": "plastic",
                "confidence": 0.81,
                "model": "test",
                "request_id": "offline-bin-01",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["indication"] is None
    assert "No bin LED was lit" in body["led_note"]
    # The answer itself is intact and recorded, marked as not physically shown.
    assert body["recognition"]["category"] == "plastic"
    assert body["recognition"]["indication_confirmed"] in (False, 0)


@pytest.mark.asyncio
async def test_demo_mode_shows_a_wind_reading_like_the_solar_panel(tmp_path):
    """Simulation has to demonstrate the card, not leave it "Not fitted".

    The wind input is one analogue pin that nothing is wired to yet; in
    Simulation the point is to show what the card will look like once it is
    (asked for 2026-11-16).
    """
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, _gateway, _app):
        response = await client.get("/api/v1/state?mode=demo")

    assert response.status_code == 200
    sensors = (response.json().get("status") or {}).get("sensors") or {}
    wind = sensors.get("wind") or {}
    assert wind.get("installed") is True
    assert wind.get("millivolts", 0) > 0
    assert wind.get("generating") is True
    # The solar card in Simulation is the model this follows.
    assert (sensors.get("solar") or {}).get("installed") is True


@pytest.mark.asyncio
async def test_the_demo_pump_has_a_manual_switch_like_the_lamps(tmp_path):
    """The pump can be held on (or off) regardless of the soil.

    The board has the same switch now (`PUMP_ON` / `PUMP_OFF` / `PUMP_AUTO`), so
    this exercises the simulator through the demo scenario field it shares; the
    manual mode watches the tank and nothing else, and hands the pump back to
    the rules when set to auto.
    """
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, gateway, app):

        async def scenario(values: dict) -> dict:
            response = await client.post("/api/v1/demo/scenario", json=values)
            assert response.status_code == 200
            return (await client.get("/api/v1/state?mode=demo")).json()["status"]

        # Wet soil: the rules keep the pump off.
        wet = await scenario({"soil_pct": 60.0, "pump_manual": "auto"})
        assert wet["actuators"]["pump"]["commanded"] is False
        assert wet["actuators"]["pump"]["mode"] == "auto"

        # Held on by hand, soil or no soil.
        on = await scenario({"pump_manual": "on"})
        assert on["actuators"]["pump"]["commanded"] is True
        assert on["irrigation"]["state"] == "pumping"
        assert on["actuators"]["pump"]["mode"] == "on"

        off = await scenario({"pump_manual": "off"})
        assert off["actuators"]["pump"]["commanded"] is False

        # Back to auto: still wet, so still off — the manual session ended.
        auto = await scenario({"pump_manual": "on"})
        assert auto["actuators"]["pump"]["commanded"] is True
        back = await scenario({"pump_manual": "auto"})
        assert back["actuators"]["pump"]["commanded"] is False
        assert back["actuators"]["pump"]["mode"] == "auto"


@pytest.mark.asyncio
async def test_the_pump_switch_is_a_command_the_board_understands(tmp_path):
    """PUMP_ON / PUMP_OFF / PUMP_AUTO are ordinary commands.

    That matters because the page sends them in Live as well as Simulation: the
    firmware's switch and the simulator's have to answer the same three words.
    """
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, gateway, app):

        async def command(kind: str, index: int) -> dict:
            response = await client.post(
                "/api/v1/commands",
                json={
                    "type": kind,
                    "parameters": {},
                    "mode": "demo",
                    "request_id": f"pump-switch-{index:04d}",
                },
            )
            body = response.json()
            assert response.status_code == 200, body
            return body

        wet = await client.post(
            "/api/v1/demo/scenario", json={"soil_pct": 60.0, "pump_manual": "auto"}
        )
        assert wet.status_code == 200

        on = await command("PUMP_ON", 1)
        assert on["ack"]["result"] == "ACCEPTED"
        assert on["ack"]["irrigation"]["pump_on"] is True

        off = await command("PUMP_OFF", 2)
        assert off["ack"]["result"] == "ACCEPTED"
        assert off["ack"]["irrigation"]["pump_on"] is False

        auto = await command("PUMP_AUTO", 3)
        assert auto["ack"]["result"] == "ACCEPTED"
        status = (await client.get("/api/v1/state?mode=demo")).json()["status"]
        assert status["actuators"]["pump"]["mode"] == "auto"
        # Wet soil, so the rules keep it off.
        assert status["actuators"]["pump"]["commanded"] is False
