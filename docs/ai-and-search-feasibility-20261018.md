# LT Share：本人のAI利用枠とGrok検索の再調査

確認日：2026-10-18（日本時間）。公開された公式資料、現行コード、既存Hermes/Grok OAuthによる小規模な検索を照合した。アプリの機能・公開範囲・課金設定は変更していない。

## 結論

- ログインした本人のChatGPT利用枠で外部アプリのAI処理を実行することは可能。実際に提供されている公式機能であり、LT ShareのAI要件を「不可能」として削る根拠にはならない。
- 現行の「独立したスマートフォンのブラウザで開く静的Sites」「アプリ独自のサーバー処理なし」「未登録のアプリがログインだけで本人の枠を使う」を同時に満たす一般向け公式経路は確認できなかった。機能の不存在ではなく、利用権限と実行構成の確認が残る。
- Grok Botの無料試用と、有料利用者向けの開始用X APIクレジットは確認できる。しかし無料の固定リクエスト数を継続して第三者サイトへ配れるという仕様は確認できない。
- 開発者候補をXから探すこと自体は可能。Bot内の検索、LT ShareからのAPI検索、利用者の既存OAuthを使うローカル検索を分けて設計する必要がある。

## 1. 前回説明の訂正

| 前回の扱い | 今回の整理 |
| --- | --- |
| Sitesでは本人の枠を使えない | Sites標準ログインが推論権限を渡すとは確認できない。別途認可された連携があれば本人枠での推論という構成自体は成立する。LT Shareの承認・接続は未検証 |
| Codex app-serverはローカル専用 | 遠隔WSS接続の技術がある。本人所有のVMで動かす公式SIWC手順もある。ただし実験的通信機能の存在とホスト型サービスでの認証利用許可は別 |
| loopback制約があるため遠隔AIは不可能 | OSS動的登録の認証戻り先には制約があるが、本人のVMでの実行は公式に説明されている |
| APIを使わない | 本来の要求はAPIキー発行・別の従量課金が不要ということ。本人枠の方式でも内部ではResponses APIなどの通信を行う |
| 申請承認があれば既存フロントのまま使える | 承認後のクライアント仕様・トークン交換・更新・対応入力・実行方法まで確認が必要。承認だけではC-02を自動で満たさない |

現コードの `app/src/lib/ai.ts` は `getAiProvider()` が `null` を返す。この実装は未接続であり、Sitesがモデル推論を拒否した実験結果ではない。

## 2. Sign in with ChatGPTでできること

### 本人確認とモデル使用許可

本人確認用のID tokenと、推論に使うaccess tokenは役割が異なる。Sitesの標準サインインは利用者のidentityをサーバーへ渡す。これだけで本人のChatGPT利用枠を使う権限が得られたとは扱えない。

ChatGPT plan usageには別の同意があり、本人のCodex / ChatGPT Work枠を使う。新しい別枠が増えるわけではなく、利用者はアプリの週間上限を管理できる。今回の公式案内は対象をeligible Plus / Proとしており、以前のGoを含む説明やFree対応は現要件の保証に使わない。

