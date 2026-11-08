"""Auditable weight-space edits: named scalar coordinates, no optimizer required."""
from dataclasses import dataclass
from math import isfinite
import torch
from torch import nn


@dataclass(frozen=True)
class WeightEdit:
    tensor: str
    index: tuple[int, ...]
    value: float


class WeightPatch:
    def __init__(self, edits: list[WeightEdit], max_abs: float = 100.0):
        if not edits:
            raise ValueError('patch must have at least one edit')
        self.edits = edits
        self.max_abs = max_abs
        self.undo_log: list[tuple[str, tuple[int, ...], float]] = []
        self.applied = False

    @torch.no_grad()
    def apply(self, model: nn.Module):
        if self.applied:
            raise RuntimeError('patch already applied')
        params = dict(model.named_parameters())
        # Validate ALL changes before touching any tensor.
        for edit in self.edits:
            if edit.tensor not in params:
                raise KeyError(edit.tensor)
            p = params[edit.tensor]
            if len(edit.index) != p.ndim or any(i < 0 or i >= n for i, n in zip(edit.index, p.shape)):
                raise IndexError((edit.tensor, edit.index))
            if not isfinite(edit.value) or abs(edit.value) > self.max_abs:
                raise ValueError('unsafe patch value')
        originals = {}
        for edit in self.edits:
            key = (edit.tensor, edit.index)
            if key not in originals:
                originals[key] = float(params[edit.tensor][edit.index].item())
            params[edit.tensor][edit.index] = edit.value
        self.undo_log = [(name, index, val) for (name, index), val in originals.items()]
        self.applied = True

    @torch.no_grad()
    def rollback(self, model: nn.Module):
        if not self.applied:
            raise RuntimeError('patch not applied')
        params = dict(model.named_parameters())
        for name, index, old in self.undo_log:
            params[name][index] = old
        self.applied = False
