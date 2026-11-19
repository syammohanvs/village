from __future__ import annotations

import asyncio
import hmac
import time
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from .auth import COOKIE_NAME, GUEST_USERNAME, Sessions, verify_password
from .config import Settings
from .db import Database, DEFAULT_SETTINGS, POINTS
from . import ml_asr, vision, voice_clips, waste_resnet
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
    TEST_OUTPUTS,
    WASTE_CATEGORIES,
    AppSettingsUpdate,
    CommandRequest,
    ConfigPutRequest,
    DisposalRequest,
    ProfileCreateRequest,
    RecognitionRequest,
    ReservoirCalibrationRequest,
    ScenarioRequest,
    SpeakRequest,
    SoilCalibrationRequest,
    VoiceInterpretRequest,
    LoginRequest,
    WasteClassifyRequest,
    WasteCorrectionRequest,
)
from .simulator import SimulatorError
from .tts import PiperTts, TtsError
from .voice import VoiceError, WhisperClient, audio_assets, wav_info

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


def get_tts(request: Request) -> PiperTts:
    return request.app.state.tts


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
            # A Teachable Machine export writes labels as plain strings.  Some
            # hand-written metadata uses objects with a "name", so accept both
            # rather than reporting a real model as "not installed".
            labels = []
            for item in metadata.get("labels", []):
                if isinstance(item, dict):
                    labels.append(str(item.get("name", "")))
                else:
                    labels.append(str(item))
        except Exception as exc:  # noqa: BLE001 - surfaced to the operator
            error = f"metadata.json could not be read: {exc}"
    return {
        "installed": installed and error is None,
        "folder": str(folder),
        "url_path": "/models/waste/",
        "files": files,
        "missing": [name for name, present in files.items() if not present],
        "labels": labels,
        "expected_labels": [
            "Organic", "Plastic", "Paper", "Glass", "Metal", "Textile",
            "Leather", "Footwear", "Thermocol", "Ewaste", "Background",
        ],
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
    if not settings.auth_enabled:
        log.warning(
            "sign-in is switched off (VILLAGE_AUTH_ENABLED=false): every screen is open"
        )
    elif settings.admin_password_default:
        # Said out loud at every start, because a default password is exactly
        # the thing everybody means to change and nobody comes back to.
        log.warning(
            "the sign-in password for %r is the built-in default — "
            "set VILLAGE_ADMIN_PASSWORD in .env before the exhibit is public",
            settings.admin_user,
        )
    else:
        log.info("sign-in is on for %r", settings.admin_user)

    if voice_clips.enabled(settings):
        # Said out loud, because a folder of visitors' voices is a fact an
        # operator should know without reading `.env` — and because the policy
        # is what keeps it from growing.
        log.info(
            "keep the last %d voice recordings in %s (at most %d MB, pruned on every save)",
            settings.voice_clips,
            settings.voice_clip_dir,
            settings.voice_clip_bytes // (1024 * 1024),
        )
    else:
        log.info("voice recordings are not kept (VILLAGE_VOICE_CLIPS=0 or no directory)")

    waste_resnet.configure(settings)
    await db.init()
    if settings.share_link_enabled:
        # Created once and then fixed (see `Database.share_key`): a link that
        # changed on every restart would be a link that reports 403 tomorrow.
        app.state.share_key = await db.share_key()
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
    tts: PiperTts | None = None,
) -> FastAPI:
    settings = settings or Settings.load()
    # The Malayalam fine-tune, if this machine has it.  `available()` decides;
    # the route falls back to whisper-server when it does not.
    ml_asr.configure(settings.ml_asr_dir)
    database = database or Database(settings.db_path)
    gateway = gateway or DeviceGateway(settings)
    voice = voice or WhisperClient(settings)
    matcher = IntentMatcher(settings.intents_path)

    app = FastAPI(title="Smart Green Village", version=settings.app_version, lifespan=lifespan)
    app.state.settings = settings
    app.state.db = database
    app.state.gateway = gateway
    app.state.voice = voice
    app.state.tts = tts or PiperTts(settings)
    app.state.matcher = matcher
    sessions = Sessions(
        settings.admin_user,
        settings.admin_password_hash,
        hours=settings.session_hours,
    )
    app.state.sessions = sessions
    # Filled by the lifespan when the share link is on; always present so a
    # route never has to guess whether the attribute exists.
    app.state.share_key = None

    # A frontend served from another origin (Cloudflare Pages, a tunnel) talks
    # to this backend cross-origin.  The allowed origins are listed in
    # VILLAGE_CORS_ORIGINS (comma-separated); localhost is always allowed so
    # the normal dev case needs no configuration.  Credentials are on, because
    # the session is a cookie.
    # A frontend served from another origin (Cloudflare Pages, a public host)
    # talks to this backend cross-origin.  `https://*.pages.dev` is in the
    # default list because that is the hosted copy this repository builds to:
    # without it the deployed page cannot read a single card.  Anything with a
    # `*` becomes an origin *pattern*; exact origins stay exact.
    raw_origins = [
        origin.strip()
        for origin in os.getenv(
            "VILLAGE_CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,https://*.pages.dev",
        ).split(",")
        if origin.strip()
    ]
    cors_origins = [origin for origin in raw_origins if "*" not in origin]
    patterns = [origin for origin in raw_origins if "*" in origin]
    allow_origin_regex = (
        "^(" + "|".join(re.escape(p).replace(r"\*", ".*") for p in patterns) + ")$"
        if patterns
        else None
    )
    # A bare "*" is not allowed with credentials (the spec forbids it and the
    # browser refuses), so it means "any origin, no cookies".  The session is a
    # cookie *or* a bearer token; the token is what a cross-origin page uses.
    allow_credentials = "*" not in raw_origins

    def session_token(request: Request) -> str | None:
        """The session, from `Authorization: Bearer` or from the cookie.

        The cookie is the normal case (the exhibit and the backend's own copy of
        the page are one origin).  A page served from Cloudflare Pages is a
        *different* origin, where a third-party cookie is refused by the browser
        - so there the sign-in and the share link both hand back the same signed
        token in the body, and the page sends it as a bearer.
        """
        header = request.headers.get("authorization") or ""
        if header[:7].lower() == "bearer ":
            token = header[7:].strip()
            if token:
                return token
        return request.cookies.get(COOKIE_NAME)

    # A handful of failures per address, then a minute's pause.  Not an
    # authentication system's lockout -- just enough that guessing by hand is
    # slower than reading the password off the laptop.
    login_failures: dict[str, tuple[int, float]] = {}
    LOGIN_FREE_TRIES = 5
    LOGIN_PAUSE_S = 60.0

    PUBLIC_PATHS = {
        "/api/v1/auth/login",
        "/api/v1/auth/session",
        "/api/v1/system/health",
        # The share link.  Opening it is the whole point, so it cannot sit
        # behind the cookie it is about to issue.
        "/api/v1/auth/magic",
    }

    # What a share-link visitor may do besides read.  Everything here is the
    # visitor page: a command (Simulation only - checked in the route), the two
    # simulation knobs, the waste classifier and Sara.  Anything else is an
    # operator action and is refused, so a student holding the link cannot
    # calibrate a probe, save settings or run the bench panel.
    GUEST_POST_PATHS = {
        "/api/v1/commands",
        "/api/v1/demo/scenario",
        "/api/v1/demo/reset",
        "/api/v1/simulator/scenario",
        "/api/v1/waste/classify",
        "/api/v1/waste/identify",
        "/api/v1/waste/recognition",
        "/api/v1/voice/speak",
        "/api/v1/voice/interpret",
        "/api/v1/voice/transcribe",
        "/api/v1/auth/logout",
    }

    @app.middleware("http")
    async def require_session(request: Request, call_next):
        """One account guards the API; the SPA shell itself stays public.

        The dashboard needs to load in order to *show* the login form, so the
        static files and the SPA fallback are open.  Everything under /api/v1
        needs the cookie, except the three routes above (the form has to be able
        to ask "am I signed in?" and to post the password) and the health probe.
        """
        if not settings.auth_enabled:
            return await call_next(request)
        if request.method == "OPTIONS":
            # A preflight carries no credentials by definition; the request it
            # asks about is checked when it is actually made.
            return await call_next(request)
        path = request.url.path
        if not path.startswith("/api/") or path in PUBLIC_PATHS:
            return await call_next(request)
        user = sessions.read(session_token(request))
        if user is None:
            return JSONResponse({"detail": "sign in to continue"}, status_code=401)
        if user == GUEST_USERNAME:
            # The share link is a look, not a hand.  Reads are fine; writes are
            # limited to the visitor page and to Simulation.
            if request.method not in {"GET", "HEAD", "OPTIONS"} and path not in GUEST_POST_PATHS:
                return JSONResponse(
                    {"detail": "a shared link can only use the visitor page in Simulation"},
                    status_code=403,
                )
        return await call_next(request)

    # Registered after the two middlewares above on purpose: Starlette applies
    # them inside-out, so this one is outermost.  A preflight is then answered
    # before the session check, and a 401 still carries the CORS headers -
    # without which the browser reports "failed to fetch" instead of "sign in".
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_origin_regex=allow_origin_regex,
        allow_credentials=allow_credentials,
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
        connect_sources = " ".join(["'self'"] + cors_origins)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
            "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; connect-src " + connect_sources + "; "
            "font-src 'self' data:; frame-ancestors 'none'"
        )
        # The SPA shell must never be cached: it names the hashed bundle, so a
        # cached copy keeps serving the previous build after a rebuild.  The
        # hashed assets under /assets are the opposite — they can never change,
        # so let the browser keep them.
        path = request.url.path
        if path.startswith("/assets/") and response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Cache-Control"] = "no-store"
        return response

    # ------------------------------------------------------------------
    @app.post("/api/v1/auth/login")
    async def auth_login(request: Request, body: LoginRequest):
        address = request.client.host if request.client else "?"
        failures, paused_until = login_failures.get(address, (0, 0.0))
        now = time.monotonic()
        if failures >= LOGIN_FREE_TRIES and now < paused_until:
            raise HTTPException(
                status_code=429,
                detail="too many attempts; wait a minute and try again",
            )
        user = body.username.strip()
        if user != settings.admin_user or not verify_password(
            body.password, settings.admin_password_hash
        ):
            failures = failures + 1 if now < paused_until or failures else failures + 1
            login_failures[address] = (failures, now + LOGIN_PAUSE_S if failures >= LOGIN_FREE_TRIES else paused_until)
            # One sentence for both halves: which of the two was wrong is not a
            # stranger's to learn.
            raise HTTPException(status_code=401, detail="that username and password do not match")

        login_failures.pop(address, None)
        token = sessions.issue()
        response = JSONResponse(
            {
                "authenticated": True,
                "username": settings.admin_user,
                # The same signed token the cookie carries.  A page on another
                # origin cannot rely on the cookie, so it keeps this and sends
                # `Authorization: Bearer`.  Same secret, same expiry.
                "token": token,
            }
        )
        set_session_cookie(request, response, token)
        return response

    @app.post("/api/v1/auth/logout")
    async def auth_logout() -> dict[str, Any]:
        response = JSONResponse({"authenticated": False})
        response.delete_cookie(COOKIE_NAME, path="/")
        return response

    @app.get("/api/v1/auth/session")
    async def auth_session(request: Request) -> dict[str, Any]:
        user = sessions.read(session_token(request))
        return {
            "authenticated": user is not None,
            "username": user,
            "auth_enabled": settings.auth_enabled,
            # A share-link visit.  The page locks Live and Test for it, and the
            # server refuses a live command from the same cookie.
            "guest": user == GUEST_USERNAME,
        }

    # ------------------------------------------------------------------
    def set_session_cookie(request: Request, response: Response, token: str) -> None:
        """The cookie, for a page this backend serves itself.

        Decided from the request rather than from the CORS list: an https origin
        in that list (the hosted copy) must not turn the *local* http cookie
        into a `Secure` one, which the browser would simply drop.
        """
        secure = request.url.scheme == "https"
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=sessions.ttl,
            httponly=True,
            samesite="none" if secure else "lax",
            secure=secure,
            path="/",
        )

    @app.get("/api/v1/auth/magic")
    async def auth_magic(request: Request, key: str = Query("", max_length=128)):
        """The share link: a cookie for a Simulation-only visit, then the app.

        The key is kept in the database (`Database.share_key`) so that a restart
        cannot break a link that was handed out, and Setup can rotate it on
        demand.  This is a convenience gate for a demo, not the account: see
        `GUEST_USERNAME` and the middleware above.
        """
        expected = request.app.state.share_key if settings.share_link_enabled else None
        if expected is None:
            raise HTTPException(status_code=404, detail="the share link is switched off")
        if not key or not hmac.compare_digest(key, expected):
            raise HTTPException(status_code=403, detail="that share link is not valid")
        response = RedirectResponse(url="/?mode=demo", status_code=303)
        set_session_cookie(request, response, sessions.issue(as_guest=True))
        return response

    @app.post("/api/v1/auth/magic")
    async def auth_magic_token(request: Request, body: dict[str, Any] | None = None):
        """The same exchange for a page on another origin.

        A share link handed to someone using the Cloudflare-hosted copy cannot
        use the redirect: that would navigate them off the hosted page.  This
        answers with the signed token instead, which the page sends as a
        bearer - no third-party cookie involved.
        """
        key = str((body or {}).get("key") or "").strip()
        expected = request.app.state.share_key if settings.share_link_enabled else None
        if expected is None:
            raise HTTPException(status_code=404, detail="the share link is switched off")
        if not key or not hmac.compare_digest(key, expected):
            raise HTTPException(status_code=403, detail="that share link is not valid")
        token = sessions.issue(as_guest=True)
        response = JSONResponse(
            {
                "authenticated": True,
                "username": GUEST_USERNAME,
                "guest": True,
                "token": token,
            }
        )
        set_session_cookie(request, response, token)
        return response

    def share_link_body(request: Request) -> dict[str, Any]:
        base = str(request.base_url).rstrip("/")
        key = request.app.state.share_key if settings.share_link_enabled else ""
        return {
            "enabled": settings.share_link_enabled,
            "guest": GUEST_USERNAME,
            # `key` as well as `url`: a page served from another origin builds
            # its own link (`?api=…&share=…`) from it and cannot use the direct
            # one, which belongs to this origin.
            "key": key,
            "url": f"{base}/api/v1/auth/magic?key={key}" if key else "",
        }

    @app.get("/api/v1/auth/share-link")
    async def auth_share_link(request: Request) -> dict[str, Any]:
        """The link itself, for the operator to copy out of Setup.

        It lives behind the account on purpose: anybody who can read this can
        hand out a Simulation session, and that is the operator's call.
        """
        return share_link_body(request)

    @app.post("/api/v1/auth/share-link")
    async def auth_share_link_new(
        request: Request, db: Database = Depends(get_db)
    ) -> dict[str, Any]:
        """A new key: every copy handed out before this stops working."""
        if not settings.share_link_enabled:
            raise HTTPException(status_code=404, detail="the share link is switched off")
        request.app.state.share_key = await db.rotate_share_key()
        return share_link_body(request)

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
        request: Request,
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
    ):
        if body.type not in ALLOWED_COMMANDS:
            raise HTTPException(status_code=422, detail=f"unsupported command type: {body.type}")
        if sessions.read(session_token(request)) == GUEST_USERNAME and body.mode != "demo":
            # The share link is Simulation-only.  The page already locks Live
            # and Test, but a page is not the place to enforce this.
            raise HTTPException(status_code=403, detail="a shared link can only use Simulation")
        if body.type == "TEST_MODE":
            body.parameters["on"] = bool(body.parameters.get("on"))
        if body.type == "TEST_OUTPUT":
            output = str(body.parameters.get("output", "")).lower()
            if output not in TEST_OUTPUTS:
                raise HTTPException(
                    status_code=422,
                    detail="TEST_OUTPUT needs output pump, led_organic, led_plastic, led_paper or streetlights",
                )
            body.parameters["output"] = output
            body.parameters["on"] = bool(body.parameters.get("on"))
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

    @app.get("/api/v1/waste/resnet-status")
    async def waste_resnet_status():
        return {**waste_resnet.status(), "captures": waste_resnet.captures(), "vision": vision.status()}

    @app.get("/api/v1/waste/captures")
    async def waste_captures():
        """The crops the camera has sent, kept for fixing a misread.

        The filename carries the time, the class chosen and its confidence, so a
        directory listing answers "what did it call that?" without opening the
        index.
        """
        return waste_resnet.captures()

    @app.post("/api/v1/waste/classify")
    async def waste_classify(body: WasteClassifyRequest):
        """Classify one 224x224 frame with ResNet50 on this laptop's CPU.

        The browser cannot load PyTorch, so the camera sends the crop here
        instead of running MobileNetV1 locally.  Returns the raw 11-class
        distribution; the grouping into bin / recycler / background happens in
        the page, exactly as it did for the browser model.
        """
        try:
            predictions = await asyncio.to_thread(waste_resnet.classify, body.image)
        except waste_resnet.WasteModelError as exc:
            raise HTTPException(
                status_code=exc.status,
                detail={"code": exc.code, "message": exc.message},
            ) from exc
        # `file` is the crop that was just kept, so the page can point a
        # correction at it instead of guessing which frame it meant.
        return {"model": "resnet50", "predictions": predictions, "file": waste_resnet.last_capture()}

    @app.post("/api/v1/waste/identify")
    async def waste_identify(body: WasteClassifyRequest):
        """Name the object in the same crop, with a hosted vision model.

        The classifier answers with a *material*; a visitor asks what the thing
        is.  This is that second answer, and it is deliberately only a name: the
        bin stays the local classifier's decision, because measured on the venue
        probe a vision model is 53.7 % exact against its 70.7 %.

        Always 200.  When no provider is configured, or the model fails, `object`
        is null and the page shows the classifier alone — the behaviour before
        this existed.
        """
        return await asyncio.to_thread(vision.identify, body.image)

    @app.post("/api/v1/waste/correction")
    async def waste_correction(body: WasteCorrectionRequest):
        """File a judged crop under the class the operator says it really is.

        One press per mistake, and the venue's own photo joins the training tree
        (`data/waste-samples/<Class>/`), which is what
        `train_handheld_head.py --extra-train` reads.
        """
        try:
            return await asyncio.to_thread(waste_resnet.label_capture, body.file, body.actual)
        except waste_resnet.WasteModelError as exc:
            raise HTTPException(
                status_code=exc.status,
                detail={"code": exc.code, "message": exc.message},
            ) from exc

    @app.post("/api/v1/waste/recognition")
    async def waste_recognition(
        body: RecognitionRequest,
        gateway: DeviceGateway = Depends(get_gateway),
        db: Database = Depends(get_db),
    ):
        category = body.category.strip().lower()
        # What the model named, kept with the record.  A recycler is posted as
        # "other", so without this there is no way to answer "what did it call
        # my key fob?" after the event.
        observed = {
            "material": body.material,
            "top": (body.top or [])[:3],
        }
        if category not in WASTE_CATEGORIES and category not in {"other", "medical"}:
            raise HTTPException(
                status_code=422,
                detail="category must be organic, plastic, paper, other or medical; background is not logged",
            )
        if category == "medical":
            # Hazardous waste (syringes, cotton, napkins, diapers, catheters,
            # urine bags) is not one of the three bins and must never be sent
            # to a bin LED.  It is recorded and referred to the Gram Sahayak.
            # `allow_poll=False`: the board is a convenience here, not part of
            # the answer.  Waiting for a controller that is switched off held
            # the whole recognition -- and therefore Sara's sentence -- for
            # 19-21 s, measured.
            try:
                snapshot = await gateway.snapshot(body.mode, allow_poll=False)
            except Exception:  # noqa: BLE001 - a referral does not need the board
                snapshot = {}
            record = await db.add_recognition(
                body.mode, category, body.confidence, body.model,
                False, body.request_id, body.profile_id,
            )
            await db.add_event(
                body.mode, "waste", "Hazardous waste recognised",
                f"confidence {body.confidence:.2f}; referred to the Gram Sahayak; "
                "no bin indicator used",
                "warning",
                "camera",
                {"recognition_id": record.get("id"), "category": category,
                 "confidence": body.confidence, **observed},
            )
            return {
                "recognition": record,
                "indication": None,
                "physical": snapshot.get("physical", False),
                "note": "Hazardous waste. Do not put it in the organic, plastic or paper bins. Hand it to the Gram Sahayak.",
            }
        if category == "other":
            # Cloth, leather, footwear, glass, metal, thermocol and electronic
            # waste are not one of the three bins.  They are recorded and
            # referred to the recycling agent, and no INDICATE_WASTE command is
            # sent, so no bin LED can light for them.
            try:
                snapshot = await gateway.snapshot(body.mode, allow_poll=False)
            except Exception:  # noqa: BLE001 - a referral does not need the board
                snapshot = {}
            record = await db.add_recognition(
                body.mode, category, body.confidence, body.model,
                False, body.request_id, body.profile_id,
            )
            await db.add_event(
                body.mode, "waste", "Recyclable item recognised",
                f"confidence {body.confidence:.2f}; referred to the recycling agent; "
                "no bin indicator used",
                "info",
                "camera",
                {"recognition_id": record.get("id"), "category": category,
                 "confidence": body.confidence, **observed},
            )
            return {
                "recognition": record,
                "indication": None,
                "physical": snapshot.get("physical", False),
                "note": "Not one of the three bins. Hand it to the recycling agent and contact the Gram Sahayak.",
            }
        # Bins have indicator LEDs and nothing else: no level sensing, no fill
        # percentage and no "bin full" alert.  The LED command below is the
        # whole physical outcome, and it fails fast and says so.
        snapshot = await gateway.snapshot(body.mode, allow_poll=False)
        indication: dict[str, Any] | None
        led_reason: str | None = None
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
        except Exception as exc:  # noqa: BLE001
            # The board is a convenience for the LED; the answer is not.  This
            # used to fail the whole request, so with the controller off the
            # page showed an error instead of the bin it had just decided on --
            # while a referral (which never touches the board) answered fine
            # (reported 2026-11-16).  Classifying without the board is a
            # legitimate mode: the camera and the model live on this laptop.
            indication = None
            led_reason = str(exc) or "the controller did not answer"
        confirmed = bool(indication and indication.get("confirmed") and
                         (indication.get("ack") or {}).get("result") == "ACCEPTED")
        record = await db.add_recognition(
            body.mode, category, body.confidence, body.model,
            confirmed, body.request_id, body.profile_id,
        )
        await db.add_event(
            body.mode, "waste", f"{category.title()} recognised",
            f"confidence {body.confidence:.2f}; {category} indicator "
            f"{'confirmed' if confirmed else 'NOT confirmed'}",
            "warning" if not confirmed else "info",
            "camera",
            {"recognition_id": record.get("id"), "category": category,
             "confidence": body.confidence},
        )
        return {
            "recognition": record,
            "indication": indication,
            "physical": snapshot.get("physical", False),
            "led_note": None if indication else (
                f"No bin LED was lit: {led_reason}. The sorting answer above still applies."
            ),
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
        handed_over = disposal["category"] == "other"
        await db.add_event(
            body.mode, "waste",
            "Recyclable item handed over" if handed_over else "Deposit confirmed",
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
            "help_order": matcher.data.get("help_order", []),
            "unknown_message": matcher.unknown_message(language),
            "no_speech_message": matcher.data["no_speech"].get(language, ""),
            # The panel speaks these when the controller is unreachable or does
            # not confirm; they live beside the rest of the wording so a
            # language cannot be half-translated.
            "messages": matcher.data.get("messages", {}),
        }

    @app.get("/api/v1/voice/readiness")
    async def voice_readiness(
        voice: WhisperClient = Depends(get_voice),
        settings: Settings = Depends(get_settings),
        request_tts: PiperTts = Depends(get_tts),
    ):
        readiness = await voice.readiness()
        return {
            **readiness,
            "audio_assets": audio_assets(settings),
            "tts": request_tts.readiness(),
            # What is on disk of the last few recordings, and the policy that
            # keeps it bounded — one `curl /voice/readiness` answers both
            # "is it keeping clips?" and "how much room do they take?".
            "clips": voice_clips.status(settings),
            "languages": ["en", "ml", "hi"],
        }

    @app.post("/api/v1/voice/speak")
    async def voice_speak(
        body: SpeakRequest,
        tts: PiperTts = Depends(get_tts),
    ):
        if body.language not in {"en", "ml", "hi"}:
            raise HTTPException(status_code=422, detail="language must be en, ml or hi")
        # What was said, and in which voice.  A "weird accent" is a question
        # about one sentence, and without this line the log can only show that
        # an utterance was requested, not what it was.
        log.info(
            "tts speak language=%s voice=%s chars=%d text=%r",
            body.language,
            getattr(tts, "voice_for", lambda _language, _variant=None: "")(body.language, body.voice)
            or "-",
            len(body.text or ""),
            (body.text or "")[:80],
        )
        try:
            audio_path = await tts.synthesize(
                body.text, body.language, body.length_scale, body.voice
            )
        except TtsError as exc:
            return JSONResponse(
                status_code=exc.status,
                content={"error": {"code": exc.code, "message": exc.message}},
            )
        return FileResponse(
            audio_path,
            media_type="audio/wav",
            headers={"Cache-Control": "private, max-age=86400"},
        )

    @app.post("/api/v1/voice/interpret")
    async def voice_interpret(
        body: VoiceInterpretRequest,
        matcher: IntentMatcher = Depends(get_matcher),
        db: Database = Depends(get_db),
    ):
        """Parse typed text with the parser speech uses.

        Kept separate from /translate so a keyboard user is not forced through
        the microphone, and so both paths provably share one set of rules.
        """
        result = matcher.match(body.text, body.language)
        await db.add_event(
            "live",
            "voice",
            "Text command recognised" if result["reason"] == "matched" else "Text command rejected",
            f"“{body.text}” → {result['intent']} · {result['reason']}",
            "info" if result["reason"] == "matched" else "warning",
            "voice",
            {"intent": result["intent"], "reason": result["reason"],
             "kind": result["kind"], "transcript": body.text, "language": body.language},
        )
        result["transcript"] = body.text
        return result

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
        # Keep the recording **before** it is transcribed, so a sentence the
        # model cannot read at all is still on disk to be listened to and re-run
        # (asked for 2026-11-18).  Bounded and pruned by `voice_clips`; a
        # failure to save is swallowed there, because the answer matters more
        # than the record.
        clip = voice_clips.save(data, language=language, settings=settings)
        try:
            # `wav_info` is a module function, not a method of the client — the
            # first version asked the client and every sidecar said null.
            duration_s = wav_info(data)["duration_s"]
        except Exception:  # noqa: BLE001 - a malformed clip is the answer's problem
            duration_s = None
        # Malayalam first goes to its own model.  The multilingual whisper model
        # cannot write Malayalam — it spells the sounds in Tamil letters — so a
        # spoken sentence there was mostly lost (measured 2026-11-18).  Any
        # failure falls back to whisper-server rather than failing the request:
        # a missing model must never stop the exhibit from listening.
        engine = "whisper"
        text: str | None = None
        if language == "ml" and ml_asr.available():
            try:
                text = await asyncio.to_thread(ml_asr.transcribe, data)
                engine = "malayalam-asr"
            except Exception as exc:  # noqa: BLE001 - fall back, never fail
                log.warning("Malayalam speech model failed (%s); using whisper", exc)
                text = None
        if text is None:
            try:
                transcript = await voice.transcribe(data, language)
                text = transcript["text"]
            except VoiceError as exc:
                if exc.code == "NO_SPEECH":
                    empty = matcher.match("", language)
                    voice_clips.annotate(
                        clip, language=language, engine=engine, text="", result=empty,
                        duration_s=duration_s,
                    )
                    return empty
                voice_clips.annotate(
                    clip, language=language, engine=engine, text="",
                    result={"intent": "UNKNOWN", "reason": exc.code}, duration_s=duration_s,
                )
                raise HTTPException(status_code=exc.status, detail={"code": exc.code, "message": exc.message}) from exc
        elif not text.strip():
            empty = matcher.match("", language)
            voice_clips.annotate(
                clip, language=language, engine=engine, text="", result=empty,
                duration_s=duration_s,
            )
            return empty
        result = matcher.match(text, language)
        voice_clips.annotate(
            clip, language=language, engine=engine, text=text, result=result,
            duration_s=duration_s,
        )
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
             "confidence": result["confidence"], "transcript": text,
             "language": language, "engine": engine},
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
                "label": "Pump",
                "status": "ok" if actuators.get("pump", {}).get("enabled") else "warn",
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
