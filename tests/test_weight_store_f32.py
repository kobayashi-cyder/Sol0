import struct
import pytest
from solzero.weight_store_f32 import WeightStoreF32


def test_f32_roundtrip_and_dot(tmp_path):
    base = tmp_path / "float"
    with WeightStoreF32.create(base, [3]) as store:
        store.copy_f32_bytes(struct.pack("<fff", 0.25, -1.5, 2.0))
        assert store.dot([4, 2, 1]) == pytest.approx(0.0)
    with WeightStoreF32(base) as store:
        assert store.get(1) == pytest.approx(-1.5)
        store.set(0, 1.25)
    with WeightStoreF32(base) as store:
        assert store.get(0) == pytest.approx(1.25)


def test_refuse_overwrite_and_nonfinite(tmp_path):
    base = tmp_path / "float"
    with WeightStoreF32.create(base, [1]) as store:
        with pytest.raises(ValueError):
            store.set(0, float("nan"))
        with pytest.raises(ValueError):
            store.copy_f32_bytes(struct.pack("<f", float("inf")))
    with pytest.raises(FileExistsError):
        WeightStoreF32.create(base, [1])
