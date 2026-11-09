import pytest
from solzero.weight_store_f32 import WeightStoreF32
from solzero.attention_moe import causal_attention, softmax, topk_router, sparse_moe


def test_causal_attention_never_reads_future():
    q = [[1.0], [1.0]]
    k = [[0.0], [0.0]]
    result = causal_attention(q, k, [[2.0], [10.0]])
    assert result[0] == pytest.approx([2.0])
    assert result[1] == pytest.approx([6.0])
    changed = causal_attention(q, k, [[2.0], [1000.0]])
    assert changed[0] == pytest.approx([2.0])


def test_stable_softmax_and_router():
    assert softmax([1000.0, 1000.0]) == pytest.approx([0.5, 0.5])
    chosen = topk_router([1.0, 3.0, 2.0], 2)
    assert [i for i, _ in chosen] == [1, 2]
    assert sum(p for _, p in chosen) == pytest.approx(1.0)
    with pytest.raises(ValueError):
        topk_router([1.0], 2)


def test_sparse_moe(tmp_path):
    with WeightStoreF32.create(tmp_path / "router", [3, 1]) as weights:
        for i, value in enumerate([0.0, 2.0, 1.0]):
            weights.set(i, value)
        experts = [lambda x: [100.0], lambda x: [2.0], lambda x: [4.0]]
        result = sparse_moe([1.0], weights, experts, top_k=2)
        assert 2.0 < result[0] < 4.0
