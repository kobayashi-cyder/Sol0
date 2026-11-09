"""Mocked ADB regression: physical Sol0 preflight never changes device state."""
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "android" / "tests"))
from physical_preflight import (
    PreflightError, inspect_device, parse_devices, sha256_file
)


class FakeAdb:
    def __init__(self, serial="PHYSICAL_TEST_1", sdk="37",
                 qemu="0", internet=False, provider=True, installed=True):
        self.serial = serial
        self.sdk = sdk
        self.qemu = qemu
        self.internet = internet
        self.provider = provider
        self.installed = installed
        self.commands = []

    def __call__(self, cmd, **options):
        assert options.get("capture_output") is True
        assert options.get("check") is False
        assert options.get("timeout", 0) <= 18
        assert "shell" not in options
        assert cmd[0] == "adb", cmd
        self.commands.append(cmd)
        if cmd[1:] == ["devices"]:
            value = f"List of devices attached\n{self.serial}\tdevice\n"
        else:
            assert cmd[1:3] == ["-s", self.serial], "Must target explicit device"
            args = cmd[3:]
            if args[:2] == ["shell", "getprop"]:
                key = args[-1]
                value = {
                    "ro.build.version.sdk": self.sdk,
                    "ro.build.version.release": "17",
                    "ro.product.model": "Test Handset",
                    "ro.kernel.qemu": self.qemu,
                    "ro.boot.qemu": self.qemu,
                }.get(key, "")
            elif args == ["shell", "pm", "path", "jp.solzero.offline"]:
                value = (
                    "package:/data/app/jp.solzero.offline/base.apk"
                    if self.installed else ""
                )
            elif args == ["shell", "dumpsys", "package", "jp.solzero.offline"]:
                value = "requested permissions:\n  android.permission.WAKE_LOCK\n"
                if self.internet:
                    value += "  android.permission.INTERNET\n"
            elif args == ["shell", "cmd", "webviewupdate",
                          "get-current-webview-package"]:
                if not self.provider:
                    return subprocess.CompletedProcess(cmd, 1, "", "not supported")
                value = "Current WebView package com.android.webview (version 137)"
            else:
                raise AssertionError("Destructive/unrecognized ADB command: " + repr(cmd))
        return subprocess.CompletedProcess(cmd, 0, value, "")


class PhysicalPreflightTest(unittest.TestCase):
    def test_authorized_only(self):
        output = ("List of devices attached\n"
                  "device-123\tdevice product:foo\n"
                  "device-124\tunauthorized\n"
                  "emulator-5554\toffline\n")
        self.assertEqual(parse_devices(output), {"device-123"})

    def test_non_destructive_physical_probe_excludes_serial_and_user_data(self):
        adb = FakeAdb()
        with tempfile.TemporaryDirectory() as temp:
            apk = Path(temp) / "app-debug.apk"
            apk.write_bytes(b"Sol0 fake test APK bytes")
            report = inspect_device(adb.serial, apk, runner=adb)
            self.assertTrue(report["readOnlyPreflightReady"])
            self.assertTrue(report["deviceSerialOmitted"])
            self.assertFalse(report["physicalUiTestsExecuted"])
            self.assertFalse(report["physicalUiTestsPassed"])
            self.assertEqual(report["localApkSha256"],
                             hashlib.sha256(apk.read_bytes()).hexdigest())
            self.assertEqual(report["webViewProvider"],
                             "Current WebView package com.android.webview (version 137)")
            self.assertNotIn(adb.serial, repr(report))
            self.assertTrue(adb.commands)
            self.assertTrue(all("install" not in cmd and "uninstall" not in cmd
                                and "rm" not in cmd and "clear" not in cmd
                                and "pull" not in cmd and "push" not in cmd
                                for cmd in adb.commands))

    def test_emulator_cannot_impersonate_physical_readiness(self):
        self.assertFalse(inspect_device(
            "emulator-5554", runner=FakeAdb(serial="emulator-5554", qemu="1")
        )["readOnlyPreflightReady"])

    def test_os_webview_install_and_permission_block_device(self):
        variants = [
            FakeAdb(sdk="35"), FakeAdb(provider=False),
            FakeAdb(installed=False), FakeAdb(internet=True),
        ]
        for device in variants:
            with self.subTest(device=device.__dict__):
                self.assertFalse(
                    inspect_device(device.serial, runner=device)["readOnlyPreflightReady"]
                )

    def test_disconnected_and_malformed_serial_fail_closed(self):
        with self.assertRaises(PreflightError):
            inspect_device("x; rm -rf /", runner=FakeAdb())
        with self.assertRaises(PreflightError):
            inspect_device("PHYSICAL_TEST_2", runner=FakeAdb())

    def test_sha256_does_not_modify_apk(self):
        with tempfile.TemporaryDirectory() as temp:
            apk = Path(temp) / "some.apk"
            original = b"a" * (1024 * 1024 + 3)
            apk.write_bytes(original)
            self.assertEqual(sha256_file(apk), hashlib.sha256(original).hexdigest())
            self.assertEqual(apk.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
