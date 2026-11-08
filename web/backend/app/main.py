from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .db import Database, DEFAULT_SETTINGS, POINTS
from .device import (
    DeviceError,
    DeviceGateway,
    DeviceUnreachable,
    RequestReuseError,
    utc_now,
)
from .intents import IntentMatcher
from .protocol import (
    ALLOWED_COMMANDS,
    WASTE_CATEGORIES,
    AppSettingsUpdate,
    CommandRequest,
    ConfigPutRequest,
    DisposalRequest,
    ProfileCreateRequest,
    RecognitionRequest,
    ReservoirCalibrationRequest,
    ScenarioRequest,
    SoilCalibrationRequest,
)
from .simulator import SimulatorError
from .voice import VoiceError, WhisperClient, audio_assets

log = logging.getLogger("village")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

BIN_IDS = ("organic", "plastic", "paper")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_gateway(request: Request) -> DeviceGateway:
    return request.app.state.gateway


def get_voice(request: Request) -> WhisperClient:
    return request.app.state.voice


def get_matcher(request: Request) -> IntentMatcher:
    return request.app.state.matcher


def error_response(exc: DeviceError) -> JSONResponse:
    payload = {"code": exc.code, "message": exc.message}
    error = exc.payload.get("error", {}) if isinstance(exc.payload, dict) else {}
    current = error.get("current_revision")
    if current is not None:
        payload["current_revision"] = current
    field = error.get("field")
    if field:
        payload["field"] = field
    return JSONResponse(status_code=exc.status, content={"error": payload})


