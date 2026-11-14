from __future__ import annotations

import asyncio
import inspect
import json
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

import httpx
from urllib.parse import urlparse

from .config import Settings
from .simulator import SimulatedDevice, SimulatorError


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class DeviceUnreachable(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class DeviceError(Exception):
    def __init__(self, status: int, code: str, message: str, payload: dict[str, Any] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.payload = payload or {}


class RequestReuseError(Exception):
    pass


def candidate_hosts(base_url: str) -> list[str]:
    """The addresses worth trying, the configured one first.

    The board's address is DHCP and it moves -- it has been .8, .6 and .4 on this
    deployment, and every move turned the app dead until somebody edited `.env`
    and restarted.  A controller that answers `/api/v1/status` with our token is
    unmistakable, so the way back is to ask the neighbourhood.
    """
    try:
        host = urlparse(base_url).hostname or ""
    except ValueError:
        return []
    parts = host.split(".")
    if len(parts) != 4 or not all(part.isdigit() for part in parts):
        return []
    octets = [int(part) for part in parts]
    if any(octet < 0 or octet > 255 for octet in octets):
        return []
    prefix = octets[:3]
    rest = [f"{prefix[0]}.{prefix[1]}.{prefix[2]}.{i}" for i in range(1, 255)]
    rest.remove(host)
    return [host, *rest]


async def discover_device(
    base_url: str,
    token: str,
    *,
    timeout: float = 0.7,
    concurrency: int = 48,
    prober: Callable[[str], Awaitable[bool]] | None = None,
) -> str | None:
    """Find the controller that answers our device API, or None.

    Only a `200` from `/api/v1/status` counts, and the request carries the
    device token, so a printer or a Windows box on the same network is not
    mistaken for the board.  `prober` exists so the sweep can be tested without
    a network.
    """
    hosts = candidate_hosts(base_url)
    if not hosts:
        return None
    probe = prober or _http_prober(token, timeout)
    if await probe(hosts[0]):
        return f"http://{hosts[0]}"
    semaphore = asyncio.Semaphore(concurrency)

    async def one(host: str) -> str | None:
        async with semaphore:
            return host if await probe(host) else None

    tasks = [asyncio.create_task(one(host)) for host in hosts[1:]]
    try:
        for finished in asyncio.as_completed(tasks):
            found = await finished
            if found:
                return f"http://{found}"
    finally:
        for task in tasks:
            task.cancel()
    return None


def _http_prober(token: str, timeout: float) -> Callable[[str], Awaitable[bool]]:
    async def probe(host: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=timeout, headers={"X-Device-Token": token}) as client:
                response = await client.get(f"http://{host}/api/v1/status")
        except Exception:  # noqa: BLE001 - an address that does not answer is the normal case
            return False
        return response.status_code == 200

    return probe


class HttpDevice:
    """The real ESP32 over local Wi-Fi.  The token never reaches the browser."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.device_url
        self._client = httpx.AsyncClient(
            base_url=settings.device_url,
            timeout=settings.device_timeout_s,
            headers={"X-Device-Token": settings.device_token},
        )

    def set_base_url(self, url: str) -> None:
        """Point the client at an address the sweep found."""
        self.base_url = url
        self._client.base_url = url

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = await self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise DeviceUnreachable(f"the controller did not answer: {exc}") from exc
        if response.status_code >= 400:
            try:
                payload = response.json()
            except ValueError:
                payload = {}
            error = payload.get("error", {}) if isinstance(payload, dict) else {}
            raise DeviceError(
                response.status_code,
                str(error.get("code", "DEVICE_ERROR")),
                str(error.get("message", response.text[:300])),
                payload if isinstance(payload, dict) else {},
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise DeviceError(502, "DEVICE_BAD_JSON", "the controller returned non-JSON data") from exc
        return payload

    async def health(self) -> dict[str, Any]:
        return await self._request("GET", "/api/v1/health")

    async def status(self) -> dict[str, Any]:
        return await self._request("GET", "/api/v1/status")

    async def get_config(self) -> dict[str, Any]:
        return await self._request("GET", "/api/v1/config")

    async def put_config(self, expected_revision: int, config: dict[str, Any]) -> dict[str, Any]:
        return await self._request(
            "PUT",
            "/api/v1/config",
            json={"config_revision": expected_revision, "config": config},
        )

    async def command(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/v1/commands", json=payload)

    async def close(self) -> None:
        await self._client.aclose()


class DeviceGateway:
    """Owns the live device connection, staleness, command acks and the
    always-available demo simulator.  Demo mode can never reach the real
    device: the selection is made in one place below."""

    def __init__(self, settings: Settings, *, device: Any | None = None,
                 demo: SimulatedDevice | None = None):
        self.settings = settings
        self.mode = settings.device_mode
        self.device = device or (
            SimulatedDevice() if settings.device_is_simulator else HttpDevice(settings)
        )
        self.demo = demo or SimulatedDevice(demo=True)
        self._state: dict[str, Any] | None = None
        self._last_success_mono: float | None = None
        self._last_success_at: str | None = None
        self._last_error: str | None = None
        self._connected = False
        self._boot_id: str | None = None
        self._device_id: str | None = None
        self._reconnects = 0
        self._failures = 0
        self._poll_task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._poll_lock = asyncio.Lock()
        self._command_cache: OrderedDict[tuple[str, str], dict[str, Any]] = OrderedDict()
        self._events: list[dict[str, Any]] = []
        self._last_poll_mono = 0.0
        self._last_discover_mono = float("-inf")

    # ------------------------------------------------------------------
    @property
    def physical(self) -> bool:
        return not self.settings.device_is_simulator

    async def start(self) -> None:
        if self.settings.poll_enabled:
            self._poll_task = asyncio.create_task(self._poll_loop(), name="device-poll")

    async def stop(self) -> None:
        self._stop.set()
        if self._poll_task is not None:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
        if hasattr(self.device, "close"):
            await self.device.close()

    async def _poll_loop(self) -> None:
        interval = max(0.2, self.settings.poll_interval_ms / 1000.0)
        while not self._stop.is_set():
            try:
                await self.poll_once()
            except Exception:  # never let the loop die
                pass
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                continue

    def _poll_interval_ms(self) -> float:
        """How long to wait between attempts.

        The configured cadence is right while the controller answers.  Once it
        does not, keeping that cadence means every reader queues behind another
        connect timeout, so each failure doubles the gap up to half a minute and
        a success resets it.
        """
        interval = float(self.settings.poll_interval_ms)
        if self._failures:
            interval = min(30000.0, interval * (2 ** min(self._failures, 5)))
        return interval

    async def _maybe_poll(self) -> None:
        age_ms = (time.monotonic() - self._last_poll_mono) * 1000.0
        if self._last_success_mono is None:
            # It has never answered.  That is not a reason to let every single
            # reader start its own connect attempt -- which is how a state read
            # came to take 6-12 s with the board switched off.
            if self._failures and age_ms < self._poll_interval_ms():
                return
            await self.poll_once()
            return
        if age_ms >= self._poll_interval_ms():
            await self.poll_once()

    async def _call(self, device: Any, method: str, *args: Any, **kwargs: Any) -> Any:
        fn = getattr(device, method)
        result = fn(*args, **kwargs)
        if inspect.isawaitable(result):
            return await result
        return result

    async def poll_once(self) -> None:
        async with self._poll_lock:
            self._last_poll_mono = time.monotonic()
            try:
                state = await self._call(self.device, "status")
            except (DeviceUnreachable, DeviceError) as exc:
                message = getattr(exc, "message", str(exc))
                self._last_error = message
                self._failures += 1
                await self._maybe_discover()
                age_ms = self._age_ms()
                was_connected = self._connected
                if age_ms is not None and age_ms > self.settings.disconnect_after_ms:
                    self._connected = False
                if was_connected and not self._connected:
                    self._events.append(
                        {
                            "kind": "connection",
                            "severity": "error",
                            "title": "Controller disconnected",
                            "detail": message,
                        }
                    )
                return

            previous_boot = self._boot_id
            new_boot = state.get("boot_id")
            self._state = state
            self._boot_id = new_boot
            self._device_id = state.get("device_id")
            self._last_success_mono = time.monotonic()
            self._last_success_at = utc_now()
            self._last_error = None
            self._failures = 0
            if not self._connected:
                self._connected = True
                self._events.append(
                    {
                        "kind": "connection",
                        "severity": "info",
                        "title": "Controller connected",
                        "detail": f"{self._device_id} · {new_boot}",
                    }
                )
            elif previous_boot and new_boot and previous_boot != new_boot:
                self._reconnects += 1
                self._events.append(
                    {
                        "kind": "connection",
                        "severity": "warning",
                        "title": "Controller restarted",
                        "detail": "A new boot id was seen. No old actuator command was replayed.",
                    }
                )

    async def _maybe_discover(self) -> None:
        """Look for the board on its own subnet when the configured address dies.

        The address is DHCP: this deployment has seen .8, .6 and .4, and each
        move left the app pointing at nothing until somebody edited `.env` and
        restarted.  A sweep only runs while the controller is *not* answering,
        at most once every `device_discover_interval_s`, so a healthy board
        costs nothing.
        """
        if not self.settings.device_discover:
            return
        current = getattr(self.device, "base_url", None)
        if not current or not hasattr(self.device, "set_base_url"):
            return
        now = time.monotonic()
        if now - self._last_discover_mono < self.settings.device_discover_interval_s:
            return
        self._last_discover_mono = now
        found = await discover_device(current, self.settings.device_token)
        if not found or found == current:
            return
        self.device.set_base_url(found)
        self._events.append(
            {
                "kind": "connection",
                "severity": "info",
                "title": "Controller found at a new address",
                "detail": f"{current} stopped answering; the controller is at {found}.",
            }
        )

    def _age_ms(self) -> int | None:
        if self._last_success_mono is None:
            return None
        return max(0, int((time.monotonic() - self._last_success_mono) * 1000))

    def drain_events(self) -> list[dict[str, Any]]:
        events = self._events
        self._events = []
        return events

    # ------------------------------------------------------------------
    def _demo_status(self) -> dict[str, Any]:
        return self.demo.status()

    async def snapshot(self, mode: str = "live", *, allow_poll: bool = True) -> dict[str, Any]:
        """The current state.

        `allow_poll=False` answers from what the gateway already knows instead of
        waiting for the controller.  Use it where a fresh reading is a nicety
        rather than the answer -- a recognition must not be held up by a board
        that is switched off.
        """
        if mode == "demo":
            status = self._demo_status()
            return {
                "mode": "demo",
                "physical": False,
                "source": {"kind": "demo", "label": "Demo simulator"},
                "server_time": utc_now(),
                "connection": {
                    "connected": True,
                    "stale": False,
                    "age_ms": 0,
                    "last_success_at": utc_now(),
                    "last_error": None,
                    "boot_id": status.get("boot_id"),
                    "device_id": status.get("device_id"),
                    "reconnects": 0,
                },
                "status": status,
            }

        if allow_poll:
            await self._maybe_poll()
        age = self._age_ms()
        stale = age is None or age > self.settings.stale_after_ms
        connected = bool(
            self._connected and age is not None and age <= self.settings.disconnect_after_ms
        )
        return {
            "mode": "live",
            "physical": self.physical,
            "source": {
                "kind": self.settings.source_kind,
                "label": self.settings.source_label,
            },
            "server_time": utc_now(),
            "connection": {
                "connected": connected,
                "stale": stale,
                "age_ms": age,
                "last_success_at": self._last_success_at,
                "last_error": self._last_error,
                "boot_id": self._boot_id,
                "device_id": self._device_id,
                "reconnects": self._reconnects,
            },
            "status": self._state,
        }

    # ------------------------------------------------------------------
    def _select(self, mode: str) -> tuple[Any, bool]:
        if mode == "demo":
            return self.demo, False
        return self.device, self.physical

    def _cache_key(self, mode: str, request_id: str) -> tuple[str, str]:
        return (mode, request_id)

    def _cached(self, mode: str, request_id: str, fingerprint: str) -> dict[str, Any] | None:
        key = self._cache_key(mode, request_id)
        entry = self._command_cache.get(key)
        if entry is None:
            return None
        if entry["fingerprint"] != fingerprint:
            raise RequestReuseError(
                "this request_id was already used for a different command"
            )
        if time.monotonic() - entry["ts"] > 600:
            return None
        self._command_cache.move_to_end(key)
        result = dict(entry["result"])
        result["duplicate_request"] = True
        return result

    def _remember(self, mode: str, request_id: str, fingerprint: str,
                  result: dict[str, Any]) -> None:
        key = self._cache_key(mode, request_id)
        self._command_cache[key] = {
            "fingerprint": fingerprint,
            "ts": time.monotonic(),
            "result": dict(result),
        }
        self._command_cache.move_to_end(key)
        while len(self._command_cache) > 100:
            self._command_cache.popitem(last=False)

    async def send_command(
        self,
        *,
        mode: str,
        command_type: str,
        parameters: dict[str, Any],
        request_id: str,
        source: str = "browser",
    ) -> dict[str, Any]:
        fingerprint = json.dumps(
            {"type": command_type, "parameters": parameters},
            sort_keys=True,
            ensure_ascii=False,
        )
        cached = self._cached(mode, request_id, fingerprint)
        if cached is not None:
            return cached

        device, physical = self._select(mode)
        payload = {
            "protocol_version": 1,
            "command_id": request_id,
            "type": command_type,
            "parameters": parameters,
            "issued_at_ms": int(time.time() * 1000),
        }
        last_error = "the controller did not acknowledge the command"
        for attempt in range(2):
            try:
                ack = await self._call(device, "command", payload)
                result = {
                    "confirmed": True,
                    "mode": mode,
                    "physical": physical,
                    "ack": ack,
                    "error": None,
                    "duplicate_request": False,
                }
                self._remember(mode, request_id, fingerprint, result)
                if mode == "live":
                    await self.poll_once()
                return result
            except SimulatorError as exc:
                error = exc.payload.get("error", {})
                return {
                    "confirmed": False,
                    "mode": mode,
                    "physical": physical,
                    "ack": None,
                    "error": {
                        "code": str(error.get("code", "DEVICE_REJECTED")),
                        "message": str(error.get("message", "the controller rejected the request")),
                    },
                    "duplicate_request": False,
                }
            except DeviceError as exc:
                last_error = exc.message
                # A rejected command is still unconfirmed at the transport
                # level only when the device did not return its protocol ack.
                if attempt == 0 and exc.status >= 500:
                    continue
                return {
                    "confirmed": False,
                    "mode": mode,
                    "physical": physical,
                    "ack": None,
                    "error": {"code": exc.code, "message": exc.message},
                    "duplicate_request": False,
                }
            except DeviceUnreachable as exc:
                last_error = exc.message
                # Retry once with the SAME command id.  Never mint a new id.
                continue
        return {
            "confirmed": False,
            "mode": mode,
            "physical": physical,
            "ack": None,
            "error": {
                "code": "DEVICE_UNREACHABLE",
                "message": last_error + ". Do not assume the output changed.",
            },
            "duplicate_request": False,
        }

    # ------------------------------------------------------------------
    async def get_config(self, mode: str = "live") -> dict[str, Any]:
        device, _ = self._select(mode)
        try:
            return await self._call(device, "get_config")
        except DeviceUnreachable as exc:
            # A controller that is off is not a server fault.  Left unhandled
            # this escaped as a 500 stack trace, so the Setup page showed an
            # internal error instead of "the controller is not answering" --
            # which is the one thing an operator can act on.
            raise DeviceError(503, "DEVICE_UNREACHABLE", exc.message) from exc
        except SimulatorError as exc:
            raise DeviceError(
                exc.status,
                str(exc.payload.get("error", {}).get("code", "CONFIG_ERROR")),
                str(exc.payload.get("error", {}).get("message", "configuration error")),
                exc.payload,
            ) from exc

    async def put_config(self, mode: str, expected_revision: int,
                         config: dict[str, Any]) -> dict[str, Any]:
        device, _ = self._select(mode)
        try:
            return await self._call(device, "put_config", expected_revision, config)
        except DeviceUnreachable as exc:
            # Nothing was written, and saying so is the difference between
            # "try again" and "was my change saved?".
            raise DeviceError(
                503, "DEVICE_UNREACHABLE", exc.message + ". Nothing was changed."
            ) from exc
        except SimulatorError as exc:
            raise DeviceError(
                exc.status,
                str(exc.payload.get("error", {}).get("code", "CONFIG_ERROR")),
                str(exc.payload.get("error", {}).get("message", "configuration error")),
                exc.payload,
            ) from exc

    async def device_health(self, mode: str = "live") -> dict[str, Any]:
        device, physical = self._select(mode)
        try:
            health = await self._call(device, "health")
            return {"reachable": True, "physical": physical, "health": health, "error": None}
        except (DeviceUnreachable, DeviceError) as exc:
            return {
                "reachable": False,
                "physical": physical,
                "health": None,
                "error": getattr(exc, "message", str(exc)),
            }

    def demo_scenario(self, values: dict[str, Any]) -> dict[str, Any]:
        return self.demo.scenario(values)

    def demo_reset(self) -> dict[str, Any]:
        return self.demo.reset()

    def simulator_scenario(self, values: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(self.device, SimulatedDevice):
            raise SimulatorError(
                409,
                {"error": {"code": "NOT_SIMULATOR", "message": "the live device is real hardware"}},
            )
        return self.device.scenario(values)
