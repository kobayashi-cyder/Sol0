"""Tiny pre-norm causal Transformer block for Sol0 FP32 experiments.

Single head, full-sequence reference forward; not a Kimi-compatible runtime.
"""
from __future__ import annotations

import math

from solzero.attention_moe import causal_attention
from solzero.f32_layers import feed_forward, matvec, rms_norm


class TinyTransformerBlock:
    def __init__(self, *, q, k, v, o, gate, up, down, norm1, norm2):
        self.q, self.k, self.v, self.o = q, k, v, o
        self.gate, self.up, self.down = gate, up, down
        self.norm1, self.norm2 = list(norm1), list(norm2)
        self._validate_shapes()

    def _validate_shapes(self):
        d = len(self.norm1)
        if d == 0 or len(self.norm2) != d:
            raise ValueError("normalization width mismatch")
        if any(w.shape != (d, d) for w in (self.q, self.k, self.v, self.o)):
            raise ValueError("attention weight dimensions must be [d,d]")
        if len(self.gate.shape) != 2 or self.gate.shape[1] != d:
            raise ValueError("gate weight dimension mismatch")
        hidden = self.gate.shape[0]
        if self.up.shape != (hidden, d) or self.down.shape != (d, hidden):
            raise ValueError("feed-forward weight dimensions mismatch")

    def forward(self, tokens):
        d = len(self.norm1)
        if not tokens or any(len(token) != d for token in tokens):
            raise ValueError("invalid token vectors")
        x = [[float(v) for v in token] for token in tokens]
        if any(not math.isfinite(v) for token in x for v in token):
            raise ValueError("nonfinite token")
        normalized = [rms_norm(token, self.norm1) for token in x]
        queries = [matvec(self.q, token) for token in normalized]
        keys = [matvec(self.k, token) for token in normalized]
        values = [matvec(self.v, token) for token in normalized]
        attention = causal_attention(queries, keys, values)
        residual = [[a + b for a, b in zip(token, matvec(self.o, att))]
                    for token, att in zip(x, attention)]
        normalized2 = [rms_norm(token, self.norm2) for token in residual]
        ff = [feed_forward(token, self.gate, self.up, self.down) for token in normalized2]
        result = [[a + b for a, b in zip(token, delta)]
                  for token, delta in zip(residual, ff)]
        if any(not math.isfinite(v) for token in result for v in token):
            raise ValueError("nonfinite block output")
        return result
