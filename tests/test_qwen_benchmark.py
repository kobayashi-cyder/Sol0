"""No-network unit checks for Sol0 CPU RAM/latency measurement tooling."""
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.benchmark_qwen_shards import parse_args, parse_proc_status


class BenchmarkValidationTests(unittest.TestCase):
    def test_proc_memory_fields_are_read_in_kib_not_bytes(self):
        raw = (
            "Name:\tllama-server\n"
            "VmRSS:\t  123456 kB\n"
            "VmHWM:\t  178904 kB\n"
            "VmSwap:\t       0 kB\n"
            "Threads:\t3\n"
        )
        self.assertEqual(parse_proc_status(raw), {
            "VmRSS": 123456, "VmHWM": 178904, "VmSwap": 0
        })

    def test_proc_parser_refuses_malformed_memory_units(self):
        with self.assertRaises(ValueError):
            parse_proc_status("VmRSS: 300 MB")
        with self.assertRaises(ValueError):
            parse_proc_status("VmHWM: -5 kB")

    def test_explicit_input_and_output_are_required(self):
        with self.assertRaises(SystemExit):
            parse_args([])
        with tempfile.TemporaryDirectory() as temp:
            a = Path(temp) / "original.gguf"
            b = Path(temp) / "shard.gguf"
            runner = Path(temp) / "llama-server"
            output = Path(temp) / "benchmark.json"
            original = [
                "--original=" + str(a),
                "--shard-first=" + str(b),
                "--runner=" + str(runner),
                "--output=" + str(output),
            ]
            parsed = parse_args(original)
            self.assertEqual(parsed.repetitions, 2)
            self.assertEqual(parsed.port, 9945)
            self.assertRaises(SystemExit, parse_args, original + ["--repetitions=0"])
            self.assertRaises(SystemExit, parse_args, original + ["--repetitions=4"])
            self.assertRaises(SystemExit, parse_args, original + ["--port=80"])
            self.assertRaises(SystemExit, parse_args, original + ["--port=65536"])
            self.assertRaises(
                SystemExit, parse_args,
                [original[0], "--shard-first=" + str(a)] + original[2:]
            )
            output.write_text("keep existing result", encoding="utf-8")
            self.assertRaises(SystemExit, parse_args, original)
            self.assertEqual(output.read_text(encoding="utf-8"), "keep existing result")


if __name__ == "__main__":
    unittest.main()
