import pytest
from solzero.weight_store_f32 import WeightStoreF32
from solzero.f32_layers import matvec, rms_norm, silu, swiglu, feed_forward


def make(tmp_path, name, shape, values):
    store = WeightStoreF32.create(tmp_path / name, shape)
    for i, v in enumerate(values):
        store.set(i, v)
    return store


def test_matvec(tmp_path):
    with make(tmp_path, "matrix", [2, 3], [1, 2, 3, -1, 0, 1]) as w:
        assert matvec(w, [2, 1, 3]) == pytest.approx([13, 1])
        assert matvec(w, [2, 1, 3], [1, 2]) == pytest.approx([14, 3])
        with pytest.raises(ValueError):
            matvec(w, [1, 2])


def test_rms_norm():
    assert rms_norm([3, 4], [1, 1], eps=1e-6) == pytest.approx(
        [3 / (12.5 + 1e-6)**0.5, 4 / (12.5 + 1e-6)**0.5])
    with pytest.raises(ValueError):
        rms_norm([1], [float("nan")])


def test_swiglu():
    assert silu(0) == pytest.approx(0)
    assert swiglu([0, 0], [2, 3]) == pytest.approx([0, 0])


def test_feed_forward(tmp_path):
    with make(tmp_path, "gate", [2, 2], [0, 0, 0, 0]) as gate, \
         make(tmp_path, "up", [2, 2], [1, 0, 0, 1]) as up, \
         make(tmp_path, "down", [2, 2], [1, 0, 0, 1]) as down:
        assert feed_forward([2, 3], gate, up, down) == pytest.approx([0, 0])
