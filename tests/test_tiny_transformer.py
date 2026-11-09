import pytest

from solzero.weight_store_f32 import WeightStoreF32
from solzero.tiny_transformer import TinyTransformerBlock


def make(tmp_path, name, shape, values):
    w = WeightStoreF32.create(tmp_path / name, shape)
    for i, v in enumerate(values):
        w.set(i, v)
    return w


def test_full_forward_and_causal_isolation(tmp_path):
    stores = {}
    try:
        for name in ("q", "k", "v", "o"):
            stores[name] = make(tmp_path, name, [2, 2], [1, 0, 0, 1])
        for name in ("gate", "up", "down"):
            stores[name] = make(tmp_path, name, [2, 2], [0, 0, 0, 0])
        block = TinyTransformerBlock(**stores, norm1=[1, 1], norm2=[1, 1])
        output = block.forward([[1, 0], [0, 1]])
        assert len(output) == 2
        assert all(len(row) == 2 for row in output)
        assert output[0][0] > 1
        assert output[0][1] == pytest.approx(0)
        changed = block.forward([[1, 0], [100, -100]])
        assert changed[0] == pytest.approx(output[0])
    finally:
        for store in stores.values():
            store.close()


def test_invalid_attention_shape(tmp_path):
    stores = {}
    try:
        for name in ("q", "k", "v", "o"):
            stores[name] = make(tmp_path, name, [2, 2], [1, 0, 0, 1])
        for name in ("gate", "up", "down"):
            stores[name] = make(tmp_path, name, [2, 2], [0, 0, 0, 0])
        with pytest.raises(ValueError):
            TinyTransformerBlock(**stores, norm1=[1], norm2=[1])
    finally:
        for store in stores.values():
            store.close()
