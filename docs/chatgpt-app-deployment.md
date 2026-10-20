# ChatGPT内 LT Share 配布記録

2026-10-18。ChatGPT内アプリの試作を実装し、本人限定で公開済み。

- 案内サイト: https://lt-share-chatgpt.saber5656.chatgpt.site
- ChatGPT接続先: https://lt-share-chatgpt.saber5656.chatgpt.site/mcp
- Site ID: `appgprj_6ad412bf7d6c8191bbe7e0f3eace4984`
- 公開ID: `appgdep_6ad413c038b08191ab71b5b0a63bd2c8`
- 版: `appgprj_6ad412bf7d6c8191bbe7e0f3eace4984~appgver_4ec0c411cde881918194e59e8ea92f02`
- Sitesソースコミット: `1a6a8010b90602d76b0d706c84f241fe6796d190`
- GitHub実装コミット: `cd59e8fbb664b04a4852b04782ae5c832e8227a8`
- プラグイン: `plugin_asdk_app_sites_f982102eb0b08191965960f23ea8856b`（Sitesが作成した正確なID）

Sitesの公開結果は succeeded / has_mcp=true。公開後get_siteでowner、許可ユーザー1名、グループ0、外部閲覧者0を確認した。元Sites版は変更していない。

プラグイン情報は公開直後のget_siteでは未反映、後続のget_siteで取得できた。suggest_pluginsの結果は「Already installed」。これは自動インストールを示すが、実行中の会話にツールが反映されることや認証の健全性を保証する結果ではない。本会話のツール一覧には未反映だった。

公開先 /mcp を所有者向けSitesブラウザ確認トークンで直接照合したが401となった。公開範囲・OAuth設定を緩めず終了。MCPプラグイン接続の代わりにブラウザ確認トークンを使えるとは扱わない。実ホスト上のツール呼び出し、写真送信、ChatGPTモデルによる要約は未確認。

## 本人環境での試用

1. ChatGPTで新しい会話を開き、プラグインから「LT Share for ChatGPT」を選ぶ。見当たらない場合は Plugins → Personal → Created by you にある同名アプリを確認する。Connectが出る場合は本人で接続する。
2. 「LT Shareを開いて」と依頼し、写真を選択して「ChatGPTに要約を依頼」を押す。または会話に写真を添付し「この写真をLT Shareで約100文字の投稿案にして。#イベント名 を付けて」と依頼する。
3. 最新の投稿カードに写真に基づく本文が入り、タグや任意ラベルを編集できるか確認する。画像を読めない場合は会話の返答を確認し、待機を解除して再試行する。
4. Xで最終確認する。アプリからの自動投稿はしない。

本人の会話モデルによる生成のため、外部ホスト型アプリ向けSIWC利用枠申請・推論APIキーは使わない。ChatGPT側の利用条件、画像対応モデル、上限が適用される。実際の消費量は未計測。
