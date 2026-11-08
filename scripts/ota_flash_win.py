"""Send a firmware image to a board running ArduinoOTA (Windows side).

Run this on the Windows host, not inside WSL: the board must be able to open a
UDP connection back to the sender, and WSL sits behind a NAT that the LAN
cannot reach.

The OTA password is read from ``ota_auth.tmp`` beside this file and the file is
deleted immediately, so the password never appears on the command line or in
the console output.
"""

from __future__ import annotations

import pathlib
import socket
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
AUTH_FILE = HERE / "ota_auth.tmp"
IMAGE = HERE / "firmware-ota.bin"
ESPOTA = HERE / "tools" / "espota.py"


def main() -> int:
    ip = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.8"
    port = sys.argv[2] if len(sys.argv) > 2 else "3232"

    if not AUTH_FILE.exists():
        print(f"Missing {AUTH_FILE.name}: write the OTA password into it first.")
        return 2
    auth = AUTH_FILE.read_text(encoding="utf-8").strip()
    AUTH_FILE.unlink()
    if not auth:
        print("The OTA password file was empty.")
        return 2
    if not IMAGE.exists():
        print(f"Missing {IMAGE.name}: export the firmware first.")
        return 2
    if not ESPOTA.exists():
        print(f"Missing {ESPOTA}: export the firmware first.")
        return 2

    # espota has to tell the board where to send the image.  Its default is
    # 0.0.0.0, which the board cannot answer, so hand it the address Windows
    # uses to reach the board on the LAN.
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect((ip, int(port)))
        host_ip = probe.getsockname()[0]
    finally:
        probe.close()

    print(f"Host address for the transfer: {host_ip}")
    cmd = [
        sys.executable,
        str(ESPOTA),
        "-i",
        ip,
        "-I",
        host_ip,
        "-p",
        port,
        "-a",
        auth,
        "-f",
        str(IMAGE),
    ]
    print(f"Uploading {IMAGE.name} to {ip}:{port} ...")
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
