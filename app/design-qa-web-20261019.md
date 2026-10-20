# 単独Web版 Design QA

final result: passed

- Product Design 0.1.56 user-context preflight（既存contextあり）、既存の選定済み4段フォームを継承。対象は `docs/DESIGN.md` の2026-10-19節。
- ソース: `docs/design/concepts/post-preview-form-revised.png`。実画面: `docs/design/screenshots/web-20261019/standalone.png`。同じ比較画像は `comparison.png`。
- Chrome、390×844 CSS pxのモバイル幅。写真未選択、AIキー未設定・自動作成不可を表示した状態。本文は検証用の手入力。ソースは写真あり/生成済みの状態のため、写真内容と生成の成否は比較判定しない。
- 白黒、細いセクション区切り、タグチップと入力、記録操作、本文、開発者、固定ポスト確認、次の投稿の位置関係を確認。追加の自動作成設定を記録の下に置き、会話や別カードへ誘導しない。
- 実操作: 初回案内→タグ入力→本文編集。ポスト確認の有効化と文字数更新を確認。写真fixtureの手動入力はChrome拡張のfile URL許可不足でblocked、権限は変更せず。写真→要約→編集はブラウザ自動試験のAPI fixtureで別に確認しており、実API成功とは区別する。
- P0〜P2の視覚的崩れなし。入力と補助文は同一比較入力で拡大して確認。API未設定のチェックボックスはdisabled/OFFで、使用可と誤認させない。
- 未確認: 実Groqキーでの画像推論、物理スマホのカメラ/写真ライブラリ/Xアプリ起動。写真アプリへの直接自動保存はWebでは未達。
