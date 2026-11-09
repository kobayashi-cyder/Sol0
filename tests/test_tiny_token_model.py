import pytest
from solzero.weight_store_f32 import WeightStoreF32
from solzero.tiny_transformer import TinyTransformerBlock
from solzero.tiny_token_model import TinyTokenModel


def create(tmp_path, name, shape, values):
    w = WeightStoreF32.create(tmp_path / name, shape)
    for i, value in enumerate(values):
        w.set(i, value)
    return w


def test_tiny_token_forward_and_greedy(tmp_path):
    stores = {}
    try:
        stores["embeddings"] = create(tmp_path, "embeddings", [3, 2],
                                       [1, 0, 0, 1, 1, 1])
        stores["lm_head"] = create(tmp_path, "lm_head", [3, 2],
                                    [0, 0, 2, 0, 0, 1])
        for name in ("q", "k", "v", "o", "gate", "up", "down"):
            stores[name] = create(tmp_path, name, [2, 2], [0, 0, 0, 0])
        block = TinyTransformerBlock(**{k: stores[k] for k in
            ("q", "k", "v", "o", "gate", "up", "down")},
            norm1=[1, 1], norm2=[1, 1])
        model = TinyTokenModel(embeddings=stores["embeddings"],
                               block=block, lm_head=stores["lm_head"])
        assert model.forward_logits([0]) == pytest.approx([0, 2, 0])
        assert model.generate([0], max_new_tokens=2) == [0, 1, 2]
        with pytest.raises(ValueError):
            model.forward_logits([3])
    finally:
        for store in stores.values():
            store.close()


def test_context_limit(tmp_path):
    stores = {}
    try:
        stores["embeddings"] = create(tmp_path, "embeddings", [2, 1], [1, 2])
        stores["lm_head"] = create(tmp_path, "lm_head", [2, 1], [1, 2])
        for name in ("q", "k", "v", "o", "gate", "up", "down"):
            stores[name] = create(tmp_path, name, [1, 1], [0])
        block = TinyTransformerBlock(**{k: stores[k] for k in
            ("q", "k", "v", "o", "gate", "up", "down")},
            norm1=[1], norm2=[1])
        model = TinyTokenModel(embeddings=stores["embeddings"],
                               block=block, lm_head=stores["lm_head"])
        with pytest.raises(ValueError, match="context"):
            model.forward_logits([0] * 129)
    finally:
        for store in stores.values():
            store.close()
