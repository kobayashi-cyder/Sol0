"""A compact causal Transformer created from random initial weights.

Math & ideas such as RMSNorm, GQA, rotary embeddings and SwiGLU are public
algorithms; not imported weights. PyTorch is just a numerical library.
"""
import torch
from torch import nn
from torch.nn import functional as F
from .config import ModelConfig


class RMSNorm(nn.Module):
    def __init__(self, d: int):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(d))

    def forward(self, x):
        y = x * torch.rsqrt(x.square().mean(dim=-1, keepdim=True) + 1e-6)
        return y * self.weight


def apply_rotary(q: torch.Tensor, k: torch.Tensor):
    dim = q.shape[-1]
    assert dim % 2 == 0
    n = q.shape[-2]
    inverse_freq = 1.0 / (10000 ** (torch.arange(0, dim, 2, device=q.device).float() / dim))
    phase = torch.outer(torch.arange(n, device=q.device).float(), inverse_freq)
    cos, sin = phase.cos()[None, None], phase.sin()[None, None]

    def rotate(t):
        a, b = t[..., ::2], t[..., 1::2]
        return torch.stack([a * cos - b * sin, a * sin + b * cos], -1).flatten(-2)

    return rotate(q), rotate(k)


class Attention(nn.Module):
    def __init__(self, c: ModelConfig):
        super().__init__()
        self.h, self.hkv, self.d = c.heads, c.kv_heads, c.width // c.heads
        self.q = nn.Linear(c.width, c.width, bias=False)
        self.k = nn.Linear(c.width, c.kv_heads * self.d, bias=False)
        self.v = nn.Linear(c.width, c.kv_heads * self.d, bias=False)
        self.out = nn.Linear(c.width, c.width, bias=False)

    def forward(self, x):
        B, T, _ = x.shape
        q = self.q(x).view(B, T, self.h, self.d).transpose(1, 2)
        k = self.k(x).view(B, T, self.hkv, self.d).transpose(1, 2)
        v = self.v(x).view(B, T, self.hkv, self.d).transpose(1, 2)
        q, k = apply_rotary(q, k)
        if self.hkv != self.h:
            factor = self.h // self.hkv
            k = k.repeat_interleave(factor, dim=1)
            v = v.repeat_interleave(factor, dim=1)
        a = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        return self.out(a.transpose(1, 2).contiguous().view(B, T, self.h * self.d))


class Block(nn.Module):
    def __init__(self, c: ModelConfig):
        super().__init__()
        self.norm_attn = RMSNorm(c.width)
        self.attn = Attention(c)
        self.norm_ffn = RMSNorm(c.width)
        self.gate = nn.Linear(c.width, c.hidden, bias=False)
        self.up = nn.Linear(c.width, c.hidden, bias=False)
        self.down = nn.Linear(c.hidden, c.width, bias=False)

    def forward(self, x):
        x = x + self.attn(self.norm_attn(x))
        y = self.norm_ffn(x)
        return x + self.down(F.silu(self.gate(y)) * self.up(y))


class SolZeroLM(nn.Module):
    def __init__(self, c: ModelConfig):
        super().__init__()
        self.config = c
        self.emb = nn.Embedding(c.vocab_size, c.width)
        self.blocks = nn.ModuleList(Block(c) for _ in range(c.layers))
        self.norm = RMSNorm(c.width)
        self.output = nn.Linear(c.width, c.vocab_size, bias=False)
        self.output.weight = self.emb.weight  # tied; counted only once
        self.reset_weights()

    def reset_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Embedding):
                nn.init.normal_(m.weight, mean=0.0, std=0.02)
            elif isinstance(m, nn.Linear) and m.weight is not self.emb.weight:
                nn.init.normal_(m.weight, mean=0.0, std=0.02)

    def forward(self, idx: torch.Tensor, targets: torch.Tensor | None = None):
        if idx.ndim != 2 or idx.shape[1] > self.config.context:
            raise ValueError('expected [batch,time] and time <= context')
        x = self.emb(idx)
        for block in self.blocks:
            x = block(x)
        logits = self.output(self.norm(x))
        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.reshape(-1, self.config.vocab_size), targets.reshape(-1))
        return logits, loss

    @torch.no_grad()
    def generate(self, prefix: list[int], steps: int = 50) -> list[int]:
        self.eval()
        ids = list(prefix)
        for _ in range(steps):
            x = torch.tensor([ids[-self.config.context:]], dtype=torch.long,
                             device=self.emb.weight.device)
            logits, _ = self(x)
            ids.append(int(logits[0, -1].argmax()))
        return ids
