import pytest
from solzero.weight_staging import WeightStaging


def test_stage_and_inspect(tmp_path):
    source = tmp_path / "sample.safetensors"
    source.write_bytes(b"dummy weights for staging only")
    staging = WeightStaging(tmp_path / "staging")
    manifest = staging.stage(source, artifact_id="kimi_candidate_01",
                             origin="local test fixture", model="test")
    assert manifest["status"] == "quarantined"
    assert manifest["compatible"] is None
    assert staging.inspect("kimi_candidate_01")["sha256"] == manifest["sha256"]
    assert len(staging.list()) == 1
    with pytest.raises(FileExistsError):
        staging.stage(source, artifact_id="kimi_candidate_01", origin="duplicate")


def test_reject_bad_inputs(tmp_path):
    staging = WeightStaging(tmp_path / "staging")
    source = tmp_path / "weights.safetensors"
    source.write_bytes(b"data")
    with pytest.raises(ValueError):
        staging.stage(source, artifact_id="../escape", origin="test")
    with pytest.raises(ValueError):
        staging.stage(source, artifact_id="empty_origin", origin="")
    invalid = tmp_path / "payload.py"
    invalid.write_text("print('not executed')")
    with pytest.raises(ValueError):
        staging.stage(invalid, artifact_id="bad_ext", origin="test")


def test_detect_tampering(tmp_path):
    source = tmp_path / "test.gguf"
    source.write_bytes(b"original")
    staging = WeightStaging(tmp_path / "staging")
    staging.stage(source, artifact_id="tamper", origin="test")
    (tmp_path / "staging" / "tamper" / "weights.gguf").write_bytes(b"changed")
    with pytest.raises(ValueError, match="integrity"):
        staging.inspect("tamper")
