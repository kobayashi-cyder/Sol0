"""Quarantined weight artifact staging for Sol0; never loads or executes weights."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

MAX_ARTIFACT_BYTES = 5_000_000_000
_ALLOWED = {".safetensors", ".gguf", ".bin", ".npz", ".pt", ".pth"}
_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")


class WeightStaging:
    """Content-addressed storage with provenance and explicit quarantine status."""

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def stage(self, source, *, artifact_id, origin, license_id="unknown",
              model="unknown", notes=""):
        if not _ID.fullmatch(artifact_id):
            raise ValueError("invalid artifact_id")
        src = Path(source)
        if not src.is_file() or src.is_symlink():
            raise ValueError("source must be a regular non-symlink file")
        if src.suffix.lower() not in _ALLOWED:
            raise ValueError("unsupported weight file extension")
        if not isinstance(origin, str) or not origin.strip():
            raise ValueError("origin is required")
        for field in (origin, license_id, model, notes):
            if not isinstance(field, str) or len(field) > 2048:
                raise ValueError("invalid metadata")
        size = src.stat().st_size
        if not 0 < size <= MAX_ARTIFACT_BYTES:
            raise ValueError("invalid artifact size")
        dest = self.root / artifact_id
        if dest.exists():
            raise FileExistsError(artifact_id)
        tmp = Path(tempfile.mkdtemp(prefix=".incoming-", dir=self.root))
        try:
            output = tmp / ("weights" + src.suffix.lower())
            digest = hashlib.sha256()
            copied = 0
            with src.open("rb") as inp, output.open("xb") as out:
                while chunk := inp.read(1024 * 1024):
                    copied += len(chunk)
                    if copied > MAX_ARTIFACT_BYTES:
                        raise ValueError("artifact exceeds storage limit")
                    digest.update(chunk)
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            if copied != size:
                raise ValueError("source changed during copy")
            manifest = {
                "schema": 1, "artifact_id": artifact_id,
                "filename": output.name, "sha256": digest.hexdigest(),
                "bytes": copied, "origin": origin, "license": license_id,
                "model": model, "notes": notes,
                "status": "quarantined", "compatible": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            (tmp / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            tmp.rename(dest)
            return manifest
        finally:
            if tmp.exists():
                shutil.rmtree(tmp)

    def inspect(self, artifact_id, *, verify=True):
        if not _ID.fullmatch(artifact_id):
            raise ValueError("invalid artifact_id")
        directory = self.root / artifact_id
        manifest = json.loads((directory / "manifest.json").read_text("utf-8"))
        if manifest.get("artifact_id") != artifact_id:
            raise ValueError("manifest mismatch")
        filename = manifest.get("filename", "")
        if Path(filename).name != filename or not filename.startswith("weights."):
            raise ValueError("unsafe artifact filename")
        artifact = directory / filename
        if artifact.is_symlink() or not artifact.is_file():
            raise ValueError("invalid artifact")
        if verify:
            digest = hashlib.sha256()
            with artifact.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest() != manifest["sha256"] or artifact.stat().st_size != manifest["bytes"]:
                raise ValueError("artifact integrity failure")
        return manifest

    def list(self):
        return [self.inspect(p.name, verify=False) for p in sorted(self.root.iterdir())
                if p.is_dir() and not p.name.startswith(".") and _ID.fullmatch(p.name)]
