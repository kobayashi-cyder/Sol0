# Weight staging / 重み仮置場

`solzero.weight_staging.WeightStaging` は外部モデル重みの隔離保管庫です。
既存の `WeightStore4` と異なり、モデルへの重み適用・量子化・実行はしません。

```python
from solzero.weight_staging import WeightStaging

staging = WeightStaging("local_weights/staging")
record = staging.stage(
    "/path/to/authorized/model.safetensors",
    artifact_id="kimi_candidate_001",
    origin="公開モデルの取得元URLまたはローカル出所",
    license_id="確認したライセンス名",
    model="取得したモデルの識別子",
)
print(staging.inspect("kimi_candidate_001"))  # SHA-256を再検証
```

- 入力をコピーしSHA-256・サイズ・出所・ライセンス・モデル名を記録します。
- 既存IDの上書き禁止。最大5GB/ファイル。サポート拡張子は safetensors, gguf, bin, npz, pt, pth。
- **拡張子は安全性を保証しません。** .pt/.pth等をtorch.loadで安易に開かないでください。
- 全件 `quarantined` / `compatible: null` として登録。互換性確認とライセンス確認が済むまで実行系には接続しません。
- 重みファイルをGitにコミットせず、`local_weights/` 等のローカルディレクトリへ保管してください。
- Kimiからのダウンロード、能力移植、LLM推論はこの機能の範囲外です。
