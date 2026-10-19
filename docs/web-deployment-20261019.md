# 単独Webの更新結果

- 公開URL: https://lt-share-on-x.saber5656.chatgpt.site
- 公開範囲: 本人限定を維持
- Site ID: `appgprj_6ac8893b28808191b171faeb02094c89`
- 公開ID: `appgdep_6ad5f5d131888191b2884a4d6c4a49c5`
- 版: `appgprj_6ac8893b28808191b171faeb02094c89~appgver_f806717670948191b50f57e5d706be02`
- Sitesソース: `ed5c8907542d9cbb9e006ae8713cb13d69621575`
- GitHub実装: `916b29f657b466d396820a77a7c73e873dab9a5c`
- 公開結果: `succeeded`、環境変数revision 0

従来の静的Siteから、同じフロントとステートレスAI中継を提供するWorkerへ移行。プロジェクトID・アクセス範囲を維持。独自DB、メディア保管基盤、APIキーの配布は追加していない。

unit113件、server15件、ブラウザ32件、型チェック、Worker ESM/フロント/API無効化のパッケージ確認が成功。独立レビュー2件を修正し、対象再確認で追加指摘なし。CodeRabbit SUCCESSを実装commitで確認。GitHub PR3はdraft/open、main未マージ。

運営のGroq無料プランのキーはまだ設定されていない。従って本番AI生成は無効であり、実モデルの日本語写真認識・速度・無料枠消費は未確認。ブラウザのAIテストはAPI応答fixtureによる確認である。

Chromeで公開URLへ進むと、本人限定のChatGPTログインが要求された。既存アカウント選択後に本人の再認証が必要となり、パスワードは取得・入力していない。ローカル画面操作は `app/design-qa-web-20261019.md` に記録。

## 運営者が一度だけ行う準備

1. [Groq Console](https://console.groq.com/keys)でFree Planの組織を確認し、APIキーを発行する。課金は有効にしない。
2. ローカルの無視対象ファイル `.env.local` にキーを入力する。値をチャットやGitに含めない。
3. 無料プランを確認後、運営者の許可を得てSites runtime secret `GROQ_API_KEY` と `LT_AI_PROVIDER=groq`、`LT_AI_FREE_TIER_CONFIRMED=true` を登録する。
4. 実写真を1件使い、要約内容・エラー・使用量を確認する。対象の写真を外部AIへ送信する許可を確認してから行う。

利用者はこのキーを用意する必要がない。無料枠は全利用者で共有する運営アカウントの上限であり、有料APIや別キーへの自動代替は行わない。
