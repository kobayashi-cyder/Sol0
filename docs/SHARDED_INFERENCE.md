# Sol0: モデルを分割したまま文章生成する（テンソル分割GGUF）

## 2種類の分割を区別する

1. **任意サイズのバイト断片（tools/model_chunks.mjs）**：情報を損なわず保存・復元でき、tools/lazy_gguf.mjsではその一部の重みを直接読んでQ8数値演算できる。ただし、通常のllama-serverはこの任意断片をそのままモデルとして読み込まない。
2. **推論エンジンが理解するテンソル単位のGGUFシャード（llama-gguf-split）**：各ファイルが独立したGGUF構造・分割メタデータを持つ。llama.cppは最初のシャードを指定すれば残りのシャードを検出でき、**元の単体GGUFに結合することなく全層の推論とテキスト生成を実行できる**。ディスクへのファイル結合を省くが、モデル全層の計算とRAM/VRAM/KVキャッシュは省略できない。

これは「重みバイトを扱うための筋道」を付ける方法。食物繊維をLLMに食べさせるのではなく、**どのテンソルがどのシャードにあるかの構造情報**が重要になる。

公式仕様：
- https://github.com/ggml-org/llama.cpp/blob/master/tools/gguf-split/README.md
- https://github.com/ggml-org/llama.cpp/discussions/6404

## Qwenを分割して推論する

必要なものはローカルの公式Qwen GGUF、別途用意したllama.cppのllama-gguf-splitとllama-server、Node.js 22+。

これは例。ユーザーの重要な原本は消去せず、別ディレクトリで作業する。

~~~sh
mkdir -p /models/qwen-shards

# 元のGGUFのテンソルを32個ずつ、推論可能なGGUFシャードへ分割
llama-gguf-split --split-max-tensors 32 \
  /models/Qwen3-0.6B-Q8_0.gguf \
  /models/qwen-shards/qwen3-q8

# 出力される ...-00001-of-000NN.gguf を最初の1個として指定。
# 後続シャードは同じフォルダにすべて必要。
node tools/qwen_local.mjs \
  --model=/models/qwen-shards/qwen3-q8-00001-of-000NN.gguf

# 起動後、Sol0ブラウザから明示承認して送信。
# 外部送信は127.0.0.1のローカルAPIに限定。
~~~

実際の NN は出力結果に合わせる。ファイル名やシャード数を固定して決めつけない。各シャードは生成後に個別ハッシュを保存し、後続の実行では検証してから使う。元のモデルはダウンロード元のSHA256で照合する。分割元の重みやハッシュ一覧をGitにコミットしない。

**メモリを節約する追加設定例**：Qwenローカル起動ツールは --gpu-layers=0（CPU主体）、--cpu-moe-layers=N（対応MoEモデルなら一部の専門家重みをCPUへ配置）をサポートする。これらは推論用の必要RAMをなくすものではなく、速度と配置のトレードオフである。

## CI上の実証

- バイト分割のままQ8の部分・行演算：公式Qwen3-0.6B-Q8_0.gguf 77個のバイト断片から、原本GGUFを削除してPythonの独立計算と一致する結果を取得。独立の数値演算実験（https://github.com/kobayashi-cyder/Sol0/actions/runs/42537182123）。
- **テンソル分割による文章生成に成功**：Actions [#42537608185](https://github.com/kobayashi-cyder/Sol0/actions/runs/42537608185)で、公式Qwen3-0.6B-Q8_0のSHA256を確認し、llama-gguf-splitで10個のGGUFへテンソル分割、元の単体GGUFを削除、最初のシャードをllama-serverに渡してSol0の同意付きHTTP推論アダプター経由で日本語の回答を取得した。実HTTP応答705ms、空でない回答、WSPへのfallbackなし。モデル品質やメモリ効率の定量評価を意味しない。

## Kimiへの適用

Kimiの公式safetensorsはすでに多数のシャードに分割され、vLLMはそれらを読み込む設計。Sol0には指定されたsafetensorsシャードの一部をF16/BF16/F32として直接計算する試験を追加済み。ただし、そのカーネルはKimiのMoE全層を実行できない。Kimiモデルを実際にロードして日本語テキストを生成するE2Eは、対応GPU・全重み・モデル固有の推論ランタイムが必要で未検証。

## 安全上の境界

- GGUFやsafetensorsは不正なバイナリになり得る。未知のファイルを無条件で起動せず、配布元・SHA256・ライセンス・ランタイムの出所を確認する。
- シャードを少数読む数値テストに成功しても、文章生成時に同じ少数の断片だけで済むとは言えない。逐次ロードによって性能が大幅に落ちる場合もある。
- Sol0は今も既定WSPオフライン。Android APKの通信権限は変更していない。Android17実機とKimi実モデルの推論は未実証。全機能をSol0独自エンジンへ移植したとは主張しない。
