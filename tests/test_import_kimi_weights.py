import json
import struct
from pathlib import Path

import pytest
from scripts.import_kimi_weights import build_parser, import_local


def make_shard(path):
    payload = bytes(4)
    header = json.dumps({"layer.weight": {
        "dtype": "F32", "shape": [1], "data_offsets": [0, 4]
    }}).encode("utf-8")
    path.write_bytes(struct.pack("<Q", len(header)) + header + payload)


def args_for(path, store):
    return build_parser().parse_args([
        "--file", str(path), "--store", str(store),
        "--id", "kimi_shard_001",
        "--origin", "https://huggingface.co/moonshotai/Kimi-K2-Base",
        "--revision", "abcdef1234567890",
        "--model", "moonshotai/Kimi-K2-Base",
        "--license", "review-required",
        "--target-shape", "1",
    ])


def test_local_shard_import(tmp_path):
    shard = tmp_path / "sample.safetensors"
    make_shard(shard)
    result = import_local(args_for(shard, tmp_path / "staging"))
    assert result["manifest"]["status"] == "quarantined"
    assert result["report"]["inspection"]["tensor_count"] == 1
    assert result["report"]["compatibility"]["direct_import_compatible"] is False


def test_invalid_shard_never_staged(tmp_path):
    shard = tmp_path / "bad.safetensors"
    shard.write_bytes(b"invalid")
    with pytest.raises(ValueError):
        import_local(args_for(shard, tmp_path / "staging"))
    assert not (tmp_path / "staging" / "kimi_shard_001").exists()


def test_requires_commit_revision(tmp_path):
    shard = tmp_path / "sample.safetensors"
    make_shard(shard)
    args = args_for(shard, tmp_path / "staging")
    args.revision = "main"
    with pytest.raises(ValueError):
        import_local(args)
