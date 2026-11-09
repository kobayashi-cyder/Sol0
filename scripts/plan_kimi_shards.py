"""Offline planning for sharded SafeTensors checkpoints.

Reads only an explicitly supplied index JSON. Never downloads model files.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

MAX_INDEX_BYTES = 16 * 1024 * 1024
MAX_SHARDS = 100_000
_SAFE_SHARD = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.safetensors$")


def plan_shards(index_path, *, available_bytes, max_shard_bytes=5_000_000_000):
    index_path = Path(index_path)
    if index_path.is_symlink() or not index_path.is_file():
        raise ValueError("index must be a regular file")
    if not 0 < index_path.stat().st_size <= MAX_INDEX_BYTES:
        raise ValueError("invalid index size")
    if type(available_bytes) is not int or available_bytes < 0:
        raise ValueError("available_bytes must be nonnegative integer")
    if type(max_shard_bytes) is not int or max_shard_bytes <= 0:
        raise ValueError("invalid per-shard budget")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if not isinstance(index, dict) or not isinstance(index.get("weight_map"), dict):
        raise ValueError("missing weight_map")
    mapping = index["weight_map"]
    if not mapping or len(mapping) > 1_000_000:
        raise ValueError("invalid tensor count")
    shards = {}
    for tensor, filename in mapping.items():
        if not isinstance(tensor, str) or not tensor or not isinstance(filename, str) or not _SAFE_SHARD.fullmatch(filename):
            raise ValueError("invalid tensor name or shard filename")
        shards[filename] = shards.get(filename, 0) + 1
    if len(shards) > MAX_SHARDS:
        raise ValueError("too many shards")
    meta = index.get("metadata", {})
    if not isinstance(meta, dict):
        raise ValueError("invalid metadata")
    total = meta.get("total_size")
    if type(total) is not int or total < 0:
        total = None
    entries = []
    known_bytes = 0
    unknown = False
    for filename, count in sorted(shards.items()):
        local = index_path.parent / filename
        if local.is_symlink():
            raise ValueError("symlink shard refused")
        exists = local.is_file()
        size = local.stat().st_size if exists else None
        if exists:
            known_bytes += size
        else:
            unknown = True
        entries.append({"filename": filename, "tensors": count,
                        "local": exists, "local_bytes": size,
                        "fits_staging_limit": size <= max_shard_bytes if exists else None})
    missing = [e["filename"] for e in entries if not e["local"]]
    estimate = max(0, total - known_bytes) if total is not None else None
    return {
        "index": str(index_path), "tensor_count": len(mapping),
        "shard_count": len(entries), "shards": entries,
        "declared_total_bytes": total, "local_bytes": known_bytes,
        "missing_shards": missing, "estimated_missing_bytes": estimate,
        "available_bytes": available_bytes,
        "fits_available_bytes": estimate <= available_bytes if estimate is not None else None,
        "all_shards_present": not unknown,
        "all_local_shards_fit_staging_limit": all(e["fits_staging_limit"] for e in entries if e["local"]),
        "download_performed": False,
        "weight_transfer_performed": False,
    }


def main(argv=None):
    p = argparse.ArgumentParser(description="Plan a sharded SafeTensors import without downloading")
    p.add_argument("--index", type=Path, required=True)
    p.add_argument("--available-bytes", type=int, required=True)
    p.add_argument("--max-shard-bytes", type=int, default=5_000_000_000)
    p.add_argument("--output", type=Path)
    args = p.parse_args(argv)
    try:
        report = plan_shards(args.index, available_bytes=args.available_bytes,
                             max_shard_bytes=args.max_shard_bytes)
        output = json.dumps(report, ensure_ascii=False, indent=2)
        if args.output:
            args.output.write_text(output + "\n", encoding="utf-8")
        else:
            print(output)
        return 0
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        p.exit(1, f"error: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
