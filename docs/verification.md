# 先行検証の記録（G-01〜G-03）

要件定義書 [LT-SRS-001](requirements.md) 8章の先行検証について、確認した内容と現時点の判断を記録する。

## 現在の採用方針と接続状況（2026-10-18）

利用者の選択により、**Sitesで単独利用できるWebアプリを維持する**。ChatGPT内アプリへの移行は採用しない。利用者はChatGPTとXの有料契約済みを前提にしてよいが、別途API課金を行う許可とは扱わない。

既存Siteは稼働中で、標準のサインイン設定がある。公開先の環境変数は未設定で、現在のソースにも本人のChatGPT利用枠に接続する実装はない。この確認は「Sitesでは不可能」という結論ではなく、**現行アプリはAI未接続**という事実である。

OpenAIの[ChatGPT plan usage公式資料](https://developers.openai.com/siwc/token-sharing-open-source)は、外部ホスト型アプリには[関心フォーム](https://openai.com/form/sign-in-with-chatgpt-interest/)を案内している。LT Share用の申請・承認状況と、承認後に提供される接続仕様が未確認のため、利用者へ状況を確認中。標準Sitesログイン用のclient IDを、利用枠連携の承認として流用しない。

接続仕様を入手したら、対応するWebの戻り先、必要な権限、モデルの取得・画像入力、利用枠の確認、失敗時の扱いを検証する。サーバー処理が必須の方式なら、フロントのみの制約との整合を確認してから採用する。承認された接続方式のない段階で動作するOAuthボタンや架空の接続先を作らない。

現在の実装済み範囲は、記録の取り込み、端末への保存導線、投稿文の手入力、ハッシュタグの引き継ぎ、任意の開発者ラベル、投稿案の端末内保存、Xへの受け渡し。AI自動生成（FR-05/06）とGrokによるアプリ内の開発者検索は未実装。Grok Botの契約枠をこの静的Siteから使う公式接続方式も未確認であり、XやGrokの契約だけを根拠に接続済みとは扱わない。

## 2026-10-18 再調査による訂正

本人のChatGPT利用枠を使う公式機能は存在する。G-01は「一般に不成立」ではなく、**LT Shareの静的Sites構成で採用できる認可・実行方式が未確認**とする。Codex app-serverの遠隔接続や本人所有VMの公式手順もあり、「ローカル以外では動かせない」という技術的断定は訂正する。一方、app-server組み込み認証のホスト型サービス利用には公式の制限があり、別途Sign in with ChatGPTの提供条件を確認する必要がある。

[再調査の詳細・一次資料・Grok無料枠と開発者検索](ai-and-search-feasibility-20261018.md)を参照。以下の2026-10-09の記述は当時の判断として保存し、再調査と食い違う断定は最新仕様として使わない。要件やアプリ機能は今回変更していない。

| ID | 状態 | 現時点の判断 |
| --- | --- | --- |
| G-01 Sites × 利用者のChatGPT利用枠 | **連携方式未検証（2026-10-18更新）** | 本人枠の公式機能は存在。現行の静的Sitesへの接続・提供条件を確認する。実装はAI未接続のまま |
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

## 2026-10-18 ChatGPT内アプリ試作

最新指示「一旦ChatGPT内アプリとして構築してみて」により `chatgpt-app/` を追加。元の `app/` とSites版は維持。

- ChatGPTの会話モデルが写真を理解・要約し、MCPツール `render_lt_post` がフォームに本文を表示する。別途推論API・秘密キー・独自DBなし。接続のためSites認証付きステートレスMCPのみ追加。
- 公式MCP Apps bridge、ChatGPT uploadFile / imageIds / widgetState。独自バックエンドから本人枠を呼ぶSIWC申請とは別の経路。
- タグ継承、任意の開発者ラベル、確認/コピー/Xリンク、同じカード内の履歴、投稿案JSON退避。新しい会話・カードとの履歴同期は未対応。
- unit20件 / host fixtureブラウザ6件成功。RED確認後修正。実際の画像認識・ChatGPT使用量の計測ではない。
- Chromeの表示と本文編集→投稿確認の実操作を確認。Product Design QAと画像は `chatgpt-app/design-qa.md`。テスト用ホストは公開workerに含めない。
- 独立レビューでホストのisError拒否・待機解除不足の2点を採用し修正。秘密/個人パス混入は自己レビューで検査。
- 写真アプリへの直接保存、動画音声要約、Xネイティブの起動、実際のChatGPT内画像生成フローは未検証/未達。本人環境の接続・試用で続けて確認する。
