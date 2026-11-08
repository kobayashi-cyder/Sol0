"""Zero -> direct programmed weights -> tested XOR neural circuit.

It deliberately uses no training and no pretrained checkpoints.
Inputs are Boolean [x1,x2]. Two hidden ReLU units compute
ReLU(x1-x2) and ReLU(x2-x1); output is their sum.
"""
import torch
from torch import nn
from .wsp import WeightEdit, WeightPatch


class XorCircuit(nn.Module):
    def __init__(self):
        super().__init__()
        self.first = nn.Linear(2, 2, bias=True)
        self.second = nn.Linear(2, 1, bias=True)
        with torch.no_grad():
            for p in self.parameters():
                p.zero_()

    def forward(self, x):
        return self.second(torch.relu(self.first(x))).flatten()


def xor_cases():
    X = torch.tensor([[0., 0.], [0., 1.], [1., 0.], [1., 1.]])
    y = torch.tensor([0., 1., 1., 0.])
    return X, y


def xor_patch():
    return WeightPatch([
        WeightEdit('first.weight', (0, 0), +1.0),
        WeightEdit('first.weight', (0, 1), -1.0),
        WeightEdit('first.weight', (1, 0), -1.0),
        WeightEdit('first.weight', (1, 1), +1.0),
        WeightEdit('second.weight', (0, 0), +1.0),
        WeightEdit('second.weight', (0, 1), +1.0),
    ])


@torch.no_grad()
def xor_score(circuit):
    X, y = xor_cases()
    return int(((circuit(X) > 0.5).float() == y).sum().item()), len(y)
