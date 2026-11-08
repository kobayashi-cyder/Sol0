# FFC SolZero → Sol0 移行記録

移行元: https://github.com/kobayashi-cyder/FFC-FlyFromCodex/tree/main/projects/sol-zero

旧`projects/sol-zero`のWeb UI、WSP、BANC認知コア、タスク工房、メディア工房、Pythonモデル、Android WebView、Node/Pythonテスト、ブラウザ検証、ビルドスクリプトをSol0のルートへ移しています。

旧版配布ZIP(`releases/`)と再生成可能な`samples/`バイナリは、現在版の誤配布防止とリポジトリ軽量化のため移行していません。旧READMEは`docs/LEGACY_FEATURES.md`に保持しました。

統合する既知の修正:
- FFC PR #80: パッケージv0.16への整合
- FFC PR #81: GIF時間上限の直接API適用
- FFC PR #82: Enterで改行し明示送信
- FFC PR #69のレビュー指摘: 保存済み長文WSPコードの復元時欠落を修正

元リポジトリのPRを自動でマージ・クローズしていません。新リポジトリを独立した開発対象とし、旧コードの機能と限界は明示して継承します。
