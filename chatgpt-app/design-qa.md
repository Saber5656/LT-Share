# ChatGPT内フォーム Design QA

final result: passed

- Product Design 0.1.56 image-to-code / design-qa。
- 正: `docs/design/concepts/post-preview-form-revised.png`。今回の変更理由とターゲットの適用範囲: `docs/chatgpt-app-design.md`。
- 実画面: `docs/design/screenshots/chatgpt-app/20261018-composer.png`。Chromeで390×844 CSS pxの幅、本文は検証用の手入力。ソースは生成済み写真あり、実画面は写真なし/編集済み。状態差を明記し、写真内容やAI生成精度を比較判定しない。
- 比較入力: `docs/design/screenshots/chatgpt-app/comparison.png`。同一入力で白黒配色、4段フォーム、タグ入力、本文編集、開発者欄、ポスト確認、次の投稿の情報階層を比較。端末枠なしのインライン版として適合。
- 18px左右余白とセクション境界、本文/補助文のコントラスト、44pxボタン、折り返しを確認。投稿確認ダイアログを開閉し、本文とタグ/文字数が表示されることを実操作で確認。下部操作のクリップを避けるためテストホストも高さ変更通知に対応。
- ホスト接続通知は試験用ホストとの通信を意味する。スクリーンショット冒頭にも明示。実際のChatGPT画像推論を確認済みとは扱わない。
- P0/P1/P2の視覚的差異なし。キャプチャの状態差は上記の通り。細部は本文欄/ハッシュタグ欄/開発者欄を実画面で拡大確認済み。
- 機能QAは別途、MCP/状態/bridge20件、host fixture E2E6件。実ChatGPTホスト・物理スマホは別の検証。
