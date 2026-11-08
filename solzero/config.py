from dataclasses import dataclass

@dataclass(frozen=True)
class ModelConfig:
    # This demo starts with NEW random tensors; no checkpoint download/load.
    vocab_size: int = 256
    context: int = 48
    width: int = 64
    layers: int = 2
    heads: int = 4
    kv_heads: int = 2
    hidden: int = 128

    def __post_init__(self):
        assert self.width % self.heads == 0
        assert self.heads % self.kv_heads == 0
        assert self.context > 0
        assert self.hidden > 0

    def parameter_count(self) -> int:
        # tied output embedding; bias-free QKV, output projection and SwiGLU
        embed = self.vocab_size * self.width
        layer = (
            self.width * self.width  # Wq
            + 2 * self.width * (self.width // self.heads) * self.kv_heads  # Wk Wv
            + self.width * self.width  # Wo
            + 3 * self.width * self.hidden  # gated FFN
            + 2 * self.width  # RMSNorm x2
        )
        return embed + self.layers * layer + self.width

# Target blueprint; NOT instantiated or trained in this deliverable.
TARGET = ModelConfig(vocab_size=65536, context=4096, width=3072,
                     layers=26, heads=24, kv_heads=8, hidden=8192)
