import json
import pytest
from scripts.plan_kimi_shards import plan_shards


def write_index(tmp_path, mapping=None, total=100):
    p = tmp_path / "model.safetensors.index.json"
    p.write_text(json.dumps({"metadata": {"total_size": total},
                             "weight_map": mapping or {"a":"a.safetensors","b":"b.safetensors"}}))
    return p


def test_missing_shards_and_capacity(tmp_path):
    p = write_index(tmp_path)
    r = plan_shards(p, available_bytes=99)
    assert r["shard_count"] == 2
    assert r["fits_available_bytes"] is False
    assert r["download_performed"] is False


def test_local_shard_accounting(tmp_path):
    p = write_index(tmp_path)
    (tmp_path / "a.safetensors").write_bytes(bytes(20))
    r = plan_shards(p, available_bytes=80)
    assert r["local_bytes"] == 20
    assert r["estimated_missing_bytes"] == 80
    assert r["fits_available_bytes"] is True


def test_path_traversal_refused(tmp_path):
    p = write_index(tmp_path, {"a":"../escape.safetensors"})
    with pytest.raises(ValueError):
        plan_shards(p, available_bytes=100)


def test_invalid_budget_refused(tmp_path):
    p = write_index(tmp_path)
    with pytest.raises(ValueError):
        plan_shards(p, available_bytes=-1)
