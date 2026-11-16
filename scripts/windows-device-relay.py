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
(192.168.1.x) and on the WSL gateway (172.29.192.1), so the backend points at
`http://172.29.192.1:8090` and the traffic goes:

    backend (WSL) -> Windows host:8090 -> board (192.168.137.168:80)

Binding needs no administrator rights and no firewall rule, which is why this
is preferred over `netsh interface portproxy` (admin) or switching WSL to
mirrored networking (which restarts WSL).

The permanent alternative: give the board the same Wi-Fi the laptop is on
(`uc/include/village/secrets.h`).  Then the container routes to it directly and
this relay is unnecessary.

Usage (on Windows):
    python windows-device-relay.py [--listen 8090] [--upstream 192.168.137.168:80]
"""

from __future__ import annotations

import argparse
import socket
import threading


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


def serve(listen_port: int, upstream_host: str, upstream_port: int) -> None:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", listen_port))
    server.listen(64)
    print(f"relay listening on 0.0.0.0:{listen_port} -> {upstream_host}:{upstream_port}", flush=True)

    while True:
        client, _ = server.accept()
        try:
            up = socket.create_connection((upstream_host, upstream_port), timeout=10)
            up.settimeout(None)
        except OSError as exc:
            # The board is off or has moved.  Say so and keep listening: the
            # backend polls once a second and the next connection may succeed.
            print(f"upstream {upstream_host}:{upstream_port} unreachable: {exc}", flush=True)
            client.close()
            continue
        threading.Thread(target=_pipe, args=(client, up), daemon=True).start()
        threading.Thread(target=_pipe, args=(up, client), daemon=True).start()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--listen", type=int, default=8090, help="port to listen on (default 8090)")
    parser.add_argument(
        "--upstream",
        default="192.168.137.168:80",
        help="board address as seen from Windows (default 192.168.137.168:80)",
    )
    args = parser.parse_args()

    host, _, port = args.upstream.partition(":")
    serve(args.listen, host, int(port or 80))


if __name__ == "__main__":
    main()