def _waste_model_status(settings: Settings) -> dict[str, Any]:
    folder = settings.waste_model_dir
    files = {name: (folder / name).is_file() for name in ("model.json", "metadata.json", "weights.bin")}
    installed = all(files.values())
    labels: list[str] = []
    error = None
    if installed:
        try:
            metadata = json.loads((folder / "metadata.json").read_text(encoding="utf-8"))
            labels = [str(item.get("name", "")) for item in metadata.get("labels", [])]
        except Exception as exc:  # noqa: BLE001 - surfaced to the operator
            error = f"metadata.json could not be read: {exc}"
    return {
        "installed": installed and error is None,
        "folder": str(folder),
        "url_path": "/models/waste/",
        "files": files,
        "missing": [name for name, present in files.items() if not present],
        "labels": labels,
        "expected_labels": ["Organic", "Plastic", "Paper", "Background"],
        "error": error,
        "message": (
            "Recognition model installed." if installed and error is None
            else "Recognition model not installed. Copy model.json, metadata.json and weights.bin into models/waste/."
        ),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings: Settings = app.state.settings
    db: Database = app.state.db
    gateway: DeviceGateway = app.state.gateway
    await db.init()
    await gateway.start()

    stop = asyncio.Event()

    async def sample_loop() -> None:
        while not stop.is_set():
            try:
                live = await gateway.snapshot("live")
                if live.get("status"):
                    await db.add_sensor_sample("live", live["status"])
                demo = await gateway.snapshot("demo")
                if demo.get("status"):
                    await db.add_sensor_sample("demo", demo["status"])
                for event in gateway.drain_events():
                    await db.add_event(
                        "live",
                        event["kind"],
                        event["title"],
                        event.get("detail", ""),
                        event.get("severity", "info"),
                        "device",
                    )
            except Exception as exc:  # keep the sampler alive
                log.exception("sensor sampler failed: %s", exc)
            try:
                await asyncio.wait_for(stop.wait(), timeout=10)
            except asyncio.TimeoutError:
                continue

    sampler: asyncio.Task | None = None
    if settings.sample_loop_enabled:
        sampler = asyncio.create_task(sample_loop(), name="sensor-sampler")
    app.state.sampler = sampler

    try:
        yield
    finally:
        stop.set()
        if sampler is not None:
            sampler.cancel()
            try:
                await sampler
            except asyncio.CancelledError:
                pass
        await gateway.stop()
        await db.close()


def create_app(
    settings: Settings | None = None,
    *,
    gateway: DeviceGateway | None = None,
    database: Database | None = None,
    voice: WhisperClient | None = None,
) -> FastAPI:
    settings = settings or Settings.load()
    database = database or Database(settings.db_path)
    gateway = gateway or DeviceGateway(settings)
    voice = voice or WhisperClient(settings)
    matcher = IntentMatcher(settings.intents_path)

    app = FastAPI(title="Smart Green Village", version=settings.app_version, lifespan=lifespan)
    app.state.settings = settings
    app.state.db = database
    app.state.gateway = gateway
    app.state.voice = voice
    app.state.matcher = matcher

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(self)"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
            "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; "
            "frame-ancestors 'none'"
        )
        return response

    # ------------------------------------------------------------------
    @app.get("/api/v1/system/health")
    async def system_health(
        gateway: DeviceGateway = Depends(get_gateway),
        voice_client: WhisperClient = Depends(get_voice),
        settings: Settings = Depends(get_settings),
    ):
        readiness = await voice_client.readiness()
        return {
            "status": "ok",
            "app": "Our AI-Powered Smart Green Village",
            "version": settings.app_version,
            "time": _now(),
            "device_mode": settings.device_mode,
            "device_url": settings.device_url if settings.device_mode == "real" else "simulator",
            "physical": gateway.physical,
            "source": {"kind": settings.source_kind, "label": settings.source_label},
            "voice": {
                "ready": readiness["ready"],
                "server_reachable": readiness["server_reachable"],
                "model_name": readiness["model_name"],
            },
            "database": str(settings.db_path),
        }

    # ------------------------------------------------------------------
    @app.get("/api/v1/state")
    async def state(
        mode: str = Query("live", pattern="^(live|demo)$"),
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
    ):
        for event in gateway.drain_events():
            await db.add_event(
                "live", event["kind"], event["title"], event.get("detail", ""),
                event.get("severity", "info"), "device",
            )
        return await gateway.snapshot(mode)

    # ------------------------------------------------------------------
    @app.post("/api/v1/commands")
    async def command(
        body: CommandRequest,
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
    ):
        if body.type not in ALLOWED_COMMANDS:
            raise HTTPException(status_code=422, detail=f"unsupported command type: {body.type}")
        if body.type == "INDICATE_WASTE":
            category = str(body.parameters.get("category", "")).lower()
            if category not in WASTE_CATEGORIES:
                raise HTTPException(status_code=422, detail="INDICATE_WASTE needs category organic, plastic or paper")
            body.parameters["category"] = category
        try:
            result = await gateway.send_command(
                mode=body.mode,
                command_type=body.type,
                parameters=body.parameters,
                request_id=body.request_id,
                source=body.source,
            )
        except RequestReuseError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        ack = result.get("ack") or {}
        reason = ack.get("reason") or (result.get("error") or {}).get("message", "")
        severity = "info" if result["confirmed"] and ack.get("result") == "ACCEPTED" else (
            "warning" if result["confirmed"] else "error"
        )
        await db.add_event(
            body.mode,
            "command",
            f"{body.type.replace('_', ' ').title()} · {ack.get('result', 'UNCONFIRMED')}",
            reason,
            severity,
            body.source,
            {
                "command_id": body.request_id,
                "result": ack.get("result"),
                "confirmed": result["confirmed"],
                "reason_code": ack.get("reason_code"),
            },
        )
        snapshot = await gateway.snapshot(body.mode)
        result["state"] = snapshot
        if not result["confirmed"]:
            return JSONResponse(status_code=503, content=result)
        return result

    # ------------------------------------------------------------------
    @app.get("/api/v1/device/config")
    async def device_config(
        mode: str = Query("live", pattern="^(live|demo)$"),
        gateway: DeviceGateway = Depends(get_gateway),
    ):
        try:
            return await gateway.get_config(mode)
        except DeviceError as exc:
            return error_response(exc)

    @app.put("/api/v1/device/config")
    async def put_device_config(
        body: ConfigPutRequest,
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
    ):
        try:
            saved = await gateway.put_config(body.mode, body.config_revision, body.config)
        except DeviceError as exc:
            return error_response(exc)
        await db.add_event(
            body.mode, "config", "Configuration saved",
            f"Revision {saved.get('config_revision')} acknowledged by the controller.",
            "info", "browser",
        )
        return saved

    @app.post("/api/v1/calibration/soil")
    async def calibrate_soil(
        body: SoilCalibrationRequest,
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
    ):
        if body.dry_raw == body.wet_raw:
            raise HTTPException(status_code=422, detail="dry and wet raw readings must differ")
        try:
            current = await gateway.get_config(body.mode)
            config = current["config"]
            config["soil"]["dry_raw"] = body.dry_raw
            config["soil"]["wet_raw"] = body.wet_raw
            config["soil"]["calibrated"] = True
            saved = await gateway.put_config(body.mode, current["config_revision"], config)
        except DeviceError as exc:
            return error_response(exc)
        await db.add_event(
            body.mode, "config", "Soil calibration saved",
            f"dry={body.dry_raw}, wet={body.wet_raw} (polarity is detected automatically).",
            "info", "browser",
        )
        return saved

    @app.post("/api/v1/calibration/reservoir")
    async def calibrate_reservoir(
        body: ReservoirCalibrationRequest,
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
    ):
        if body.dry_threshold_mv - body.wet_threshold_mv < 100:
            raise HTTPException(status_code=422, detail="dry threshold must be at least 100 mV above wet")
        try:
            current = await gateway.get_config(body.mode)
            config = current["config"]
            config["reservoir"]["wet_threshold_mv"] = body.wet_threshold_mv
            config["reservoir"]["dry_threshold_mv"] = body.dry_threshold_mv
            config["reservoir"]["calibrated"] = True
            saved = await gateway.put_config(body.mode, current["config_revision"], config)
        except DeviceError as exc:
            return error_response(exc)
        await db.add_event(
            body.mode, "config", "Reservoir calibration saved",
            f"wet≤{body.wet_threshold_mv} mV, dry≥{body.dry_threshold_mv} mV.",
            "info", "browser",
        )
        return saved

    # ------------------------------------------------------------------
    @app.get("/api/v1/events")
    async def events(
        mode: str = Query("live", pattern="^(live|demo)$"),
        limit: int = Query(100, ge=1, le=500),
        kind: str | None = Query(None),
        db: Database = Depends(get_db),
    ):
        return {"events": await db.list_events(mode, limit, kind)}

    @app.get("/api/v1/sensors/history")
    async def sensor_history(
        mode: str = Query("live", pattern="^(live|demo)$"),
        minutes: int = Query(30, ge=1, le=180),
        db: Database = Depends(get_db),
    ):
        return {"samples": await db.sensor_history(mode, minutes)}

    # ------------------------------------------------------------------
    @app.get("/api/v1/waste/model-status")
    async def waste_model_status(settings: Settings = Depends(get_settings)):
        return _waste_model_status(settings)

    @app.post("/api/v1/waste/recognition")
    async def waste_recognition(
        body: RecognitionRequest,
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
    ):
        category = body.category.strip().lower()
        if category not in WASTE_CATEGORIES:
            raise HTTPException(status_code=422, detail="category must be organic, plastic, paper or ignored; background is not logged")
        snapshot = await gateway.snapshot(body.mode)
        status = snapshot.get("status") or {}
        bins = {item.get("id"): item for item in (status.get("sensors", {}) or {}).get("bins", [])}
        target = bins.get(category, {})
        bin_state = target.get("state", "unavailable")
        bin_alert = None
        if bin_state == "full":
            bin_alert = {
                "bin_id": category,
                "state": bin_state,
                "message": f"The {category} bin is full. Do not send this item to a different category.",
            }
        indication: dict[str, Any]
        try:
            indication = await gateway.send_command(
                mode=body.mode,
                command_type="INDICATE_WASTE",
                parameters={"category": category, "duration_ms": 8000},
                request_id=body.request_id,
                source="camera",
            )
        except RequestReuseError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        confirmed = bool(indication.get("confirmed") and
                         (indication.get("ack") or {}).get("result") == "ACCEPTED")
        record = await db.add_recognition(
            body.mode, category, body.confidence, body.model, bin_state,
            bool(bin_alert), confirmed, body.request_id, body.profile_id,
        )
        await db.add_event(
            body.mode, "waste", f"{category.title()} recognised",
            f"confidence {body.confidence:.2f}; bin {bin_state}; indicator "
            f"{'confirmed' if confirmed else 'NOT confirmed'}",
            "warning" if bin_alert or not confirmed else "info",
            "camera",
            {"recognition_id": record.get("id"), "category": category,
             "confidence": body.confidence, "bin_state": bin_state},
        )
        return {
            "recognition": record,
            "indication": indication,
            "bin_alert": bin_alert,
            "physical": snapshot.get("physical", False),
            "note": "Recognition is not proof that the item was deposited.",
        }

    @app.post("/api/v1/waste/disposals")
    async def confirm_disposal(
        body: DisposalRequest,
        db: Database = Depends(get_db),
    ):
        if body.profile_id is not None:
            profile = await db.get_profile(body.profile_id)
            if profile is None:
                raise HTTPException(status_code=404, detail="villager profile not found")
        try:
            disposal = await db.confirm_disposal(
                body.mode, body.recognition_id, body.profile_id, body.note
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        await db.add_event(
            body.mode, "waste", "Deposit confirmed",
            f"{disposal['category'].title()} · {disposal['points']} points"
            + (f" · profile {body.profile_id}" if body.profile_id else " · no profile"),
            "info", "browser", {"disposal_id": disposal["id"]},
        )
        profile_payload = await db.get_profile(body.profile_id) if body.profile_id else None
        return {"disposal": disposal, "profile": profile_payload}

    # ------------------------------------------------------------------
    @app.get("/api/v1/profiles")
    async def profiles(db: Database = Depends(get_db)):
        return {
            "profiles": await db.list_profiles(),
            "fictional": True,
            "points_rule": POINTS,
            "note": "These are fictional demonstration records. The camera identifies waste, not people.",
        }

    @app.post("/api/v1/profiles")
    async def create_profile(body: ProfileCreateRequest, db: Database = Depends(get_db)):
        profile = await db.add_profile(body.name, body.house_no, body.avatar)
        return {"profile": profile, "fictional": True}

    @app.get("/api/v1/profiles/{profile_id}")
    async def profile(profile_id: int, db: Database = Depends(get_db)):
        item = await db.get_profile(profile_id)
        if item is None:
            raise HTTPException(status_code=404, detail="villager profile not found")
        return {"profile": item, "fictional": True, "points_rule": POINTS}

    # ------------------------------------------------------------------
    @app.get("/api/v1/voice/intents")
    async def voice_intents(
        language: str = Query("en", pattern="^(en|ml|hi)$"),
        matcher: IntentMatcher = Depends(get_matcher),
    ):
        return {
            "language": language,
            "languages": matcher.languages_meta(),
            "intents": matcher.help_list(language),
            "unknown_message": matcher.unknown_message(language),
            "no_speech_message": matcher.data["no_speech"].get(language, ""),
        }

    @app.get("/api/v1/voice/readiness")
    async def voice_readiness(
        voice: WhisperClient = Depends(get_voice),
        settings: Settings = Depends(get_settings),
    ):
        readiness = await voice.readiness()
        return {
            **readiness,
            "audio_assets": audio_assets(settings),
            "languages": ["en", "ml", "hi"],
        }

    @app.post("/api/v1/voice/transcribe")
    async def voice_transcribe(
        audio: UploadFile = File(...),
        language: str = Form("en"),
        voice: WhisperClient = Depends(get_voice),
        matcher: IntentMatcher = Depends(get_matcher),
        db: Database = Depends(get_db),
        settings: Settings = Depends(get_settings),
    ):
        if language not in {"en", "ml", "hi"}:
            raise HTTPException(status_code=422, detail="language must be en, ml or hi")
        data = await audio.read(settings.voice_max_bytes + 1)
        if len(data) > settings.voice_max_bytes:
            raise HTTPException(status_code=413, detail="recording is too large")
        try:
            transcript = await voice.transcribe(data, language)
            text = transcript["text"]
        except VoiceError as exc:
            if exc.code == "NO_SPEECH":
                return matcher.match("", language)
            raise HTTPException(status_code=exc.status, detail={"code": exc.code, "message": exc.message}) from exc
        result = matcher.match(text, language)
        await db.add_event(
            "live" if not settings.device_is_simulator else "live",
            "voice",
            "Voice command recognised" if result["reason"] == "matched" else "Voice command rejected",
            f"“{text}” → {result['intent']}"
            + (f" ({result['matched_phrase']})" if result.get("matched_phrase") else "")
            + f" · {result['reason']}",
            "info" if result["reason"] == "matched" else "warning",
            "voice",
            {"intent": result["intent"], "reason": result["reason"],
             "confidence": result["confidence"], "transcript": text, "language": language},
        )
        result["transcript"] = text
        return result

    # ------------------------------------------------------------------
    @app.get("/api/v1/settings")
    async def get_app_settings(db: Database = Depends(get_db)):
        return {"settings": await db.get_settings(), "defaults": DEFAULT_SETTINGS}

    @app.put("/api/v1/settings")
    async def put_app_settings(body: AppSettingsUpdate, db: Database = Depends(get_db)):
        values = body.model_dump(exclude_none=True)
        saved = await db.put_settings(values)
        return {"settings": saved, "saved": True}

    # ------------------------------------------------------------------
    @app.get("/api/v1/setup/checklist")
    async def setup_checklist(
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
        voice: WhisperClient = Depends(get_voice),
        settings: Settings = Depends(get_settings),
    ):
        snapshot = await gateway.snapshot("live")
        status = snapshot.get("status") or {}
        sensors = status.get("sensors", {})
        actuators = status.get("actuators", {})
        readiness = await voice.readiness()
        model = _waste_model_status(settings)
        checks = [
            {
                "id": "device",
                "label": "Controller reachable",
                "status": "ok" if snapshot["connection"]["connected"] else "missing",
                "detail": snapshot["connection"].get("last_error") or settings.source_label,
                "required": True,
            },
            {
                "id": "soil",
                "label": "Soil calibrated",
                "status": "ok" if sensors.get("soil", {}).get("calibrated") else "warn",
                "detail": "Two raw endpoints captured from the real probe."
                if sensors.get("soil", {}).get("calibrated") else "Capture dry and wet readings on Sensors.",
                "required": True,
            },
            {
                "id": "reservoir",
                "label": "Reservoir calibrated",
                "status": "ok" if sensors.get("reservoir", {}).get("calibrated") else "warn",
                "detail": "Wet and dry millivolt endpoints captured."
                if sensors.get("reservoir", {}).get("calibrated") else "Calibrate the two wire probes.",
                "required": True,
            },
            {
                "id": "pump",
                "label": "Pump commissioned",
                "status": "ok" if actuators.get("pump", {}).get("commissioned") and actuators.get("pump", {}).get("enabled") else "warn",
                "detail": "Both the build flag and runtime switch are on."
                if actuators.get("pump", {}).get("commissioned") and actuators.get("pump", {}).get("enabled")
                else "Complete docs/bench-test.md before enabling the pump.",
                "required": True,
            },
            {
                "id": "voice",
                "label": "Whisper ready",
                "status": "ok" if readiness["ready"] else "missing",
                "detail": readiness["message"],
                "required": True,
            },
            {
                "id": "waste_model",
                "label": "Waste model installed",
                "status": "ok" if model["installed"] else "missing",
                "detail": model["message"],
                "required": True,
            },
            {
                "id": "audio",
                "label": "Prepared reply audio",
                "status": "ok" if audio_assets(settings)["count"] > 0 else "warn",
                "detail": "Optional. Browser speech synthesis is the fallback.",
                "required": False,
            },
        ]
        return {
            "items": checks,
            "ready": all(item["status"] == "ok" for item in checks if item["required"]),
            "physical_ready": bool(snapshot["physical"] and all(
                item["status"] == "ok" for item in checks
                if item["id"] in {"device", "soil", "reservoir", "pump"}
            )),
            "demo_ready": True,
        }

    # ------------------------------------------------------------------
    @app.get("/api/v1/device/health")
    async def device_health(
        mode: str = Query("live", pattern="^(live|demo)$"),
        gateway: DeviceGateway = Depends(get_gateway),
    ):
        return await gateway.device_health(mode)

    @app.post("/api/v1/demo/scenario")
    async def demo_scenario(
        body: ScenarioRequest,
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
    ):
        status = gateway.demo_scenario(body.model_dump(exclude_none=True))
        await db.add_event(
            "demo", "demo", "Demo scenario changed",
            "Simulated conditions updated. No physical output is affected.",
            "info", "demo",
        )
        return {"status": status, "physical": False}

    @app.post("/api/v1/demo/reset")
    async def demo_reset(
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
    ):
        status = gateway.demo_reset()
        await db.add_event("demo", "demo", "Demo reset", "The simulated village was reset.", "info", "demo")
        return {"status": status, "physical": False}

    @app.post("/api/v1/simulator/scenario")
    async def simulator_scenario(
        body: ScenarioRequest,
        gateway: DeviceGateway = Depends(get_gateway),
    ):
        try:
            status = gateway.simulator_scenario(body.model_dump(exclude_none=True))
        except SimulatorError as exc:
            return JSONResponse(status_code=exc.status, content=exc.payload)
        return {"status": status, "physical": False}

    # ------------------------------------------------------------------
    # Static frontend
    # ------------------------------------------------------------------
    if settings.models_dir.is_dir():
        app.mount("/models", StaticFiles(directory=settings.models_dir), name="models")

    dist = settings.dist_dir
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    if (dist / "audio").is_dir():
        app.mount("/audio", StaticFiles(directory=dist / "audio"), name="audio")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"error": {"code": "NOT_FOUND", "message": "unknown endpoint"}})
        if dist.is_dir():
            candidate = (dist / full_path).resolve()
            try:
                candidate.relative_to(dist.resolve())
            except ValueError:
                return JSONResponse(status_code=404, content={"error": {"code": "NOT_FOUND", "message": "not found"}})
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            index = dist / "index.html"
            if index.is_file():
                return FileResponse(index)
        return HTMLResponse(
            "<html><body style='font-family:sans-serif;background:#12100f;color:#f2e8d5;padding:2rem'>"
            "<h1>Smart Green Village</h1>"
            "<p>The API is running. Build the dashboard with:</p>"
            "<pre>cd web/frontend &amp;&amp; npm install &amp;&amp; npm run build</pre>"
            "<p>Or run the dev server with <code>npm run dev</code>.</p>"
            "</body></html>"
        )

    return app


app = create_app()
