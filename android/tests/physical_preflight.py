#!/usr/bin/env python3
"""Read-only Android physical-device preflight for Sol0.

Never installs/removes apps, reads user chat/storage, executes input gestures,
starts debug WebView, exposes ADB serials, or alters device settings.
Passing this is NOT a physical-device UI regression pass.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

PACKAGE = "jp.solzero.offline"
SERIAL_RE = re.compile(r"^[A-Za-z0-9._:-]{2,128}$")
API_MIN_ANDROID17 = 37


class PreflightError(Exception):
    pass


def parse_devices(output: str) -> set[str]:
    """ADB devices response; only fully authorized USB/Wi-Fi devices qualify."""
    found = set()
    for line in output.splitlines():
        cols = line.split()
        if len(cols) >= 2 and cols[1] == "device" and SERIAL_RE.fullmatch(cols[0]):
            found.add(cols[0])
    return found


def _safe_text(value: str, limit: int = 120) -> str:
    """Avoid control characters or excessive identifying strings in reports."""
    return "".join(c for c in value.strip() if c.isprintable())[:limit]


def _command(args: list[str], runner=subprocess.run) -> str:
    try:
        result = runner(
            ["adb", *args], text=True, capture_output=True,
            timeout=18, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PreflightError("ADB command unavailable or timed out") from exc
    if result.returncode:
        # Do not leak serials / arbitrary device errors into shared CI logs.
        raise PreflightError("ADB read-only command failed")
    return result.stdout.strip()


def _prop(serial: str, key: str, runner) -> str:
    return _safe_text(_command(["-s", serial, "shell", "getprop", key], runner))


def sha256_file(path: Path) -> str:
    if not path.is_file():
        raise PreflightError("Local APK file not found")
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def inspect_device(serial: str, apk: Path | None = None, runner=subprocess.run) -> dict:
    """Return deliberately non-identifying, read-only observations."""
    if not SERIAL_RE.fullmatch(serial):
        raise PreflightError("Invalid ADB serial format")
    available = parse_devices(_command(["devices"], runner))
    if serial not in available:
        raise PreflightError("Selected device not authorized or disconnected")
    sdk_text = _prop(serial, "ro.build.version.sdk", runner)
    if not sdk_text.isdigit() or not 1 <= int(sdk_text) <= 200:
        raise PreflightError("Invalid Android SDK version reported by device")
    sdk = int(sdk_text)
    model = _prop(serial, "ro.product.model", runner)
    release = _prop(serial, "ro.build.version.release", runner)
    emulated = (
        serial.startswith("emulator-")
        or _prop(serial, "ro.kernel.qemu", runner) == "1"
        or _prop(serial, "ro.boot.qemu", runner) == "1"
    )
    # Check installed package without reading its private data or contents.
    package_paths = _command(["-s", serial, "shell", "pm", "path", PACKAGE], runner)
    installed = any(line.startswith("package:") for line in package_paths.splitlines())
    permissions = _command(
        ["-s", serial, "shell", "dumpsys", "package", PACKAGE], runner
    ) if installed else ""
    internet_requested = (
        "android.permission.INTERNET" in permissions
        if installed else None
    )
    try:
        webview = _safe_text(_command(
            ["-s", serial, "shell", "cmd", "webviewupdate",
             "get-current-webview-package"], runner
        ), limit=160)
    except PreflightError:
        webview = "unknown (provider command unsupported)"
    ready = (
        not emulated and sdk >= API_MIN_ANDROID17 and installed
        and internet_requested is False and bool(webview)
        and not webview.startswith("unknown")
    )
    outcome = {
        "reportSchema": 1,
        "deviceSerialOmitted": True,
        "androidRelease": release,
        "androidApi": sdk,
        "modelName": model,
        "isEmulator": emulated,
        "webViewProvider": webview,
        "sol0PackageInstalled": installed,
        "internetPermissionFoundInPackageDump": internet_requested,
        "localApkSha256": sha256_file(apk) if apk is not None else None,
        "readOnlyPreflightReady": ready,
        "physicalUiTestsExecuted": False,
        "physicalUiTestsPassed": False,
        "caveat": (
            "Preflight only. SHA256 describes local APK file, NOT proof the "
            "installed package matches; perform IME/WSP/media/backup tests "
            "manually on a backed-up dedicated device."
        ),
    }
    return outcome


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sol0 physical Android17 READ-ONLY preflight")
    parser.add_argument("--serial", required=True, help="ADB serial (never written to JSON)")
    parser.add_argument("--apk", type=Path, help="Optional local APK checksum, no installation")
    parser.add_argument("--report", type=Path, help="Optional new JSON file, never overwrite")
    args = parser.parse_args(argv)
    try:
        info = inspect_device(args.serial, args.apk)
        text = json.dumps(info, ensure_ascii=False, indent=2) + "\n"
        if args.report:
            with args.report.open("x", encoding="utf-8") as target:
                target.write(text)
        print(text, end="")
        return 0 if info["readOnlyPreflightReady"] else 2
    except (PreflightError, OSError) as error:
        # The error messages contain no ADB serial or logcat/user data.
        print("Sol0 physical preflight could not pass: " + str(error))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
