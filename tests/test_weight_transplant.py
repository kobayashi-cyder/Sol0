import hashlib
import json
import struct
import pytest

from solzero.weight_staging import WeightStaging
from solzero.weight_store import WeightStore4
from solzero.weight_transplant import transplant_tensor


def fixture(tmp_path, values=(1.0, -2.0)):
    source = tmp_path / "sample.safetensors"
    payload = struct.pack("<" + "f" * len(values), *values)
    header = json.dumps({"w":{"dtype":"F32","shape":[len(values)],
                             "data_offsets":[0,len(payload)]}}).encode()
    source.write_bytes(struct.pack("<Q",len(header)) + header + payload)
    staging = WeightStaging(tmp_path / "staging")
    manifest = staging.stage(source,artifact_id="candidate",origin="local test")
    return staging,manifest


def test_transplant_round_trip(tmp_path):
    staging,manifest=fixture(tmp_path)
    result=transplant_tensor(staging.root,"candidate","w",tmp_path/"target",
                             target_shape=[2],scale=0.5,expected_sha256=manifest["sha256"])
    assert result["kimi_capability_transferred"] is False
    with WeightStore4(tmp_path/"target") as weights:
        assert [weights.get(0),weights.get(1)] == [2,-4]


def test_refuse_wrong_hash_and_shape(tmp_path):
    staging,manifest=fixture(tmp_path)
    with pytest.raises(ValueError,match="hash"):
        transplant_tensor(staging.root,"candidate","w",tmp_path/"bad",
                          target_shape=[2],scale=1,expected_sha256="0"*64)
    with pytest.raises(ValueError,match="shape"):
        transplant_tensor(staging.root,"candidate","w",tmp_path/"bad",
                          target_shape=[1],scale=1,expected_sha256=manifest["sha256"])


def test_refuse_nan(tmp_path):
    staging,manifest=fixture(tmp_path,(float("nan"),1.0))
    with pytest.raises(ValueError,match="nonfinite"):
        transplant_tensor(staging.root,"candidate","w",tmp_path/"bad",
                          target_shape=[2],scale=1,expected_sha256=manifest["sha256"])
