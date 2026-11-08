"""Run proof of WSP circuit and optionally train tiny next-byte model from scratch."""
import argparse
import json
import random
import torch
from .config import ModelConfig
from .tokenizer import encode, decode
from .model import SolZeroLM
from .circuit import XorCircuit, xor_score, xor_patch
from .budget import budget_report


def circuit_demo():
    c = XorCircuit()
    before = xor_score(c)
    patch = xor_patch()
    patch.apply(c)
    after = xor_score(c)
    patch.rollback(c)
    restored = xor_score(c)
    report = {'before': before, 'after': after, 'rollback': restored,
              'direct_changes': len(patch.edits),
              'gradient_steps': 0, 'external_weights_used': False}
    print(json.dumps(report, ensure_ascii=False))
    assert before == (2, 4) and after == (4, 4) and restored == (2, 4)
    return report


def train_demo(steps: int = 30):
    # Tiny pedagogical dataset built in code: this does NOT produce useful general intelligence.
    torch.set_num_threads(2)
    seed = 13
    torch.manual_seed(seed)
    random.seed(seed)
    corpus = (('Question: 1+1?\nAnswer: 2.\n'
               'Question: 2+2?\nAnswer: 4.\n'
               'Question: 3+3?\nAnswer: 6.\n') * 100)
    ids = torch.tensor(encode(corpus), dtype=torch.long)
    cfg = ModelConfig(context=32, width=48, layers=2, heads=4, kv_heads=2, hidden=96)
    model = SolZeroLM(cfg)
    optim = torch.optim.AdamW(model.parameters(), lr=0.003)
    def batch():
        starts = torch.randint(0, len(ids) - cfg.context - 1, (16,))
        x = torch.stack([ids[int(s):int(s)+cfg.context] for s in starts])
        y = torch.stack([ids[int(s)+1:int(s)+cfg.context+1] for s in starts])
        return x, y
    x0, y0 = batch()  # fixed evaluation batch; not held-out generalization.
    with torch.no_grad():
        initial_loss = float(model(x0, y0)[1])
    model.train()
    for _ in range(steps):
        x, y = batch()
        optim.zero_grad(set_to_none=True)
        _, loss = model(x, y)
        loss.backward()
        optim.step()
    model.eval()
    with torch.no_grad():
        final_loss = float(model(x0, y0)[1])
    print(json.dumps({
        'random_initialization': True,
        'dataset_generated_locally': True,
        'checkpoint_loaded': False,
        'parameters': sum(p.numel() for p in model.parameters()),
        'training_steps': steps, 'initial_fixed_batch_loss': round(initial_loss, 4),
        'final_fixed_batch_loss': round(final_loss, 4),
        'warning': 'This is an elementary data-fitting test, not an intelligence benchmark.'
    }, ensure_ascii=False))
    return initial_loss, final_loss


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['circuit', 'train', 'budget'], default='circuit')
    parser.add_argument('--steps', type=int, default=30)
    args = parser.parse_args()
    if args.mode == 'circuit':
        circuit_demo()
    elif args.mode == 'train':
        train_demo(args.steps)
    else:
        print(json.dumps(budget_report(), indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
