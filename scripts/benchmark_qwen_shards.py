#!/usr/bin/env python3
"""Measure local Qwen single-GGUF vs tensor-sharded llama.cpp on one Linux runner.

Both modes use exactly the same llama-server options and Sol0's explicit
consent-gated HTTP provider. No weights or prompts are uploaded.
Only process RSS/HWM, not total host RAM or GPU VRAM, is measured.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PID_FIELDS = ("VmRSS", "VmHWM", "VmSwap")
MODEL_ID = "sol0-qwen"


def parse_proc_status(raw: str) -> dict[str, int]:
    """Return kB values (Linux /proc/<pid>/status format)."""
    values: dict[str, int] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        if key not in PID_FIELDS:
            continue
        parts = value.split()
        if len(parts) != 2 or parts[1] != "kB" or not parts[0].isdigit():
            raise ValueError(f"Invalid /proc memory field: {key}")
        values[key] = int(parts[0])
    return values


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark local Qwen single vs native tensor-sharded GGUF"
    )
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--shard-first", type=Path, required=True)
    parser.add_argument("--runner", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--port", type=int, default=9945)
    parser.add_argument("--repetitions", type=int, default=2)
    args = parser.parse_args(argv)
    if args.port < 1024 or args.port > 65535:
        parser.error("--port must be between 1024 and 65535")
    if args.repetitions < 1 or args.repetitions > 3:
        parser.error("--repetitions must be 1, 2 or 3")
    if args.original.resolve() == args.shard_first.resolve():
        parser.error("Original and first tensor shard must differ")
    if args.output.exists():
        parser.error("Refusing to overwrite existing benchmark report")
    return args


def sample_memory(pid: int, stopped: threading.Event, peaks: dict[str, int]) -> None:
    path = Path(f"/proc/{pid}/status")
    while not stopped.is_set():
        try:
            memory = parse_proc_status(path.read_text(encoding="utf-8"))
            for name, value in memory.items():
                peaks[name] = max(peaks.get(name, 0), value)
        except (FileNotFoundError, ProcessLookupError):
            break
        stopped.wait(0.025)


def health_ready(port: int) -> bool:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/health", timeout=1.5
        ) as response:
            body = json.load(response)
            return body.get("status") == "ok"
    except (OSError, ValueError, KeyError, urllib.error.URLError):
        return False


def run_one(
    model: Path, label: str, runner: Path, port: int, repetitions: int
) -> dict[str, object]:
    # Force CPU (no GPU-placement differences), identical context and options.
    command = [
        str(runner),
        "--model", str(model),
        "--host", "127.0.0.1",
        "--port", str(port),
        "--alias", MODEL_ID,
        "--ctx-size", "4096",
        "--n-gpu-layers", "0",
        "--offline",
        "--no-webui",
        "--cors-origins", "http://127.0.0.1:8765",
    ]
    # This temporary log is never uploaded as an artifact.
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as log:
        started = time.monotonic()
        proc = subprocess.Popen(
            command, stdout=log, stderr=subprocess.STDOUT,
            shell=False, close_fds=True,
        )
        stopped = threading.Event()
        memory: dict[str, int] = {}
        monitor = threading.Thread(
            target=sample_memory, args=(proc.pid, stopped, memory), daemon=True
        )
        monitor.start()
        try:
            deadline = time.monotonic() + 120
            while not health_ready(port):
                if proc.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(f"{label} llama-server exited before ready: {log.read()[-2800:]}")
                if time.monotonic() > deadline:
                    raise TimeoutError(f"{label} model startup exceeded 120 seconds")
                time.sleep(0.1)
            ready_seconds = round(time.monotonic() - started, 3)
            latencies = []
            answer_lengths = []
            for _ in range(repetitions):
                cmd = [
                    "node", str(ROOT / "tools" / "local_model_smoke.mjs"),
                    "--consent",
                    f"--endpoint=http://127.0.0.1:{port}/v1/chat/completions",
                    f"--model={MODEL_ID}",
                ]
                response = subprocess.run(
                    cmd, cwd=ROOT, shell=False, text=True,
                    capture_output=True, check=True, timeout=90,
                )
                report = json.loads(response.stdout)
                if report.get("connected") is not True or report.get("fallback") is not False:
                    raise RuntimeError("Sol0 consent adapter did not return a real model reply")
                latencies.append(int(report["elapsedMs"]))
                answer_lengths.append(int(report["answerLength"]))
            if not memory.get("VmHWM"):
                raise RuntimeError("Could not read llama-server peak Linux RSS")
            return {
                "label": label,
                "modelPathType": "single-GGUF" if label == "original" else "tensor-shards",
                "initialFileMiB": round(model.stat().st_size / (1024**2), 2),
                "startupSeconds": ready_seconds,
                "requestLatenciesMs": latencies,
                "medianRequestMs": statistics.median(latencies),
                "responseLengths": answer_lengths,
                "peakProcessRssMiB": round(memory["VmHWM"] / 1024, 2),
                "observedRssMiB": round(memory.get("VmRSS", 0) / 1024, 2),
                "peakSwapMiB": round(memory.get("VmSwap", 0) / 1024, 2),
                "fallback": False,
            }
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=8)
            stopped.set()
            monitor.join(timeout=3)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if sys.platform != "linux" or not Path("/proc/self/status").exists():
        raise RuntimeError("Process RSS benchmark requires Linux procfs")
    for path in (args.original, args.shard_first, args.runner):
        if not path.is_file():
            raise FileNotFoundError(f"Required local file not found: {path}")
    if not args.runner.stat().st_mode & 0o111:
        raise PermissionError("llama-server path is not executable")
    original = run_one(args.original.resolve(), "original", args.runner.resolve(),
                       args.port, args.repetitions)
    shards = run_one(args.shard_first.resolve(), "sharded", args.runner.resolve(),
                     args.port, args.repetitions)
    data = {
        "schemaVersion": 1,
        "platform": "Linux GitHub Actions" if os.getenv("GITHUB_ACTIONS") else "Linux local",
        "processorCount": os.cpu_count(),
        "gpuLayers": 0,
        "sameRunner": str(args.runner),
        "model": MODEL_ID,
        "requestsPerCondition": args.repetitions,
        "conditions": [original, shards],
        "peakProcessRssDifferenceMiB": round(
            shards["peakProcessRssMiB"] - original["peakProcessRssMiB"], 2
        ),
        "medianLatencyDifferenceMs": round(
            shards["medianRequestMs"] - original["medianRequestMs"], 2
        ),
        "interpretation": (
            "Single run, fixed order (original then sharded); OS file cache may bias results. "
            "RSS/HWM is one process's resident memory, not GPU VRAM, file cache, "
            "total RAM or a promise of less memory. Model quality was not tested."
        ),
    }
    with args.output.open("x", encoding="utf-8") as out:
        json.dump(data, out, ensure_ascii=False, indent=2)
        out.write("\n")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f"Qwen benchmark FAILED: {error}", file=sys.stderr)
        raise SystemExit(1)
