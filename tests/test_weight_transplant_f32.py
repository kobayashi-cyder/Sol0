import json
import struct
import pytest
from solzero.weight_staging import WeightStaging
from solzero.weight_store_f32 import WeightStoreF32
from solzero.weight_transplant_f32 import transplant_f32


def test_exact_f32_transplant(tmp_path):
    source = tmp_path / "source.safetensors"
    payload = struct.pack("<ff", 0.125, -3.5)
    header = json.dumps({"tensor": {"dtype":"F32","shape":[2],
                        "data_offsets":[0,len(payload)]}}).encode()
    source.write_bytes(struct.pack("<Q",len(header))+header+payload)
    stage = WeightStaging(tmp_path / "stage")
    record = stage.stage(source, artifact_id="test", origin="test")
    report = transplant_f32(stage.root, "test", "tensor", tmp_path / "output",
                            expected_sha256=record["sha256"])
    assert report["quantization"] == "none"
    with WeightStoreF32(tmp_path / "output") as dest:
        assert dest.get(0) == pytest.approx(0.125)
        assert dest.get(1) == pytest.approx(-3.5)
