# サーバー要約への切替（2026-10-20）

利用者の「モデルダウンロードが遅すぎる。要約はサーバにやらせる」という最新指示に基づく変更。過去の端末内LLM・独自バックエンド禁止の制約は、今回の要約処理について更新する。単独Sites・本人限定の公開範囲、端末内下書き・ハッシュタグ、サーバーDBなしは維持する。

## 構成と判断

Cloudflare Workers AIが管理する画像対応のQwen 3.8 27Bを採用。モデルを自前GPUサーバーに置く必要はなく、軽いWorkerプログラムから呼び出す。スマホは縮小画像を送り、要約文を受け取るだけとなる。ChatGPT内アプリ、ChatGPT契約枠、Grok/Groqには依存しない。

ユーザーのSites認証を維持するため、ブラウザからCloudflare URLを直接呼ばず、Sitesの`/api/summary`を通す。CloudflareのWorkerは専用共有secretでSitesからの呼び出しだけを受ける。任意のモデル・プロンプト・URLをクライアントから指定できない。公開APIトークン、DB、ストレージ、AI Gatewayは追加しない。

Cloudflare Workerには`AI` bindingを付ける。秘密値をブラウザの`VITE_*`設定や配布JSへ入れない。元写真を保存せず、処理ログにも画像・要約・秘密値を出力しない。

## 無料枠

Workers Freeで1日10,000 Neuronsまで。上限に達するとエラーとなり、00:00 UTC（日本時間09:00）にリセットされる。アカウント内の他アプリと共有する枠であり、固定の投稿回数・無制限利用を保証しない。Workers Paidは超過従量課金なので、無料動作の有効化前に**対象アカウントがFreeであること**を確認する。

`LT_AI_FREE_TIER_CONFIRMED`は確認結果を運用者が設定するスイッチで、プラン自動検出・課金を強制停止するAPIではない。アカウントを後でPaidに変える場合は、この機能を停止して費用条件を再評価する。課金プランへの移行、プリペイド入金、別課金APIへの切替は今回実施しない。

## 配置手順

1. `cd app`、`npx wrangler login --scopes account:read user:read workers:write workers_scripts:write ai:write`で本人が再認証する。
2. `npx wrangler whoami`でアカウント確認、Dashboard/APIでWorkers Freeを確認する。複数アカウントの場合は確認したものだけを対象にする。
3. `npx wrangler deploy --config cloudflare/wrangler.jsonc`。初期フラグはfalseなので推論しない。
4. ランダムなサーバー間secretを生成し、Cloudflareの`LT_AI_SERVICE_TOKEN`とSitesの同名**secret**へ安全に登録する。値はログ・Git・チャットへ書かない。`wrangler secret put`へstdinで入力する。
5. Freeを確認後だけ`npx wrangler deploy --config cloudflare/wrangler.jsonc --var LT_AI_FREE_TIER_CONFIRMED:true`で有効化する。検証済みアカウント・確認日を運用記録に残す。
6. Sitesに`LT_AI_PROVIDER=cloudflare`、`LT_AI_ENDPOINT=https://<実際のWorkerホスト>.workers.dev/summary`、`LT_AI_FREE_TIER_CONFIRMED=true`を登録する。ホストはdeploy結果を使用し、推測しない。
7. 同じSite IDで`npm run build:worker`し、pushしたソースと一致する版を**本人限定**で更新する。共有範囲を変更しない。
8. Cloudflare実モデルで写真の要約、白紙の判読不能、未認証拒否を確認し、Siteで記録→生成→編集→次の投稿を確認する。

後日の通常deployでは構成ファイルのfalseに戻る。確認なくAIを有効化するより停止を優先する意図である。再開時にもFree確認と同じ明示オプションを使う。

## 検証・制限

Cloudflare上の実写真推論と本人限定Sitesへの配備・接続を確認済み。スマホ実機およびログインから写真アップロードまでの本番ブラウザ一貫試験は未実施。型・ユニット・HTTP境界・ブラウザ操作・配布ビルドと実推論は別々に記録する。詳しくは[verification.md](verification.md)を参照。

動画は冒頭の1フレームだけを読む。写真ライブラリへの直接保存、Xアプリの実機起動は今回のサーバー要約変更で確認済みにならない。

## 一次資料（2026-10-20確認）

- [Workers AI料金と無料上限](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Qwen3.8 27B：Visionと呼び出し仕様](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/)
- [Workers AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/)
- [エラーコード](https://developers.cloudflare.com/workers-ai/platform/errors/)
- [入力・出力の取扱い](https://developers.cloudflare.com/workers-ai/platform/data-usage/)

SitesのWorkerでは `redirect:error` が未対応のため `redirect:manual` を使い、3xxを含む非2xx応答を拒否する。転送先へ共有secretを送らない。ホスト提供fetchはreceiverを保持して呼び出す。
