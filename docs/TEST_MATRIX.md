# Sol0 検証マトリクス

| 領域 | コマンド/ワークフロー | 合格条件 |
|---|---|---|
| JavaScript | `npm test` | 既存と追加回帰が全件合格 |
| Python | `python -m pytest -q tests/test_weight_store.py` | 4bit重みストア境界値が合格 |
| HTML生成 | `python scripts/build_standalone.py` | コミット済みHTMLとバイト一致 |
| HTML内JS | 抽出後に`node --check` | 構文検査成功 |
| ブラウザ | scripts/browser_*_smoke.py | チャット、WSP、メディア、改行、送信が成功 |
| 構図画像 | node --test tests/scene_director.test.mjs / python scripts/browser_scene_smoke.py | 左右の複数主題・配色・画風・プレビュー再現性・実PNGエンコード、GIF8秒制限が合格 |
| バックアップ復元の安全性 | `node --test tests/chat_persistence.test.mjs`、`python scripts/browser_backup_smoke.py` | 不正JSON・破損WSP・容量超過で会話・知識・資料・WSPが変更されず、長文コードの正常復元が再読込後も一致すること |
| 任意モデル接続UI | `python scripts/browser_model_smoke.py` | 既定WSP、事前設定時の通信ゼロ、拒否時の入力保持、同意した1件だけの送信、既存コマンド維持をモックで確認 |
| APK | Androidワークフロー | 単体テスト・ビルド・署名検査・HTML一致 |
| Android15 | エミュレータテスト | オフライン起動、操作、ファイル保存成功 |
| Android17 | 実機手動試験 | IME、再読込、保存、復元、WebM互換性などを記録 |

## 長文WSPの保存試験

1. 3200文字を超えるassistant生成コードを作る。
2. JSONエクスポートと再インポート、およびページ再読み込み後に末尾まで一致するか確認。
3. 20万文字上限、user本文3200文字上限、保存JSON340万文字超拒否、入力JSON400万文字超拒否を確認。
4. 保存不可・容量超過はユーザーに明示し、保存成功と誤表示しない。

Android17物理端末の事前確認には `python android/tests/physical_preflight.py --serial=端末のADB番号 --apk=検証済みAPK` を使用し、端末シリアル番号を記録しない。詳細は [実機検証手順](../android/PHYSICAL_PREFLIGHT.md)。この読み取り専用チェックとIME・保存・メディア手動試験は別の判定とする。

## 実機出荷前チェック

Android機種名、OS、WebView、APK SHA256、テスト操作、結果を記録。デバッグAPKの生成は製品版完成を意味せず、CI成功も実機試験の代わりにはなりません。
