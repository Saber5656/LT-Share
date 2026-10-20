# 写真ライブラリ選択の画面確認（2026-10-20）

- source visual truth: 既存composerの変更前キャプチャ `lt-share-library-before.png`。承認済みフォーム設計は `../docs/DESIGN.md`。
- implementation screenshots: `lt-share-library-after-empty-full.png` / `lt-share-library-after-empty-viewport.png` / `lt-share-library-after-saved-photo-viewport.png` / `lt-share-library-after-saved-photo-bottom-viewport.png`。
- 画像の保存先: Agents Vault `01-Projects/lt-share/media-library-20261020/`。端末固有の絶対パスは含めない。
- 比較条件: Chromium、CSS viewport 390×844、deviceScaleFactor 2、白背景、初回案内済み・空の投稿案・AI接続済み（テストスタブ）。画像幅はいずれも780px。全ページ画像は変更前2338px高、変更後2446px高（選択ボタン54CSS px追加）。viewport画像は780×1688。リサイズせず同じ密度で比較。
- 変更前と変更後を同じ比較入力に並べて確認。固定フッターが全ページ画像の途中に入るため、viewport画像とChromeの実画面スクロールで補完した。
- IABはBrowser is not availableで利用不可。Chromeへ切り替えて既存画面と追加ボタンを確認した。物理iPhoneの写真選択シートではない。

## Findings

対処が必要なP0/P1/P2はなし。記録欄のプレビュー直下に全幅の「写真・動画を選ぶ」が入り、撮影の写真/動画切替とは区別できる。前の画面に対する高さの追加は意図した機能追加。

- Fonts/typography: 既存のInterと日本語システムフォント、本文・補助文の階層を維持。ボタンは既存と同じ文字サイズ・太さ。
- Spacing/layout: 既存左右余白、区切り、角丸を維持。ヘッダーに操作を詰めず、選択ボタンは44px高＋上余白10px。撮影操作や固定ポスト確認を隠さない。
- Colors/tokens: 既存の白・黒・グレーと保存確認の緑を維持。新規色・影はなし。
- Image quality/assets: Phosphor Imagesアイコンを利用。写真プレビューは既存の描画を共用し、追加画像素材なし。
- Copy/content: 撮影「記録する」とライブラリ「写真・動画を選ぶ」を分けた。原本の存在は本人が確認し、選択しただけで保存完了と表示しない。
- Focused evidence: 保存済み写真のviewport画像でプレビュー・保存状態・選択ボタンを確認でき、別の拡大クロップは不要。

## Comparison history

初回比較で視覚上のP0/P1/P2なし。要約内容はテスト用であり、画像からの実モデル精度を評価する比較ではない。

## Checks and limits

写真/動画取り込み、キャンセル、置き換え、同一ファイル再選択、原本確認と復元をE2Eで確認した（全57件成功、新規8件）。Unit全129件・typecheck成功。物理スマホのOS pickerは未検証。既存サーバー要約のモデル・保存先・公開対象は変更しない。

final result: passed
