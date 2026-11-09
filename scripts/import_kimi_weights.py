"""CLI for explicitly supplied, locally downloaded Kimi weight shards.

Never downloads, unpickles, evaluates or applies checkpoint contents.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from solzero.weight_inspection import inspect_staged
from solzero.weight_staging import WeightStaging


def build_parser():
    p = argparse.ArgumentParser(description="Quarantine and inspect a local SafeTensors shard")
    p.add_argument("--file", type=Path, required=True, help="Local .safetensors file")
    p.add_argument("--store", type=Path, default=Path("local_weights/staging"))
    p.add_argument("--id", required=True, dest="artifact_id")
    p.add_argument("--origin", required=True, help="Exact upstream source URL or provenance")
    p.add_argument("--revision", required=True, help="Immutable upstream commit SHA")
    p.add_argument("--model", required=True, help="Exact upstream model identifier")
    p.add_argument("--license", dest="license_id", required=True)
    p.add_argument("--target-shape", type=int, nargs="+", required=True)
    return p


def import_local(args):
    if args.file.suffix.lower() != ".safetensors":
        raise ValueError("only SafeTensors is accepted by this importer")
    if not (7 <= len(args.revision) <= 64 and all(c in "0123456789abcdefABCDEF" for c in args.revision)):
        raise ValueError("revision must be a commit SHA")
    if any(d <= 0 for d in args.target_shape):
        raise ValueError("target shape must be positive")
    # Validate structure before copying anything into the staging area.
    from solzero.weight_inspection import inspect_safetensors
    inspect_safetensors(args.file)
    store = WeightStaging(args.store)
    manifest = store.stage(
        args.file, artifact_id=args.artifact_id,
        origin=args.origin, license_id=args.license_id, model=args.model,
        notes="upstream_revision=" + args.revision,
    )
    report = inspect_staged(store, args.artifact_id, args.target_shape)
    return {"manifest": manifest, "report": report}


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        result = import_local(args)
    except (OSError, ValueError, FileExistsError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
