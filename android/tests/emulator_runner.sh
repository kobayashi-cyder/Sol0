#!/usr/bin/env bash
# This MUST run as a single process: android-emulator-runner executes each
# newline of an inline script with a separate /bin/sh -c, losing shell state.
set -Eeuo pipefail

APK="android-apk/app-debug.apk"
PACKAGE="jp.solzero.offline"
ACTIVITY="$PACKAGE/.MainActivity"
LOG="/tmp/solzero-android-logcat.txt"

diagnose() {
  status=$?
  if ((status != 0)); then
    echo "Android smoke failed: exit $status"
    adb devices -l || true
    adb shell dumpsys webviewupdate || true
    adb shell dumpsys activity activities | tail -n 110 || true
    adb logcat -d -t 900 > "$LOG" || true
    grep -A 18 -E 'FATAL EXCEPTION|AndroidRuntime|chromium|solzero' "$LOG" | tail -n 120 || true
  fi
}
trap diagnose EXIT

test -s "$APK"
adb wait-for-device
if [[ -n "${EXPECTED_ANDROID_API:-}" ]]; then
  actual_api="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
  if [[ "$actual_api" != "$EXPECTED_ANDROID_API" ]]; then
    echo "Wrong Android API: expected $EXPECTED_ANDROID_API, actual $actual_api"
    exit 1
  fi
  echo "PASS: Android emulator API $actual_api verified"
fi
adb install -r "$APK"
adb shell am start -W -n "$ACTIVITY"

# Wait for app process rather than assuming WebView boot time.
pid=""
for _ in $(seq 1 60); do
  pid="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then break; fi
  sleep 2
done
if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
  echo "App did not remain alive after launch"
  exit 1
fi

adb forward tcp:9222 "localabstract:webview_devtools_remote_$pid"
python android/tests/emulator_smoke.py

# Verify the *real* native export and that the app survived the test.
adb shell ls /sdcard/Download/SolZero/ | grep -Fx 'solzero_v012_backup.json'
test -n "$(adb shell pidof "$PACKAGE" | tr -d '\r')"
adb logcat -d > "$LOG"
if grep -A 15 'FATAL EXCEPTION' "$LOG" | grep -F "$PACKAGE"; then
  echo "Sol-Zero process crashed"
  exit 1
fi
adb shell screencap -p /sdcard/solzero-android.png
adb pull /sdcard/solzero-android.png /tmp/solzero-android.png
echo "PASS: Android emulator offline WebView chat, scratch WSP, task, PNG, native Download"
