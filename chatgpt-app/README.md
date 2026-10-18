# LT Share for ChatGPT

ChatGPTの会話に投稿フォームを表示する本人限定の試作です。写真の内容を読むのは、利用者本人の会話のChatGPTです。サーバーは表示を担当し、モデルAPIを呼びません。

## 使い方

1. Sitesが用意した「LT Share for ChatGPT」プラグインをインストール・接続します。必要なら新しい会話を開きます。
2. その会話で「LT Shareを開いて」と依頼します。
3. 写真を選択し、「ChatGPTに要約を依頼」を押します。写真送信が使えない環境では会話に写真を添付できます。
4. ChatGPTが写真の見える事実を約100文字にまとめ、投稿カードを表示します。会話の最新カードを確認してください。
5. 本文・タグ・任意の「開発者：」を確認し、Xを開いて投稿します。写真はXで手動添付します。

会話に直接写真を添付して「この写真をLT Shareで約100文字の投稿案にして。#イベント名 を付けて」と依頼することもできます。投稿カードを返す `render_lt_post` ツールを使用します。

## 構成・制約

- MCP Appsの標準bridgeとChatGPTの公式写真アップロード機能を使用。
- 独自DB、独自アカウント、AIの秘密APIキー、推論API呼び出しなし。Sitesの認証付き・ステートレス `/mcp` のみ。
- モデルと回数上限は本人のChatGPTの利用条件に従います。特定モデルの強制や使用回数の保証は行いません。
- 写真はChatGPTに送信します。アプリ独自のサーバー保管は行いません。OpenAI側の保持は利用サービスの条件に従います。
- 投稿案の履歴は同じウィジェット内。ChatGPTが新しいカードを作ると履歴は共有されません。必要なら投稿案JSONを保存してください。
- 写真アプリへの自動保存、動画音声の要約、Xアプリの強制起動、複数会話・端末の履歴同期は未対応。
- X文字数カウンタは従来版と同じ保守的な目安。絵文字の結合など最終判定はX側で行います。
- テスト用ホストはローカル開発専用。配布workerにテスト用ホストや疑似要約経路は含めません。

## 開発

Node 22.18以上。

```sh
npm ci
npm test
npm run build
node scripts/validate-artifact.mjs
npm run test:e2e
npm run dev -- --port 4188
```

開発用 `/widget` はホストなしの表示確認、`/test-host` はMCP Apps通信を検証するテスト用iframeです。そこでの生成結果はテストデータであり、実際のChatGPT推論ではありません。公開workerは `/mcp`、案内 `/`、状態 `/health` のみを提供します。

## 検証の区別

unitとブラウザでのhost fixtureテストは自動化済みです。実際のChatGPTでの写真アップロード・モデル実行・表示、スマホでの写真保存とXアプリ起動は、本人の環境で接続後に確認します。

公式仕様: [ChatGPT UI](https://developers.openai.com/plugins/build/chatgpt-ui)、[ChatGPTの拡張API](https://developers.openai.com/plugins/reference)、[MCP Appsの現行型](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts)。
