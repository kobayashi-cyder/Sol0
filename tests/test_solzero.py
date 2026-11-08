import unittest
import torch
from solzero.config import ModelConfig, TARGET
from solzero.model import SolZeroLM
from solzero.tokenizer import encode, decode
from solzero.circuit import XorCircuit, xor_score, xor_patch
from solzero.wsp import WeightPatch, WeightEdit
from solzero.budget import budget_report


class SolZeroTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(0)

    def test_byte_tokenizer_roundtrip(self):
        phrase = '0から設計、Sol-Zero！'
        self.assertEqual(decode(encode(phrase)), phrase)

    def test_zero_to_xor_and_rollback(self):
        c = XorCircuit()
        self.assertEqual(xor_score(c), (2, 4))
        p = xor_patch()
        p.apply(c)
        self.assertEqual(xor_score(c), (4, 4))
        p.rollback(c)
        self.assertEqual(xor_score(c), (2, 4))

    def test_invalid_patch_is_atomic(self):
        c = XorCircuit()
        p = WeightPatch([WeightEdit('first.weight', (0, 0), 1.0),
                         WeightEdit('first.weight', (1, 0), float('nan'))])
        with self.assertRaises(ValueError):
            p.apply(c)
        self.assertEqual(float(c.first.weight[0, 0].detach()), 0.0)

    def test_model_shape_and_parameter_count(self):
        cfg = ModelConfig()
        model = SolZeroLM(cfg)
        x = torch.randint(0, 256, (2, 8))
        logits, loss = model(x, x)
        self.assertEqual(tuple(logits.shape), (2, 8, 256))
        self.assertTrue(torch.isfinite(loss))
        self.assertEqual(sum(p.numel() for p in model.parameters()), cfg.parameter_count())

    def test_causal_mask(self):
        model = SolZeroLM(ModelConfig())
        model.eval()
        a = torch.tensor([[3, 4, 5, 6]])
        b = torch.tensor([[3, 4, 100, 101]])
        with torch.no_grad():
            x = model(a)[0][:, :2]
            y = model(b)[0][:, :2]
        self.assertTrue(torch.allclose(x, y, atol=1e-5))

    def test_target_budget(self):
        report = budget_report()
        self.assertEqual(report['target_parameters'], TARGET.parameter_count())
        self.assertTrue(report['fits_planned_budget'])
        self.assertLessEqual(report['storage_budget_bytes'], 5_000_000_000)
        self.assertLessEqual(report['ideal_packed_4bit_bytes'], 1_800_000_000)


if __name__ == '__main__':
    unittest.main()
