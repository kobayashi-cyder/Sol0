"""Disk-backed float32 tensor store for Sol0 experiments.

Little-endian IEEE-754 F32, mmap-backed, not an LLM inference runtime.
"""
from __future__ import annotations

import json
import math
import mmap
import os
import struct
from pathlib import Path

MAX_BYTES = 5_000_000_000


class WeightStoreF32:
    def __init__(self, base_path):
        self.base = Path(base_path)
        self.info_path = self.base.with_suffix(".sf32.json")
        self.data_path = self.base.with_suffix(".sf32.bin")
        self.meta = json.loads(self.info_path.read_text(encoding="utf-8"))
        if self.meta.get("magic") != "SOLZERO_F32" or self.meta.get("version") != 1:
            raise ValueError("invalid F32 metadata")
        self.shape = tuple(self.meta["shape"])
        self.count = math.prod(self.shape)
        if not 1 <= len(self.shape) <= 5 or any(type(d) is not int or d <= 0 for d in self.shape):
            raise ValueError("invalid shape")
        if self.count * 4 > MAX_BYTES or self.data_path.stat().st_size != self.count * 4:
            raise ValueError("invalid F32 file length")
        self._file = self.data_path.open("r+b")
        self._mmap = mmap.mmap(self._file.fileno(), 0)

    @classmethod
    def create(cls, base_path, shape):
        shape = list(shape)
        if not 1 <= len(shape) <= 5 or any(type(d) is not int or d <= 0 for d in shape):
            raise ValueError("invalid shape")
        size = math.prod(shape) * 4
        if not 0 < size <= MAX_BYTES:
            raise ValueError("F32 storage limit exceeded")
        base = Path(base_path)
        info = base.with_suffix(".sf32.json")
        data = base.with_suffix(".sf32.bin")
        if info.exists() or data.exists():
            raise FileExistsError("refusing to overwrite F32 weights")
        base.parent.mkdir(parents=True, exist_ok=True)
        with data.open("xb") as f:
            f.truncate(size)
        try:
            info.write_text(json.dumps({"magic":"SOLZERO_F32","version":1,"shape":shape}),encoding="utf-8")
            return cls(base)
        except BaseException:
            info.unlink(missing_ok=True)
            data.unlink(missing_ok=True)
            raise

    def _index(self, index):
        if type(index) is int:
            i = index
        elif isinstance(index, (tuple, list)) and len(index) == len(self.shape):
            i = 0
            for coordinate, dimension in zip(index, self.shape):
                if type(coordinate) is not int or not 0 <= coordinate < dimension:
                    raise IndexError("coordinate out of range")
                i = i * dimension + coordinate
        else:
            raise IndexError("invalid index")
        if not 0 <= i < self.count:
            raise IndexError("index out of range")
        return i

    def get(self, index):
        return struct.unpack_from("<f", self._mmap, self._index(index) * 4)[0]

    def set(self, index, value):
        if type(value) not in (float, int) or not math.isfinite(value):
            raise ValueError("finite number required")
        try:
            struct.pack_into("<f", self._mmap, self._index(index) * 4, value)
        except (OverflowError, struct.error) as exc:
            raise ValueError("outside float32 range") from exc

    def copy_f32_bytes(self, raw):
        if len(raw) != self.count * 4:
            raise ValueError("payload size mismatch")
        for (value,) in struct.iter_unpack("<f", raw):
            if not math.isfinite(value):
                raise ValueError("nonfinite F32 value")
        self._mmap[:] = raw
        self._mmap.flush()

    def dot(self, values):
        if len(self.shape) != 1 or len(values) != self.count:
            raise ValueError("dot requires equal-length vectors")
        return math.fsum(self.get(i) * float(v) for i, v in enumerate(values))

    def close(self):
        if getattr(self, "_mmap", None) is not None:
            self._mmap.flush()
            self._mmap.close()
            self._mmap = None
        if getattr(self, "_file", None) is not None:
            self._file.close()
            self._file = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
