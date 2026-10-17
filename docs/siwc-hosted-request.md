# LT Share：本人のChatGPT利用枠によるAI要約・接続準備書

作成日：2026-10-18。状態：申請用説明と技術確認事項の準備済み。申請未送信、承認状況未確認、AI未接続。

## 1. 目的と変更しない要件

LT会場で写真・動画を取り込み、内容を約100文字の日本語に要約し、利用者が編集してXへの投稿に使う。スマートフォンのブラウザで単独利用できるOpenAI Sitesを維持し、本人のChatGPT有料契約の利用枠を使う。独自バックエンド・独自DB・APIキーによる従量課金は導入しない。写真・動画と投稿案は端末に保存する。

「端末保存」はアプリの保存先の要件であり、AI処理まで端末内で完結するという意味ではない。接続後は、利用者が生成を選んだときに必要な入力をOpenAIへ送る設計とし、送信内容・保存期間等は提供仕様に照らして明示する。

対象：

- 既存Site：[LT Share](https://lt-share-on-x.saber5656.chatgpt.site)（owner-only。今回アクセス・設定変更なし）
- ソース：[Saber5656/LT-Share](https://github.com/Saber5656/LT-Share)
- 公式のホスト型アプリ相談窓口：[Sign in with ChatGPT interest form](https://openai.com/form/sign-in-with-chatgpt-interest/)

## 2. 既知の事実と未確認条件

| 項目 | 既知の事実・根拠 | 未確認条件／扱い |
| --- | --- | --- |
| 申請経路 | [ChatGPT plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source)がremotely hosted appsを上記interest formへ案内する | LT Shareの提出・承認状況、提供条件、静的Sitesへの適用は未確認。フォーム案内は利用承認ではない |
| OSS公開フロー | [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)は`127.0.0.1`のloopback callbackを使う | GitHub公開やowner-only設定だけで、ホスト型ブラウザのHTTPS callbackが許可されるとは扱わない。スマホでloopbackはスマホ自身を指し、Sites配信だけでは待受サーバーを作れない |
| Sitesログイン | [Sites: Data and connections](https://learn.chatgpt.com/docs/sites/data-and-connections)および既存調査ではidentityとplan usage認可は別 | Sites標準ログイン済みでも推論権限は未取得。identity用client設定の流用はしない |
| 現行AIコード | [ai.ts](../app/src/lib/ai.ts)の`getAiProvider()`は`null`。`AiInput`は`image: Blob`と`tags: string[]`、`generate()`は文字列を返す | AI接続未実装。動画・音声を受ける契約もない。インターフェースの存在を推論成功の証拠にしない |
| 既存機能 | [verification.md](verification.md)に取り込み、保存導線、手入力、タグ引継ぎ、任意の開発者ラベル、端末内の投稿案保存、Xへの受け渡しを実装済みと記録 | 端末へのメディア保存とX受け渡しは実機未確認。今回動作検証・再公開なし |
| 入力形式 | 公開SIWC資料の[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)では画像等に対応し、音声・動画の直接入力・文字起こしは非対応とされる | ホスト型の提供仕様にも同じ制限があるか確認。画像対応を動画音声の理解まで拡張しない |
| 契約と利用枠 | [既存再調査](ai-and-search-feasibility-20261018.md)ではeligible Plus / Pro、本人枠との共有・利用制限が記録されている | 本人の実際の適格性、承認クライアントのモデル・上限・利用量の確認方法は未検証。有料契約一般を無条件の利用保証にしない |

既存の`verification.md`の2026-10-09記録は履歴であり、現在の判断は2026-10-18訂正と再調査を優先する。特に「承認があれば現行フロントのまま成立する」とは結論しない。

## 3. 申請用の短いプロダクト説明（未送信）

公式フォームを実際に確認した。必須項目はWork email、First name、Last name、Company name、Website URL、希望機能、製品説明。希望機能は「Sign in and ChatGPT plan use for AI requests」を選ぶ。申請者の連絡先・氏名・会社名は利用者の指定を待ち、推測した値を入力しない。Website URLには既存Siteを使う。申請送信の許可と必須情報を利用者へ確認中。

以下は製品説明欄へ入れる英文案（未送信）。

> LT Share is a mobile web app with source code on GitHub, hosted on OpenAI Sites and currently restricted to its owner. It already implements media import, device-save flows, editable post drafts, hashtags, and handoff to X; mobile device saving and sharing still need real-device validation. AI generation is not connected. We want users to explicitly authorize their own eligible paid ChatGPT plan usage to generate an approximately 100-character Japanese summary from a photo or video, then edit and save the draft on their device. We require standalone browser use without a custom backend, database, or API-key billing. We are requesting guidance and access for a remotely hosted app, including whether this static Sites architecture is supported and which image, video, and audio inputs are permitted.

Site: https://lt-share-on-x.saber5656.chatgpt.site （owner-only）

Source: https://github.com/Saber5656/LT-Share

初期アクセスは現在のowner-only構成を説明し、一般公開済み・承認済み・AI動作済みとは記載しない。本人の有料枠を各利用者自身の同意で使用し、オーナー1人の資格情報で他人の推論を賄う構成は求めない。

## 4. OpenAIに確認する最小限の技術質問

申請先への質問案。利用者に調査を依頼するための項目ではなく、提供元から回答を得るための確認事項とする。

1. **Hosted static browserの対応可否**：OpenAI SitesのHTTPS origin上で、独自バックエンド・DB・client secretなしに、利用者本人のChatGPT plan usageを認可し、ブラウザから推論できますか。対応する公式SDK／手順、CORS・CSP等の要件を提示いただけますか。サーバーが必要なら、Sites管理機能だけで満たせるか、独自サーバーが必須かを区別してください。
2. **登録とredirect**：このSiteのoriginに対するホスト型クライアント登録手順と、許可されるHTTPS redirect URIの規則を教えてください。owner-onlyのログインを経ても認可の戻り先へ到達できる必要があります。正確なcallback path、登録主体、利用可能な認可方式、必要scope、テスト用登録の扱いを確認したいです。OSS loopbackフローとは別の承認が必要ですか。
3. **Token処理の制約**：ブラウザで認可コード交換・推論・更新・失効を行う公式の方法はありますか。PKCE等の必要条件、access／refresh tokenをブラウザが保持してよい範囲、保管先・有効期間・再ログイン・ログアウト時の破棄要件を教えてください。Sitesのidentityログインとplan usage同意の連携方法、ブラウザが推論用tokenを直接扱わない管理型の方法があれば併せて示してください。
4. **画像・動画音声と利用枠**：この提供経路で利用できるモデルと画像形式・サイズ・枚数上限を教えてください。公開previewの動画／音声直接入力・文字起こし非対応はホスト型にも適用されますか。ブラウザで動画から抽出した静止画を送る方式は許可されますか。その場合の制限は何ですか。対象プラン、既存Codex／ChatGPT Workとの枠共有、アプリ別上限、枠消費の確認方法、上限到達・失効時の応答を教えてください。APIキー登録・API課金への切替なしで利用できることを確認したいです。

回答受領時は、回答日・適用クライアント・仕様の版・公式資料への参照を記録する。モデル名、scope、endpoint、client ID、callback pathは回答／公式設定から確定し、この文書では創作しない。

## 5. 承認後の接続手順（未実施）

### A. 接続を始める条件

申請への回答と、LT Share用の承認・登録手順を入手する。上の4問から、独自バックエンド・DB・API課金なしで成立するかを判定する。ホスト型の承認だけで静的ブラウザ対応を推定しない。

独自サーバー、client secretのブラウザ埋込み、APIキー課金が必須なら、その方式の実装を止めて要件との不一致を報告する。別方式や費用への切替は行わない。端末内だけの保持が許されるか、OpenAI側のデータ取扱いも含めて確認する。

### B. 認証と最小の画像推論

1. 公式手順に従って実際のSite originと正確なredirect URIを登録し、owner-only状態で往復できるか確認する。既存identity認証を壊さず、本人枠の同意を区別する。
2. 提供されたSDK／認可方式に従い、セッションとtokenの扱いを実装する。秘密情報をソース・URL・ログ・投稿案へ残さない。tokenを永続保存する可否は公式仕様で決め、未確認のままlocalStorage等へ保存しない。
3. 正式に許可された画像対応モデルで、権利を持つ小さなテスト画像1枚から日本語要約を生成する。APIキーを使わず本人枠へ計上されることを、提供された利用量表示・記録で照合する。本人枠による実推論は承認後の作業であり、今回の文書作成では実行しない。
4. `AiProvider.generate({ image, tags })`を満たす実装を接続し、準備が整ったときだけ`getAiProvider()`から返す。既存の生成中・失敗・再試行表示への接続を確認し、利用枠上限は`AiQuotaError`へ変換する。認可取消・期限切れ・通信失敗は上限エラーと区別する。
5. 要約は本文約100文字を目安とし、タグは別扱いにする。実装時に文字の数え方と許容幅をテストへ固定する。画像から読み取れない登壇者や内容を作らず、利用者が編集できる状態で保存する。

### C. 動画の扱い

動画直接入力と音声が正式に利用可能なら、その契約に沿って入力型・処理を追加する。非対応なら端末での静止画抽出を検証候補にし、対応形式・向き・長さ・フレーム数・メモリ負荷を実機で確認する。現在の`AiInput`は画像1枚だけなので、複数フレームを扱う場合は入力型と呼出側の変更が必要。

静止画だけの要約は映像中の可視情報に限定し、音声を聞いた要約と表示しない。音声を含む動画全体の理解が必要で、公式経路が対応しなければ動画要件は未達として残す。画像成功をもって動画まで完了にしない。

## 6. 検証と完了条件（接続後に実行）

| 確認対象 | 手順と合格条件 |
| --- | --- |
| 認証 | 実際のスマホブラウザでSitesログイン→本人枠同意→登録redirect→元の編集画面へ戻る。拒否・中断でも既存の下書きが残る |
| 本人枠 | 適格な本人アカウントで画像推論が成功し、提供元指定の方法で本人枠の使用を確認できる。APIキーや別のAPI課金設定を要求せず、課金方式の自動切替がない |
| 要約品質 | 文字のあるスライド、写真、判読困難な画像で日本語本文約100文字を確認する。不明情報を断定しない。タグ保持、編集、再生成を確認する |
| 障害時 | 同意拒否、認証失効、利用枠到達、通信断で区別した案内を出す。無限再試行や入力の消失がなく、手入力を続けられる |
| 動画 | 正式対応方式で試験する。静止画方式なら音声非対応を明示し、動画全体理解の合格とは分ける |
| 端末保存 | iPhone Safari等の対象実機で写真・動画を保存し、保存先から開けることを確認する。生成・編集した投稿案の再表示も確認する。保存ボタンやHTTP成功だけで完了にしない |
| セッション分離 | ログアウト／アカウント変更で推論資格情報が残用されない。別利用者の枠・下書きを混同しない。端末保存内容の残し方を明示する |
| 引き渡し | 入力種別ごとに「実装済み／実推論確認済み／実機確認済み」を記録し、公開する場合は配信版でも同じ確認を行う |

実装段階では認証・エラー変換・生成結果の扱い等の振る舞いにテストを先行させる。本作業は文書のみのためTDDの対象外であり、既存コード・資料との整合を自己レビューする。

## 7. 今回の到達点と残る障害

準備済み：申請用説明、技術質問、承認後の接続順序、検証条件。指定3ファイルを読み、公式overview・sign-in・preview limitationsを参照した。実装済み機能と未接続AI、画像と動画音声、Sites identityとplan usageを分離して記述した。

残る障害：LT Share用の申請・承認状況と、静的Sitesから利用可能な認証／token処理／推論の正式仕様が未確認。動画音声対応と本人の適格性・利用枠も未検証。承認後もこれらの回答と実推論・実機確認が必要である。

今回の作業はこの文書の作成・自己レビューのみ。申請送信、登録、AI接続、実推論、GUI操作、再委譲、秘密値の読出し、git操作、公開は行っていない。指定された書込範囲を守るため、別Vaultへの保存やログファイルの追加は行わない。直前のdoctorの結果は依頼者の説明として引き継ぎ、認証情報を再調査していない。
