"""Read-only SafeTensors structural inspection; no tensor deserialization."""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

MAX_HEADER_BYTES = 16 * 1024 * 1024
MAX_TENSORS = 200_000
DTYPE_BYTES = {"F64":8,"F32":4,"F16":2,"BF16":2,"I64":8,"I32":4,"I16":2,"I8":1,"U8":1,"BOOL":1,"F8_E4M3":1,"F8_E5M2":1}


def inspect_safetensors(path):
    """Inspect metadata without importing torch, pickle or safetensors runtimes."""
    path = Path(path)
    size = path.stat().st_size
    if size < 10:
        raise ValueError("truncated safetensors file")
    with path.open("rb") as f:
        header_len = struct.unpack("<Q", f.read(8))[0]
        if not 2 <= header_len <= MAX_HEADER_BYTES or header_len > size - 8:
            raise ValueError("invalid safetensors header size")
        raw = f.read(header_len)
    try:
        header = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as e:
        raise ValueError("invalid safetensors JSON header") from e
    if not isinstance(header, dict) or len(header) > MAX_TENSORS + 1:
        raise ValueError("invalid tensor dictionary")
    tensors = []
    spans = []
    payload_size = size - 8 - header_len
    for name, desc in header.items():
        if name == "__metadata__":
            if not isinstance(desc, dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in desc.items()):
                raise ValueError("invalid metadata")
            continue
        if not isinstance(desc, dict) or not isinstance(name, str) or not name:
            raise ValueError("invalid tensor descriptor")
        dtype, shape, offsets = desc.get("dtype"), desc.get("shape"), desc.get("data_offsets")
        if dtype not in DTYPE_BYTES or not isinstance(shape,list) or len(shape)>16 or any(type(d) is not int or d<0 for d in shape):
            raise ValueError("unsupported dtype or shape")
        if not isinstance(offsets,list) or len(offsets)!=2 or any(type(v) is not int for v in offsets):
            raise ValueError("invalid tensor offsets")
        start,end=offsets
        if not 0<=start<=end<=payload_size:
            raise ValueError("tensor offset outside file")
        expected=math.prod(shape)*DTYPE_BYTES[dtype]
        if end-start != expected:
            raise ValueError("tensor byte length mismatch")
        spans.append((start,end))
        tensors.append({"name":name,"dtype":dtype,"shape":shape,"bytes":expected})
    spans.sort()
    cursor=0
    for start,end in spans:
        if start != cursor:
            raise ValueError("overlapping or uncovered tensor data")
        cursor=end
    if cursor != payload_size:
        raise ValueError("unaccounted tensor payload bytes")
    return {"format":"safetensors","tensor_count":len(tensors),
            "total_parameters":sum(math.prod(t["shape"]) for t in tensors),
            "tensors":tensors}


def assess_for_solzero4(inspection, target_shape):
    """Conservative compatibility gate: never authorizes direct weight import."""
    dims=list(target_shape)
    if not dims or any(type(d) is not int or d<=0 for d in dims):
        raise ValueError("invalid Sol0 target shape")
    target_count=math.prod(dims)
    tensors=inspection["tensors"]
    matching=[t["name"] for t in tensors if math.prod(t["shape"])==target_count]
    return {
        "target_format":"SOLZERO4", "target_shape":dims,
        "target_parameters":target_count,
        "same_element_count_tensors":matching,
        "direct_import_compatible":False,
        "requires":["architecture mapping","tensor semantics verification",
                    "quantization calibration","license review","independent evaluation"],
        "reason":"Equal element counts do not establish layer correspondence or inference compatibility.",
    }


def inspect_staged(staging, artifact_id, target_shape):
    """Verify quarantined artifact integrity before inspecting its metadata."""
    manifest=staging.inspect(artifact_id,verify=True)
    if manifest["status"]!="quarantined":
        raise ValueError("artifact is not quarantined")
    if not manifest["filename"].endswith(".safetensors"):
        return {"artifact_id":artifact_id,"inspection_status":"unsupported_format",
                "direct_import_compatible":False}
    path=staging.root/artifact_id/manifest["filename"]
    result=inspect_safetensors(path)
    return {"artifact_id":artifact_id,"inspection_status":"inspected",
            "source_sha256":manifest["sha256"],
            "inspection":result,"compatibility":assess_for_solzero4(result,target_shape)}
