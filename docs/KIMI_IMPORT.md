# Kimi checkpoint local importer (Phase 3)

This command accepts a **previously downloaded** SafeTensors shard. It does not fetch a model, execute checkpoint code, or transfer any ability to Sol0.

From the repository root:

```sh
python -m scripts.import_kimi_weights \
  --file /path/to/model-00001-of-xxxxx.safetensors \
  --store local_weights/staging \
  --id kimi_shard_001 \
  --origin https://huggingface.co/moonshotai/Kimi-K2-Base \
  --revision YOUR_VERIFIED_UPSTREAM_COMMIT_SHA \
  --model moonshotai/Kimi-K2-Base \
  --license review-required \
  --target-shape 1024 1024
```

The source model name and target shape above are **examples**, not verified compatibility claims. The revision must be the actual immutable upstream commit hash, not a branch name. Confirm the license terms and source before use. The file must already exist locally.

The command validates the SafeTensors header, copies the file to the quarantined weight staging area, verifies SHA-256, and outputs a JSON inspection/compatibility report. No direct weight import is authorized. Single-file limit: 5 GB. Large shards may need a future streaming/sharded strategy. Store checkpoints outside Git.
