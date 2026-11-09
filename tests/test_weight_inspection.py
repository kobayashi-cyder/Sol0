import json
import struct
import pytest
from solzero.weight_staging import WeightStaging
from solzero.weight_inspection import inspect_safetensors, inspect_staged


def make_tensor_file(path, *, offset=(0,4), payload=bytes(4)):
    header=json.dumps({"layer.weight":{"dtype":"F32","shape":[1],"data_offsets":list(offset)}}).encode()
    path.write_bytes(struct.pack("<Q",len(header))+header+payload)


def test_staged_inspection(tmp_path):
    src=tmp_path/"sample.safetensors"
    make_tensor_file(src)
    staging=WeightStaging(tmp_path/"store")
    staging.stage(src,artifact_id="sample",origin="test fixture")
    result=inspect_staged(staging,"sample",[1])
    assert result["inspection"]["tensor_count"]==1
    assert result["compatibility"]["same_element_count_tensors"]==["layer.weight"]
    assert result["compatibility"]["direct_import_compatible"] is False


def test_reject_invalid_offsets(tmp_path):
    src=tmp_path/"invalid.safetensors"
    make_tensor_file(src,offset=(0,100))
    with pytest.raises(ValueError):
        inspect_safetensors(src)


def test_reject_overlong_header(tmp_path):
    src=tmp_path/"oversized.safetensors"
    src.write_bytes(struct.pack("<Q",20_000_000)+b"{}")
    with pytest.raises(ValueError):
        inspect_safetensors(src)


def test_unsupported_is_not_executed(tmp_path):
    src=tmp_path/"unsafe.pt"
    src.write_bytes(b"pickle payload must not be loaded")
    staging=WeightStaging(tmp_path/"store")
    staging.stage(src,artifact_id="pt",origin="test fixture")
    result=inspect_staged(staging,"pt",[1])
    assert result["inspection_status"]=="unsupported_format"
