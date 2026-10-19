# LT Share：単独WebとAI実行方式の整理

2026-10-19。ChatGPT内アプリを実際に使った結果、操作性が悪いためWebサービスへ戻す、という最新要求を優先する。

2026-10-20追記：利用者はフロントでの軽量モデル実行も許容すると説明した。Groqキー取得を前提にせず、[端末内AIの検討](./local-ai-feasibility-20261020.md)を追加。以下は10月19日時点のクラウド接続の整理であり、Groqの採用が確定したという意味ではない。端末内AIの実装・実機推論は未実施。

## 混同しない区分

| 区分 | 何をする方式か | 条件とLT Shareへの適合 |
| --- | --- | --- |
| Codexを製品に組み込む | Codexのエージェント実行系をアプリから制御する。SDK/app-serverなど | コードの組込みと認証・課金の利用許可は別。app-server内蔵ChatGPT認証は商用/ホスト型サービスでは認められていない。単純な写真要約にCodex実行系は必須ではない |
| Codexを組み込まず、本人のChatGPT契約枠を使う | SIWCのChatGPT plan usageで認可されたResponses APIを呼ぶ | 公式方式は存在する。Plus/Pro等の対象利用者が許可する。独自Webで使えるかという点では、有料またはリモートホスト型アプリの窓口・提供条件が適用される。Codex非搭載だから自動的に申請不要とはならない |
| OSS/ローカルアプリや本人所有VM | ユーザー定義agentとして登録し、本人枠を使用 | 公開SIWC方式あり。実行環境、トークン保護、loopback認証等が必要。スマホでURLを開くだけのWebとは操作負担が異なる |
| ChatGPT内アプリ | 会話のモデルが画像を読んでMCPへ表示させる | 実装済みだがユーザーの実利用で不採用。主経路にしない |
| 無料枠のある外部API | Webから専用の中継処理を通して画像モデルを使う | 運営用キーを一度だけ設定する。ChatGPTの契約枠は消費しない。無料アカウントの上限で止め、別課金へ自動代替しない |

「商用利用申請」がCodexを入れる製品だけの条件、という分け方は正確でない。今回の鍵は**ホスト型の外部アプリに本人のChatGPT利用枠を提供する認可条件**。app-serverやdevice-codeを使って条件を回避しない。将来認可を得た場合には、Web UIを保ったままAI提供元を差し替えられる。

## 無料API候補と採用

- **Groq + Qwen 3.8 27B**: 公式に画像入力とJSON出力を対応。無料プラン表は30RPM/1,000RPD、8,000TPM/200,000TPD。上限は組織単位で、画像は1枚2,048入力トークンのため日次token上限にも先に達し得る。1,000枚を必ず要約できるという保証にはしない。実際のアカウントのLimitsを優先。
- **Gemini API**: 画像入力に対応するモデルで無料枠あり。具体的な日次上限はAI Studioのプロジェクト表示を確認する。Google AI Studio自体の無料利用と、課金済みAPIキーの実行費は別。無料枠には製品改善へのデータ利用条件がある。
- **Grok Bot/ChatGPTサブスク**: 消費者向け契約の無料試用と、第三者Webから呼べるAPI枠を混同しない。

最初の接続候補はGroqの無料プラン。運営キー・無料プラン確認は未取得。現在サポートしている接続処理はGroqのみ。Geminiを選ぶ場合は公式契約に合わせた別アダプターが必要。利用者にAPIキー作成・外部チャット操作は要求しない。

## 実装上の境界

Web UI/投稿履歴/原本は端末側。Sites認証付きの小さな中継処理だけを追加する。サーバーDB、独自会員DB、原本クラウド保管は追加しない。キーはSites秘密環境変数のみ。ブラウザへ配布しない。

`LT_AI_FREE_TIER_CONFIRMED=true` は運営者が課金を有効にしていないGroq無料プランを確認した後にだけ設定する。コードからキーの請求プランを判定できるわけではない。キー未設定/確認なしでは生成を無効化する。429で停止し、別キー・別モデル・有料APIへの切替や自動再試行をしない。

写真の縮小コピーをモデルに渡し、動画は冒頭付近の静止画から文章を作る。動画の音声やLT全体を要約できたと扱わない。ブラウザから写真ライブラリへ無操作で保存する要件は未達であり、既存の保存/確認導線を維持する。

## 一次資料

- [Codex app-server: auth endpoints](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
- [SIWC quickstart](https://developers.openai.com/siwc/quickstart)
- [ChatGPT plan usage: OSS/locally hosted scope](https://developers.openai.com/siwc/token-sharing-open-source)
- [Groq vision](https://console.groq.com/docs/vision)
- [Groq rate limits](https://console.groq.com/docs/rate-limits)
- [Groq data handling](https://console.groq.com/docs/your-data)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini billing](https://ai.google.dev/gemini-api/docs/billing)

資料確認と実際の推論成功は分ける。キー未設定のため、実モデルの日本語写真要約・速度・無料枠消費は未検証。
