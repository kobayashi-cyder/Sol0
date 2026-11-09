"""Tiny token-level inference harness for Sol0's reference Transformer.

Uses explicitly supplied integer token IDs and untrained FP32 weights.
No Kimi tokenizer, weights, or architecture compatibility is implied.
"""
from __future__ import annotations

import math

from solzero.f32_layers import matvec
from solzero.tiny_transformer import TinyTransformerBlock


class TinyTokenModel:
    def __init__(self, *, embeddings, block: TinyTransformerBlock, lm_head):
        if len(embeddings.shape) != 2 or len(lm_head.shape) != 2:
            raise ValueError("embedding and head must be matrices")
        vocab, width = embeddings.shape
        if vocab < 2 or width < 1 or lm_head.shape != (vocab, width):
            raise ValueError("vocabulary/head dimension mismatch")
        if len(block.norm1) != width:
            raise ValueError("Transformer width mismatch")
        self.embeddings = embeddings
        self.block = block
        self.lm_head = lm_head
        self.vocab_size = vocab
        self.width = width

    def forward_logits(self, token_ids):
        if not token_ids:
            raise ValueError("at least one token required")
        if len(token_ids) > 128:
            raise ValueError("reference context limit is 128 tokens")
        if any(type(t) is not int or not 0 <= t < self.vocab_size for t in token_ids):
            raise ValueError("token ID out of range")
        vectors = [
            [self.embeddings.get((token_id, j)) for j in range(self.width)]
            for token_id in token_ids
        ]
        hidden = self.block.forward(vectors)
        logits = matvec(self.lm_head, hidden[-1])
        if not all(math.isfinite(v) for v in logits):
            raise ValueError("nonfinite logits")
        return logits

    def generate(self, prompt, *, max_new_tokens=1):
        if type(max_new_tokens) is not int or not 0 <= max_new_tokens <= 128:
            raise ValueError("invalid generation limit")
        sequence = list(prompt)
        self.forward_logits(sequence)
        for _ in range(max_new_tokens):
            logits = self.forward_logits(sequence)
            # Deterministic greedy decoding; ties select lowest token ID.
            sequence.append(max(range(self.vocab_size), key=lambda i: logits[i]))
        return sequence
