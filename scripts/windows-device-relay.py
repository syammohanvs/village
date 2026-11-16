"""Reach the board from WSL when it is on the Windows Mobile Hotspot.

Why this exists
---------------
Windows Mobile Hotspot is ICS: it hands the board an address in
192.168.137.0/24 and NATs it to the internet, but it does **not** route that
subnet from anywhere else -- including WSL, whose own address is 172.29.x.
So the board answers the Windows host (200) and times out for the backend
running in this container (000).  Nothing is wrong with the board.

This script runs **on Windows**, where the board is reachable, and forwards a
local port to it.  The Windows host is reachable from WSL on its LAN address
(192.168.1.x) and on the WSL gateway (172.29.x.1), so the backend points at
`http://<gateway>:8090` and the traffic goes:

    backend (WSL) -> Windows host:8090 -> board -> pin

Binding needs no administrator rights and no firewall rule, which is why this
is preferred over `netsh interface portproxy` (admin) or switching WSL to
mirrored networking (which restarts WSL).

It also *finds* the board instead of being told where it is
----------------------------------------------------------
The board's address on the hotspot is a DHCP lease, and a lease can change when
the hotspot restarts or the board rejoins after a drop.  So this relay does not
trust the address it was given: when a connection to it fails twice in a row it
sweeps the hotspot subnet for a host answering the device API and switches to
that one.  `/api/v1/health` is unauthenticated on the board, so the sweep needs
no token and cannot leak one.

The permanent alternative: give the board the same Wi-Fi the laptop is on
(`uc/include/village/secrets.h`).  Then the container routes to it directly and
this relay is unnecessary.

Usage (on Windows):
    python windows-device-relay.py [--listen 8090] [--subnet 192.168.137]
                                   [--upstream 192.168.137.168:80] [--log relay.log]
"""

from __future__ import annotations

import argparse
import concurrent.futures
import socket
import sys
import threading
import time

# The board's health payload carries this; anything else answering on :80 in the
# hotspot subnet (a phone, the host itself) does not.
DEVICE_MARKER = b'"device_id"'


def _log(message: str, handle=None) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}"
    print(line, flush=True)
    if handle is not None:
        try:
            handle.write(line + "\n")
            handle.flush()
        except OSError:
            pass


def looks_like_board(host: str, port: int = 80, timeout: float = 0.6) -> bool:
    """True when `host` answers the device API's health route."""
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.sendall(
                b"GET /api/v1/health HTTP/1.0\r\nHost: " + host.encode() + b"\r\nConnection: close\r\n\r\n"
            )
            chunks = []
            deadline = time.time() + 1.5
            while time.time() < deadline:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
                if DEVICE_MARKER in b"".join(chunks):
                    return True
        return DEVICE_MARKER in b"".join(chunks)
    except OSError:
        return False


class Locator:
    """Where the board is, kept current without being told."""

    def __init__(self, subnet: str, port: int, hint: str | None, log_handle):
        self.subnet = subnet
        self.port = port
        self.address: str | None = hint
        self._failed = 0
        self._lock = threading.Lock()
        self._log = log_handle

    def _candidate_hosts(self) -> list[str]:
        return [f"{self.subnet}.{i}" for i in range(1, 255)]

    def discover(self) -> str | None:
        with self._lock:
            # Another thread may have found it while this one waited.
            _log(f"looking for the board on {self.subnet}.0/24 ...", self._log)
            with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
                for host, found in zip(
                    self._candidate_hosts(), pool.map(looks_like_board, self._candidate_hosts())
                ):
                    if found:
                        self.address = host
                        self._failed = 0
                        _log(f"found the board at {host}", self._log)
                        return host
            _log(f"no board answered on {self.subnet}.0/24", self._log)
            return None

    def get(self) -> str | None:
        if self.address is None:
            return self.discover()
        return self.address

    def failed(self) -> None:
        """Two misses in a row mean the lease moved (or the board is off)."""
        self._failed += 1
        if self._failed >= 2:
            self._failed = 0
            self.address = None


def _pipe(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            chunk = src.recv(65536)
            if not chunk:
                break
            dst.sendall(chunk)
    except OSError:
        pass
    finally:
        for sock in (src, dst):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass


def serve(listen_port: int, locator: Locator, log_handle) -> None:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", listen_port))
    server.listen(64)
    _log(f"relay listening on 0.0.0.0:{listen_port} -> board on {locator.subnet}.0/24", log_handle)

    while True:
        client, _ = server.accept()
        host = locator.get()
        if host is None:
            # No board at all right now.  Keep listening: the backend polls once
            # a second and the board may come back (hotspot restarted, lease
            # renewed), and the next connection sweeps again.
            client.close()
            continue
        try:
            up = socket.create_connection((host, 80), timeout=10)
            up.settimeout(None)
        except OSError as exc:
            _log(f"{host} did not accept a connection ({exc}); will re-scan", log_handle)
            locator.failed()
            client.close()
            continue
        threading.Thread(target=_pipe, args=(client, up), daemon=True).start()
        threading.Thread(target=_pipe, args=(up, client), daemon=True).start()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--listen", type=int, default=8090, help="port to listen on (default 8090)")
    parser.add_argument(
        "--subnet",
        default="192.168.137",
        help="hotspot subnet to sweep when the board has not answered (default 192.168.137)",
    )
    parser.add_argument(
        "--upstream",
        default=None,
        help="a known board address to try first, e.g. 192.168.137.168:80",
    )
    parser.add_argument("--log", default=None, help="append what the relay does to this file")
    args = parser.parse_args()

    log_handle = None
    if args.log:
        try:
            log_handle = open(args.log, "a", encoding="utf-8")
        except OSError as exc:
            print(f"cannot open {args.log}: {exc}", file=sys.stderr)

    hint = None
    if args.upstream:
        hint = args.upstream.split(":")[0]

    locator = Locator(args.subnet, 80, hint, log_handle)
    # Try the remembered address first, so a normal start costs one request
    # rather than a 254-host sweep.
    if hint and looks_like_board(hint):
        _log(f"board is at {hint}", log_handle)
    else:
        locator.discover()

    serve(args.listen, locator, log_handle)


if __name__ == "__main__":
    main()
