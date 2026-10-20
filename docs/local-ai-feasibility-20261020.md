# LT Share：端末内AIの検討

2026-10-20。ユーザーの「フロントで軽量モデルを起動してもよい」という最新の説明を優先する。以前の「端末内LLMを対象外とする」は、この検討の制約として使わない。単独Webの操作性、端末内の投稿履歴、独自DBなしの要求は維持する。

## Groqと端末内AIの違い

Groqはクラウドでモデルを実行するAPIサービス。XのGrokとは別の会社・製品であり、ChatGPTの契約枠を使う仕組みでもない。前回実装したGroq接続は無料枠APIの候補であり、LT Shareの必須条件ではない。

端末内AIでは、モデルと実行用プログラムをブラウザへ読み込み、写真の解析と文章生成をその端末で行う。この推論に外部のAPIキーやChatGPT利用枠連携は必要ない。初回のモデル配信には通信が必要で、通信量・端末の保存容量・メモリ・電池を使用する。モデルのブラウザ内キャッシュは、許容されている端末内保存に含まれる。

## 区別すべき実行方式

| 方式 | 確認できた範囲 | LT Shareでの扱い |
| --- | --- | --- |
| AndroidアプリからGemini Nanoを呼ぶ | ML KitのPrompt APIはAICore経由。端末の対応確認が必要で、画像とテキストを入力できる | ネイティブAndroidの候補。普通のWebサイトへそのまま使えるJavaScript APIとは違う |
| Chrome内蔵Gemini NanoをWebから呼ぶ | ChromeのPrompt APIは画像と日本語に対応するが、公式要件はデスクトップ。Android/iOSのChromeは対象外 | スマホ向けWebの共通方式には採用しない |
| Webアプリがモデルを読み込んで端末内で実行 | Transformers.js等にWebGPUで動かす画像モデルの実装例がある。Googleにも端末内Web実行の資料がある | 単独Webを維持する第一の検証候補。端末のGPU・ブラウザ・メモリに依存する |

Geminiという名称だけでクラウドAPI、Android内蔵Nano、配布可能なGemmaモデルを同一扱いにしない。GoogleのGemma 3nは画像・音声対応の端末向けモデル。旧MediaPipe Web APIは現在maintenance-onlyで、移行先としてLiteRT-LM JavaScript APIを案内している。移行先の対応モデルや画像入力はそのAPIの仕様で別途確認する。

## 小さな検証の対象

Qwen3.5-0.8BのONNX版には、画像を入力し、Transformers.jsとWebGPUで文章を生成する具体例が公開されている。候補として比較する。モデルカードの多言語・OCRベンチマークは、LT Shareの日本語スライドを正確に要約できる証明にはしない。

公開ファイルメタデータを合算すると、掲載例のq4埋め込み・fp16画像処理・q4生成モデル・tokenizer/設定の構成は通常版873,434,472バイト、後継OPT版871,365,686バイト（約0.87GB）。JSと実行ライブラリは別に必要。これはダウンロード対象の合算であり、実行時に必要なメモリ量ではない。小型という呼び方だけで通信・メモリ負担が小さいと判断しない。

検証する流れは「初回だけモデルを端末へ準備 → 写真を選択 → 同じ画面で日本語の短い投稿文を生成」。初回に大きなファイルを無断で読み込まず、サイズと必要性を示して利用者の操作で開始する。2回目以降もキャッシュが必ず残るとは仮定しない。

採否は以下で判断する。

- 対象iPhone/Androidでモデルを読み込み、写真入力と日本語生成が実行できる。
- 実際の日本語スライドで、読めない製品名・人名・数値を作らず、分かる範囲で約100文字にできる。
- 初回の通信量、初期化時間、2回目以降の生成時間、メモリと電池への負担を測定する。PCや画面幅だけを変更した試験から実機速度を推定しない。
- 解析は画面操作を止めない実行方法を使い、中断・メモリ不足・GPU非対応でも写真と下書きを保持する。
- 写真を外部推論サービスへ送信しないことを通信記録で確認する。非対応時にクラウドAPIへ自動切替しない。

画像を理解する小型モデルと、「端末内OCRで文字を読む → 小型の文章モデルで整える」方式は比較できる。後者は図や写真の意味を扱えないため、同じ対応範囲と表示しない。動画の音声や発表全体を要約できるとも扱わない。

## 現在の到達状態

ここまでは一次資料とモデルの公開仕様の調査。LT Shareの本番コードへのローカルAI組込み、モデル推論、物理スマホの速度・精度検証は未実施。既存の公開SiteとGroq接続は変更していない。Groqキー取得をローカルAI検証の前提にしない。

## 一次資料

- [Groq API overview](https://console.groq.com/docs/overview)
- [Chrome Prompt API：hardware requirements、画像、日本語](https://developer.chrome.com/docs/ai/prompt-api)
- [Android ML Kit Prompt API：端末対応確認、画像入力](https://developers.google.com/ml-kit/genai/prompt/android/get-started)
- [Gemma 3n model overview](https://ai.google.dev/gemma/docs/gemma-3n)
- [Google Web LLM inference：旧APIと移行案内](https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/web_js)
- [LiteRT-LM Web API](https://developers.google.com/edge/litert-lm/js)
- [Transformers.js：WebGPU](https://huggingface.co/docs/transformers.js/guides/webgpu)
- [Qwen3.5-0.8B：開発元のモデルカード](https://huggingface.co/Qwen/Qwen3.5-0.8B)
- [ONNX版：画像対応のブラウザ実行例](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX)
- [後継OPT版：画像対応のブラウザ実行例](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT)
- [通常版のファイルメタデータ](https://huggingface.co/api/models/onnx-community/Qwen3.5-0.8B-ONNX/tree/main?recursive=true&limit=1000)
- [OPT版のファイルメタデータ](https://huggingface.co/api/models/onnx-community/Qwen3.5-0.8B-ONNX-OPT/tree/main?recursive=true&limit=1000)
