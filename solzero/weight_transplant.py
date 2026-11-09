"""Bounded, opt-in tensor transplantation experiment.

Copies a selected F32 tensor from a verified staged SafeTensors artifact
into a NEW Sol0 signed-int4 store. No architecture/semantic compatibility claim.
"""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

from solzero.weight_inspection import inspect_staged
from solzero.weight_staging import WeightStaging
from solzero.weight_store import WeightStore4

MAX_ELEMENTS = 2048


def transplant_tensor(staging_root, artifact_id, tensor_name, output_base, *,
                      target_shape, scale, expected_sha256):
    if type(scale) not in (float, int) or not math.isfinite(scale) or scale <= 0:
        raise ValueError("scale must be positive and finite")
    if not isinstance(expected_sha256, str) or len(expected_sha256) != 64:
        raise ValueError("expected SHA-256 is required")
    shape = list(target_shape)
    if not shape or len(shape) > 5 or any(type(x) is not int or x <= 0 for x in shape):
        raise ValueError("invalid target shape")
    count = math.prod(shape)
    if count > MAX_ELEMENTS:
        raise ValueError("experimental transfer limited to 2048 elements")
    staging = WeightStaging(staging_root)
    manifest = staging.inspect(artifact_id, verify=True)
    if manifest["sha256"] != expected_sha256:
        raise ValueError("source hash mismatch")
    if manifest["filename"].endswith(".safetensors") is False:
        raise ValueError("SafeTensors only")
    report = inspect_staged(staging, artifact_id, shape)
    matches = [t for t in report["inspection"]["tensors"] if t["name"] == tensor_name]
    if len(matches) != 1:
        raise ValueError("tensor not found")
    tensor = matches[0]
    if tensor["dtype"] != "F32" or tensor["shape"] != shape:
        raise ValueError("exact shape and F32 dtype required")
    path = staging.root / artifact_id / manifest["filename"]
    with path.open("rb") as f:
        header_len = struct.unpack("<Q", f.read(8))[0]
        header = json.loads(f.read(header_len))
        start, end = header[tensor_name]["data_offsets"]
        f.seek(8 + header_len + start)
        raw = f.read(end - start)
    if len(raw) != count * 4:
        raise ValueError("tensor payload length mismatch")
    values = struct.unpack("<" + "f" * count, raw)
    if not all(math.isfinite(v) for v in values):
        raise ValueError("nonfinite source values")
    quantized = [max(-8, min(7, round(v / scale))) for v in values]
    output = Path(output_base)
    # Create never overwrites an existing weight store.
    with WeightStore4.create(output, shape) as target:
        target.patch(list(enumerate(quantized)))
        stored = [target.get(i) for i in range(count)]
    if stored != quantized:
        raise ValueError("round-trip mismatch")
    return {
        "status": "experimental_tensor_copy_only",
        "source_artifact": artifact_id,
        "source_sha256": manifest["sha256"],
        "tensor": tensor_name, "shape": shape, "scale": float(scale),
        "parameters_copied": count,
        "quantized_min": min(quantized), "quantized_max": max(quantized),
        "output_base": str(output),
        "model_inference_compatible": False,
        "kimi_capability_transferred": False,
    }