根拠：
- [Sign in with ChatGPT](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
- [Developer quickstart](https://developers.openai.com/siwc/quickstart)
- [Sites：Data and connections](https://learn.chatgpt.com/docs/sites/data-and-connections)

### 利用者ごとのアプリ・利用枠

利用者ごとに別のWebサイトやVMを必ず立てる必要はない。共通アプリが、各利用者の同意・トークン・セッション・下書きを分離する構成は考えられる。OSS登録では発行されたclient_idがユーザーとworkspaceに結び付く。host_idは実行場所の識別子であり、認証情報ではない。

したがって「使用者ごとに自分のUsageを使う」という構想は妥当。必要なのは利用枠の持ち主を正しく識別・認可する仕組みで、Sitesの画面表示が自動で個人専用AIエージェントを起動する仕組みではない。

根拠：[ChatGPT plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source)

### 実現経路

| 経路 | 本人枠でのAI | LT Shareとの関係 |
| --- | --- | --- |
| Sitesの標準サインインのみ | 推論権限の提供を確認できない | ログイン済みというだけではAI生成に接続できない |
| OSS・ローカル実行アプリ | 公式経路あり。client secretやpartner API key不要 | 対応するローカル実行環境と安全な認証情報管理が必要 |
| 本人所有のVM | 公式SIWC手順あり | 認証をローカルで終え、安全に資格情報を移す。本人の実行環境が必要 |
| 承認されたホスト型アプリ | 公式に想定される | partner提供条件、Webの認証・推論仕様、Sitesでの実行可否を確認する |
| ChatGPT内のplugin / MCP App | ChatGPTの会話からモデルが処理してツールやUIを利用する構成 | 独立サイトとは異なる提供形態。通常MCPサーバーが必要で、モバイルの撮影・保存も再検証 |
| Sites＋WebMCP | ChatGPT/Codex側のエージェントがページの操作を実行できる | 確認できた公式対応はdesktopの組み込みブラウザ。Safariだけで起動するAI APIにはならない |

公開資料は有料・リモートホスト型アプリを申請窓口へ案内している。LT Shareの一般公開GitHubがOSSであることや、Sitesをowner-onlyにしたことだけで、この提供条件を満たしたとは判定できない。「selected private clients」は非公開サイト全般を意味しない。

根拠：
- [公開フローの対象と申請案内](https://developers.openai.com/siwc/token-sharing-open-source)
- [OSS認証手順](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
- [MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Site tools / WebMCP](https://learn.chatgpt.com/docs/webmcp)

### 純粋なブラウザ版で残る問題

OSSの公開認証フローは `http://127.0.0.1:<port>/auth/callback` で待ち受ける手順を示す。スマートフォンで開いた認証ページの127.0.0.1は、そのスマートフォンを指す。Sites上のJavaScriptを配るだけでは、その端末のHTTP待受プロセスは起動しない。

これはOSSのこの認証手順についての制約。承認済みWeb向け認証まで一律にloopback限定と解釈しない。CORS実測、独自client登録、OAuth同意、Sites上でのトークン授受は今回実施していない。

独自DBなしとサーバー処理なしも別条件。認証や推論のために小さなサーバー処理を使っても投稿履歴用DBを作らない構成は設計可能だが、C-02は変更対象になり得る。

### Codex app-server

遠隔通信と、認証モードを区別する。

- app-serverにはstdioやWebSocketなどの通信と、ChatGPT managed、device-code、external-tokenなどの認証モードがある。
- 遠隔接続のWSS構成は説明されているが、実験的で本番負荷へのサポートは限定される。
- 現行資料の「Auth endpoints」は、app-server組み込み認証のcommercial / hosted service利用を認めず、Sign in with ChatGPTを案内している。device-codeはloopbackを使わないログイン方法だが、利用許可範囲を広げない。
- 別途SIWCで認可された本人のOAuthトークンをResponses providerとして使う公式手順はある。これは組み込みのCodex認証をホスト型サービスへ流用することと異なる。
- 画像の100文字要約なら、認可されたResponses APIを直接呼ぶこともでき、app-serverは必須ではない。

根拠：
- [Codex App Server：Auth endpoints](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
- [SIWCとCodex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

このSIWC公開経路では対応モデルでのテキスト・画像・ファイル入力はあるが、音声・動画直接入力や文字起こしは非対応。画像の要約と、動画音声まで含むLT要約は別に検証する。

根拠：[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## 3. Grok Botの無料枠と開発者検索

### 混同しない無料枠

| 種類 | 確認結果 | LT Shareへの意味 |
| --- | --- | --- |
| Grok Bot無料試用 | 利用量クレジット方式。7日間の期間制限もある。メッセージ回数だけでなくagent stepsとtokensで消費。恒久的・毎月固定回数の無料枠とは確認できない | Bot自体の試用は可能。外部アプリ向け無料API枠とは別 |
| 有料Bot利用者のX API開始用クレジット | 公式告知に記載。確認した告知では金額・件数・期限・継続付与条件は不明 | 無料クレジットだけで恒久運用できるとは判定しない |
| Grok Chat無料枠 | 通常のGrokに制限付き無料利用がある | 利用者がGrok側で検索する道はあるが、LT Share内に埋め込む権限ではない |
| xAI開発者APIのX Search | 公開料金は取得ポスト1,000件あたり5米ドル、プロフィール1,000件あたり10米ドル。推論tokensは別 | 従量課金APIとしては検索できる。無料試用やBot契約をAPI無料枠とみなさない |

出典：
- [Grok Bot trial / plans](https://cursor.com/help/grok-bot/plans)
- [Grok Bot now works with X](https://x.ai/news/grok-bot-and-x)
- [Grok overview](https://docs.x.ai/grok/overview)
- [X Search](https://docs.x.ai/developers/tools/x-search)
- [API pricing](https://docs.x.ai/developers/pricing)

新しいThe X SubscriptionではBotの通常利用はPremium / Super / Ultraに含まれる。Free / Plusは通常Bot利用を含まない。既存プランと無料試用は別に扱い、利用者の実際の権利はアカウントで確認する。

根拠：[Grok Bot on The X Subscription](https://docs.x.ai/x-subscription/grok-bot)

### 検索そのものはできる

Grok BotはXアカウントを接続しなくても公開Xの検索・閲覧を行える。私的なタイムラインやブックマーク等にはXプラグインの接続が必要。xAIの開発者向けX Searchにはkeyword / semantic / user search / thread fetchがあり、名前や説明からのユーザー検索もある。

したがって、製品名・GitHub URL・登壇タイトルなどを手掛かりに開発者候補を探す能力はある。ただし製品作者、共同開発者、実際の登壇者は同一とは限らない。検索結果を自動で「今回の登壇者」と確定しない。

根拠：
- [Bot：Search and read X](https://docs.x.ai/grok-bot/computer-and-apps#search-and-read-x)
- [API：How X Search works](https://docs.x.ai/developers/tools/x-search#how-x-search-works)

### 「Botで探す」と「LT Shareから呼ぶ」の違い

公開資料はBot自身がXを読む機能とプラグインの利用を示す。しかし今回調べた範囲では、第三者の静的サイトが利用者のBot無料試用を使って検索し、その結果を画面へ戻すための一般公開されたOAuth・SDK・API契約を確認できない。存在しないと断定せず、LT Share向け接続経路が未確認と記録する。

Xでの `@bot` は投稿をBotへ引き渡す機能で、結果はBot側の会話に残る。検索結果をLT Shareへ直接返すAPIの代わりにはならない。

根拠：
- [X for Grok Bot](https://x.ai/bot/plugin/49086599)
- [Tag @bot on X](https://docs.x.ai/grok-bot/tag-on-x)

### 今回の小規模検証

既存HermesのX検索をGrok OAuthに固定し、APIキーへの代替なしで2件実行した。

1. 公式関係アカウントの無料枠告知の探索。返った@Grok回答はAI生成であり、正式な提供条件の一次資料とはみなさない。結論には公式ヘルプ・料金表・ニュースを使用。
2. 「Hono（TypeScript Web framework）の開発者」を検索し、Yusuke Wada / @yusukebeという候補が返った。主担当が本人GitHubのCreator of Hono表記とXへのリンク、本人のCloudflare記事を読み、一致を確認した。

[本人GitHub](https://github.com/yusukebe) / [本人によるHono記事](https://blog.cloudflare.com/the-story-of-web-framework-hono-from-the-creator-of-hono/)

実行経路は `xai-oauth`、報告されたモデルは `grok-4.20-reasoning`。providerは使用量を返していない。これは既存ローカル連携で検索結果が返る証拠であり、Bot無料枠利用、費用ゼロ、第三者スマホサイトでの動作を証明しない。XプロフィールのWeb直接取得は失敗したため、主担当の別途照合はGitHub側のXリンクを使った。1例なのでLT会場の未知の登壇者を見つける精度・速度の保証にはしない。

## 4. 要件の扱い（変更案、未合意）

AIを「不成立」として捨てず、FR-05の本人枠方針は維持して次を分ける。

- 独立したスマートフォンWebが必須なら、ホスト型SIWCの提供条件とSitesでの実装契約を確認する。独自DBなしは維持できる可能性があるが、独自サーバー処理なしは別に判断する。
- 承認待ちを避けて本人枠を使うなら、ローカルアプリやChatGPT内部のplugin等を検証候補にする。単にiOSアプリ化すれば認証まで自動解決するとは保証しない。
- WebMCPはdesktopの補助案。モバイル会場利用の代替が完成したとは扱わない。
- 開発者検索は任意機能の追加候補。候補・根拠URLを出し、選ばれた場合だけメンションを入れる。見つからなくても本文生成・投稿を止めない。
- Grok Botを使う外部検索案と、LT Share内にAPIで組み込む案を別に評価する。無料固定回数を性能・運用要件に置かない。
- 既存の「開発者：」トグルと、知らなければそのまま投稿するフローは維持する。

## 5. 検証の到達点

資料調査とローカル既存連携の小規模検索まで。新しいSIWC登録・ログイン、トークン交換、本人枠でのLT画像推論、Bot試用開始、Bot→LT Shareの結果返却、モバイル実機、Sites再公開は実施していない。実装が失敗したという主張もしていない。
