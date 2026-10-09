# 先行検証の記録（G-01〜G-03）

要件定義書 [LT-SRS-001](requirements.md) 8章の先行検証について、確認した内容と現時点の判断を記録する。

| ID | 状態 | 現時点の判断 |
| --- | --- | --- |
| G-01 Sites × 利用者のChatGPT利用枠 | **不成立（公開資料の範囲）** | v1 は AI 生成なし（手入力）で提供。方式はプロダクトオーナーの判断待ち |
| G-02 Webでの写真・動画の端末保存 | 実装済み・**実機未確認** | 共有シート（iOS「画像を保存」等）またはダウンロードで保存し、本人の確認で「保存済み」にする |
| G-03 Xへの本文・メディア受け渡し | 実装済み・**実機未確認** | 本文は X の投稿用リンク、写真・動画は共有シートまたは手動添付 |

## G-01 の確認内容（2026-10-09）

確認先は OpenAI の公開ドキュメントと、Codex に導入済みの Sites プラグイン（0.1.75）の手順書。

1. **Sites のサインイン（Sign in with ChatGPT）は本人確認のみ。** サイトには利用者の ID・メールが渡るが、モデル実行に使えるトークンは渡らない（「SIWC as authentication」「The platform owns scopes/credentials」）。
2. **Sites で AI を使う手順として案内されているのは `OPENAI_API_KEY` を Site の秘密値に置く方式。** これはサーバー処理と従量課金の API を使うため、C-02（独自サーバー処理なし）と C-04（本人の利用枠）に反する。
3. **利用者の ChatGPT 利用枠を使う仕組み（ChatGPT plan usage）は、オープンソースかつローカルで動くアプリ向け。** ログイン後の戻り先は `http://127.0.0.1:<port>/auth/callback` のループバック限定で、認証情報は端末内のファイルに保存する設計。リモートでホストするアプリや商用アプリは、申請フォームから OpenAI の承認を得る必要がある。
   - https://developers.openai.com/siwc/token-sharing-open-source
   - https://developers.openai.com/siwc/token-sharing-open-source/sign-in
   - https://developers.openai.com/siwc/request-client-id
4. **Codex app-server は、アプリの子プロセスとしてローカルで動かすもの。** シェルコマンドを実行できるため、信頼できないネットワークや利用者に公開しない。1人のトークンで他の利用者をまかなわない。
   - https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
   - https://learn.chatgpt.com/docs/app-server
5. 対応する入力は文字・画像・ファイル。音声・動画の直接入力と文字起こしは対象外（S-04 と同じ）。
   - https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations

### 取り得る方針（未決定）

| 方針 | 要件との関係 | 必要な対応 |
| --- | --- | --- |
| A. OpenAI の承認を得て、Sites 上のアプリで本人の利用枠を使う | C-02/C-04 を維持 | プロダクトオーナーが関心フォームを提出し、承認後に実装 |
| B. 本人の Mac 上でローカルの中継を動かし、スマホから接続する | C-02 に反する（自前の中継サーバー）。Mac の常時起動と安全な外部接続が必要 | 非推奨 |
| C. API キー（従量課金）を Site の秘密値に置き、サーバー処理から呼ぶ | C-02/C-04/FR-05 の変更が必要 | 要件変更の判断と API キーの用意 |
| D. 手入力のまま提供する（v1 の現状） | 要件の AI 部分（FR-05）は未達 | なし |

アプリ側は `app/src/lib/ai.ts` の `getAiProvider()` に提供元を差し込めば、生成中・失敗・再試行の表示がそのまま使える構成にしている。
