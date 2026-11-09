# Sol0: 復元せず必要な重みだけを読み込む実験

2026-11-09。正本 kobayashi-cyder/Sol0。Qwen/Kimi用のローカル起動UIとは別の、**オンデマンド数値演算の試作**。積み上げDraft PR #7。

## 何ができたか

- **Qwen GGUF：** 従来の tools/model_chunks.mjs が作る SHA-256付き断片manifestから、必要なバイト範囲だけを読み取り、実際に使ったチャンクのみSHA-256照合。1チャンクだけをメモリに保持し、GGUF全体をディスクへ再結合しない。
- **GGUF索引：** v2/v3のメタデータとテンソル索引を48MiB以内で解析し、tokenizer語彙の文字列本体はスキップ。重みテンソルのオフセットを取得する。
- **実演算：** GGML Q8_0（32要素ごとにF16スケール+32個のint8値）を必要な範囲だけ読んでドット積を計算。指定したテンソルの1行全体（最大32768列）にも対応。
- **Kimi safetensors：** model.safetensors.index.json から指定テンソルのシャードを選び、F16/BF16/F32データの一部分だけを読んで数値積を計算。シャード全体をRAMに読み込まない。Kimiの実重みは未実測。
- **GGUF原本の再構成は不要。** ただし、これはTransformerの前向き伝播全体や文章生成ではない。

## 実Qwenの結果

公式 Qwen3-0.6B-Q8_0.gguf を配布元SHA256
9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031
で照合し、8MiBの77個に分割。元のGGUFでPythonが行った独立計算と、断片からのNode Q8数値演算が一致した。さらに原本を**CIの一時領域からのみ削除**した後も計算を再実行し、同じ結果を確認した。

- ブロック32要素の積和：-0.40840578079223633、アクセスした断片は77個中1個。
- Q8量子化テンソル1行全体の積和：-0.005374908447265625（Python独立計算と一致、元GGUFなしで再現）。
- 実Qwen検証：https://github.com/kobayashi-cyder/Sol0/actions/runs/42537182123

上記は**実際の学習済みモデルの重みに対する計算の検証**であり、モデルのテキスト生成能力や「1個の断片だけで文章生成できる」という主張ではない。

## 実験手順

用意したGGUFのモデルファイルを変更せず、別の新規保存フォルダーにチャンクを作成する。

~~~sh
node tools/model_chunks.mjs split \
  --input=/models/Qwen3-0.6B-Q8_0.gguf \
  --out=/models/qwen-chunks \
  --chunk-bytes=8388608
~~~

テンソルのQ8ブロックを部分計算する。

~~~sh
node tools/lazy_gguf_probe.mjs \
  --manifest=/models/qwen-chunks/manifest.json \
  --expected-sha256=9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031
~~~

テンソル1行のすべての重みに対して積和演算する。

~~~sh
node tools/lazy_gguf_probe.mjs \
  --manifest=/models/qwen-chunks/manifest.json \
  --expected-sha256=9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031 \
  --row=0
~~~

CLIの出力には実行したテンソル、アクセスした断片数、数値結果、ディスク再構成=false、文章生成=falseを表示。モデルの配布元が異なる場合は、そのファイルに対応する実ハッシュを確認し、置き換える。**ユーザーの大切な原本は削除しない。** このCIだけが一時領域内のダウンロード原本を消して、断片で計算可能か実証している。

Kimiのローカルsafetensorsからの選択的な数値読み込みは、Nodeから tools/lazy_safetensors.mjs の dotShardedSafetensors を呼ぶ。model.safetensors.index.json がある場合、そのファイル名と対象テンソル名を用いて対象シャードの必要部分だけをseekする。合成BF16/F16/F32テストで確認する。Kimi実モデル・大型MoE・互換GPUのE2Eは未検証。

## 限界と残りの実装

**1トークンの文章生成**でも、埋め込み、各層の正規化、Attention/RoPE、KVキャッシュ、MoEのルーティング、全層の行列演算、最終logits、トークナイザー処理が必要。Q8_0の1行を読み出せても、それらが実装されたことにはならない。KimiはBF16/F16の一部をseekして演算できるが、ほかの量子化形式や巨大MoEの実用的な逐次推論には未対応。

断片を「1個だけロード」できることと、**実際の文章生成で77個のうち1個しか要らない**ことは全く別。全層を実行する際は多くの重みを読み込む。I/O速度・メモリ・ストレージ・GPU・モデルとの整合が必要。CPUへ重みをオフロードするとメモリ要件を再配分できる一方、推論速度が遅くなる可能性がある。

安全性：manifestのハッシュ一致はそのmanifest自身を認証しない。実モデルの出典・ライセンス、モデル全体のSHA256、サードパーティコードを別途確認する。既定WSPは変更せず、Android APKの通信権限や実機動作を新たに保証しない。PR #7はmain未統合。
