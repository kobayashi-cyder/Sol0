"""Minimal CPU-only FP32 linear algebra for Sol0.

Reference implementation, not an optimized inference engine.
"""
from __future__ import annotations

import math

from solzero.weight_store_f32 import WeightStoreF32


def matvec(weights: WeightStoreF32, vector, bias=None):
    """Row-major matrix [out_features, in_features] times a vector."""
    if len(weights.shape) != 2:
        raise ValueError("matrix must be rank 2")
    rows, cols = weights.shape
    if len(vector) != cols:
        raise ValueError("input dimension mismatch")
    x = [float(v) for v in vector]
    if not all(math.isfinite(v) for v in x):
        raise ValueError("nonfinite input")
    if bias is not None:
        if len(bias) != rows:
            raise ValueError("bias dimension mismatch")
        b = [float(v) for v in bias]
        if not all(math.isfinite(v) for v in b):
            raise ValueError("nonfinite bias")
    else:
        b = [0.0] * rows
    output = []
    for row in range(rows):
        result = math.fsum(weights.get((row, col)) * x[col] for col in range(cols)) + b[row]
        if not math.isfinite(result):
            raise ValueError("nonfinite result")
        output.append(result)
    return output


def rms_norm(vector, weight, eps=1e-6):
    """RMSNorm reference primitive, no learned bias."""
    if len(vector) == 0 or len(vector) != len(weight):
        raise ValueError("normalization dimension mismatch")
    if type(eps) not in (int, float) or not math.isfinite(eps) or eps <= 0:
        raise ValueError("invalid epsilon")
    x = [float(v) for v in vector]
    w = [float(v) for v in weight]
    if not all(math.isfinite(v) for v in x + w):
        raise ValueError("nonfinite normalization values")
    denom = math.sqrt(math.fsum(v * v for v in x) / len(x) + eps)
    output = [v / denom * gain for v, gain in zip(x, w)]
    if not all(math.isfinite(v) for v in output):
        raise ValueError("nonfinite normalization result")
    return output


def silu(x):
    """Numerically stable sigmoid linear unit."""
    x = float(x)
    if not math.isfinite(x):
        raise ValueError("nonfinite activation")
    if x >= 0:
        return x / (1 + math.exp(-x))
    ex = math.exp(x)
    return x * ex / (1 + ex)


def swiglu(gate, up):
    if len(gate) != len(up):
        raise ValueError("SwiGLU dimension mismatch")
    return [silu(g) * float(u) for g, u in zip(gate, up)]


def feed_forward(x, gate_weights, up_weights, down_weights):
    """SwiGLU MLP reference layer, explicit weight orientation."""
    gate = matvec(gate_weights, x)
    up = matvec(up_weights, x)
    return matvec(down_weights, swiglu(gate, up))
