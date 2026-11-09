"""Small CPU reference attention and sparse mixture-of-experts primitives.

These operate on numerical vectors; no Kimi-specific architecture is assumed.
"""
from __future__ import annotations

import math

from solzero.f32_layers import matvec


def softmax(scores):
    if not scores:
        raise ValueError("empty scores")
    values = [float(s) for s in scores]
    if not all(math.isfinite(s) for s in values):
        raise ValueError("nonfinite score")
    peak = max(values)
    exps = [math.exp(s - peak) for s in values]
    denom = math.fsum(exps)
    return [v / denom for v in exps]


def causal_attention(queries, keys, values, *, scale=None):
    """Single-head causal attention for equal-length sequences of vectors."""
    if not queries or len(queries) != len(keys) or len(keys) != len(values):
        raise ValueError("sequence length mismatch")
    width = len(queries[0])
    value_width = len(values[0])
    if width <= 0 or value_width <= 0:
        raise ValueError("empty vectors")
    if any(len(q) != width for q in queries) or any(len(k) != width for k in keys):
        raise ValueError("Q/K dimension mismatch")
    if any(len(v) != value_width for v in values):
        raise ValueError("V dimension mismatch")
    if scale is None:
        scale = 1.0 / math.sqrt(width)
    if type(scale) not in (float, int) or not math.isfinite(scale) or scale <= 0:
        raise ValueError("invalid attention scale")
    all_vectors = queries + keys + values
    if any(not math.isfinite(float(x)) for vector in all_vectors for x in vector):
        raise ValueError("nonfinite attention input")
    outputs = []
    for t, query in enumerate(queries):
        logits = [math.fsum(float(a) * float(b) for a, b in zip(query, key)) * scale
                  for key in keys[:t + 1]]
        probabilities = softmax(logits)
        outputs.append([math.fsum(p * float(value[d])
                                  for p, value in zip(probabilities, values[:t + 1]))
                        for d in range(value_width)])
    return outputs


def topk_router(logits, k):
    """Select top-k experts; renormalize their softmax weights."""
    if type(k) is not int or not 1 <= k <= len(logits):
        raise ValueError("invalid expert count")
    scores = [float(s) for s in logits]
    if not all(math.isfinite(s) for s in scores):
        raise ValueError("nonfinite routing score")
    selected = sorted(range(len(scores)), key=lambda i: (-scores[i], i))[:k]
    probabilities = softmax([scores[i] for i in selected])
    return list(zip(selected, probabilities))


def sparse_moe(vector, router_weights, expert_functions, *, top_k=2):
    """Route one token to selected experts; each expert maps vector to vector."""
    if len(expert_functions) != router_weights.shape[0]:
        raise ValueError("router/expert count mismatch")
    routing = topk_router(matvec(router_weights, vector), top_k)
    outputs = [(probability, expert_functions[index](vector))
               for index, probability in routing]
    width = len(vector)
    if any(len(output) != width for _, output in outputs):
        raise ValueError("expert output dimension mismatch")
    if any(not math.isfinite(float(v)) for _, output in outputs for v in output):
        raise ValueError("nonfinite expert output")
    return [math.fsum(probability * float(output[d]) for probability, output in outputs)
            for d in range(width)]
