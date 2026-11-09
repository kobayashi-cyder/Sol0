"""Exact F32 transplant from a verified staged SafeTensors shard.

Never loads executable checkpoints. No architecture correspondence implied.
"""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

from solzero.weight_inspection import inspect_staged
from solzero.weight_staging import WeightStaging
from solzero.weight_store_f32 import WeightStoreF32


def transplant_f32(staging_root, artifact_id, tensor_name, output_base, *,
                   expected_sha256, max_elements=1_000_000):
    staging = WeightStaging(staging_root)
    manifest = staging.inspect(artifact_id, verify=True)
    if manifest["sha256"] != expected_sha256:
        raise ValueError("SHA-256 mismatch")
    if not manifest["filename"].endswith(".safetensors"):
        raise ValueError("SafeTensors required")
    path = staging.root / artifact_id / manifest["filename"]
    # Verify header structure and all tensor bounds before copying.
    inspected = inspect_staged(staging, artifact_id, [1])["inspection"]
    selected = [t for t in inspected["tensors"] if t["name"] == tensor_name]
    if len(selected) != 1:
        raise ValueError("tensor not found")
    tensor = selected[0]
    shape = tensor["shape"]
    count = math.prod(shape)
    if tensor["dtype"] != "F32" or not 1 <= len(shape) <= 5 or not 0 < count <= max_elements:
        raise ValueError("unsupported tensor type or size")
    with path.open("rb") as source:
        header_length = struct.unpack("<Q", source.read(8))[0]
        header = json.loads(source.read(header_length))
        start, end = header[tensor_name]["data_offsets"]
        source.seek(8 + header_length + start)
        payload = source.read(end - start)
    if len(payload) != count * 4:
        raise ValueError("truncated tensor")
    # Prevalidate all values to avoid creating a partially populated destination.
    if any(not math.isfinite(v) for (v,) in struct.iter_unpack("<f", payload)):
        raise ValueError("nonfinite tensor")
    with WeightStoreF32.create(output_base, shape) as destination:
        destination.copy_f32_bytes(payload)
    return {
        "status": "f32_tensor_copied",
        "source_sha256": expected_sha256,
        "tensor": tensor_name,
        "shape": shape,
        "parameters": count,
        "quantization": "none",
        "inference_compatible": False,
        "kimi_capability_transferred": False,
    }
