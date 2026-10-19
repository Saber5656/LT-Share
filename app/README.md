# LT Share: web app (v1)

A mobile-first web app for lightning-talk attendees: set the event hashtags once, record a photo or video of the talk, write the post, and hand it to X. The hashtags carry over to the next talk.

The UI is built with Vite + React 19 + TypeScript and served by the existing Sites Worker. Photos, videos and drafts stay in the visitor's browser (IndexedDB). The current AI runs locally in a Web Worker; it does not call the legacy cloud API routes or require an API key or database. Requirements: [`../docs/requirements.md`](../docs/requirements.md). Screen design: [`../docs/DESIGN.md`](../docs/DESIGN.md). The clickable mock in [`../mock/`](../mock/) is the approved visual reference.

## Run, test, build

Requires Node.js 22.18 or later.

```bash
cd app
npm ci
npm run dev           # local dev server
npm run typecheck     # tsc --noEmit (strict)
npm run test:unit     # node --test with TypeScript type stripping
npm run build         # static site in dist/
npm run preview       # serve dist/ locally
```

End-to-end tests (Playwright, Chromium, 390x844 mobile viewport) build the app and serve it on a free port:

```bash
npx playwright install chromium   # once
LT_E2E_PORT=4391 npm run test:e2e
```

`LT_E2E_PORT` defaults to 4391. The server is never reused between runs.

### Hosting

- The app is a static build: `npm run build` writes everything to `dist/`, and every asset URL is relative (`base: "./"` in `vite.config.ts`), so it does not depend on the URL it is served from.
- `.openai/hosting.json` preserves the existing Site ID. `npm run build:worker` packages the UI in `dist/server/index.js` for Sites. The Site remains **private** (owner only). The model weights and pinned runtime are downloaded on explicit preparation, not embedded in the Worker bundle.
- **Check on a real device after publishing.** The following cannot be verified headlessly and must be tried on an iPhone (Safari) and an Android phone (Chrome), ideally also inside the X app's in-app browser: previews of photos and videos read back from the browser's storage (`blob:` URLs), the share sheet ("画像を保存" / "ビデオを保存" into the photo library), and the hand-off to the X app from "Xで開く" and "写真/動画付きで共有".

## How it behaves

- **Record (FR-02):** a hidden `<input type="file" capture="environment">` per kind (`image/*` or `video/*`) opens the phone's camera UI. Cancelling the picker changes nothing. Re-recording replaces the draft's media; the copy in the phone's photo library is never touched.
- **Save to device (FR-03):** browsers cannot write to the photo library silently. "端末に保存" opens the share sheet (iOS offers "画像を保存" / "ビデオを保存") when the browser can share files, otherwise it starts a download. Neither tells the page whether the user really saved the file, so the app asks "写真アプリ（ギャラリー）に保存できましたか？". Only "保存できた" marks the media as saved. A dismissed share sheet changes nothing; an error shows a retry and a download fallback.
- **Post text (FR-05/06):** optional on-device photo summary plus an editable textarea with the X weighted counter (`X換算 n / 280`). See the local AI section below.
- **Developer label (FR-07):** "開発者：" is appended only while the toggle is on; it resets to off for the next post.
- **ポスト確認 (FR-08/09):** shows the full text. On iPhone/iPad, "Xアプリで開く" requests the native composer using the `twitter:` scheme; Android uses a package-targeted Chrome Intent with a web fallback. Desktop keeps the HTTPS composer. App-link support must be verified on the target phone and X version. Mobile users can explicitly select "ブラウザ版で開く" or copy the full post text. No timer redirects the user after a launch attempt. "写真/動画付きで共有" uses Web Share with the file and text when supported. Sharing is disabled over the X limit. The app records "Xを開く操作済み", not verified app launch or posting success.
- **次の投稿へ (FR-10):** stores the draft, carries over only the hashtags and starts an empty draft. It refuses an empty draft, media that is not confirmed as saved, and a draft that could not be written to browser storage.
- **Saved drafts (FR-11):** newest first, with thumbnail, status, excerpt and the hashtags used at the time. What was edited on X, or whether the post was published, is not reflected.
- **Persistence (C-03, NFR-02):** IndexedDB stores drafts, media blobs and app state (current draft, hashtags). Everything is restored on reload. If the browser refuses to store data (private mode, quota), the app shows a non-destructive notice, keeps working in memory, and never deletes a draft before a write has succeeded. A replaced media file is deleted only after the draft that no longer references it has been written. On start, stored blobs that no draft references (an interrupted capture) are removed; a referenced one never is. Only the current draft's media is kept in memory. After the first media save the app asks the browser for persistent storage once (the answer is ignored).
- **One writer at a time:** the first tab takes a Web Lock (`lt-share-writer`) and holds it. Any other tab shows "別のタブで開いています。このタブでは編集できません。" with 再読込, is inert, and never writes. Without Web Locks nothing is guarded. New drafts get `d-<uuid>` ids; old `d1`-style ids still restore.
- **Failure handling:** a storage load that takes more than 5 seconds offers 再読込 or continuing without saving; a storage read error offers retry/reload instead of asking the user to record again; a share call that never settles is given up (page visible again, or after 60 seconds) and the user is asked to confirm; a rendering error shows a recoverable message instead of a white screen.
- **First-run notice:** shown once (flag in `localStorage`) and reopenable from the saved-drafts screen.

## Code map

| Path | Contents |
| --- | --- |
| `src/lib/draft.ts` | Draft state and reducer, hashtag parsing, post composition, X weighted length |
| `src/lib/deviceShare.ts` | Share-sheet / download helper and media-with-text share |
| `src/lib/xIntent.ts` | `buildXIntentUrl` |
| `src/lib/repository.ts` | `Repository` interface and its IndexedDB implementation |
| `src/lib/persistence.ts` | Write-on-change, media blob handling, failure reporting |
| `src/lib/restore.ts` | Rebuilds the in-memory state from storage |
| `src/lib/writerLock.ts` | Single-writer Web Lock |
| `src/lib/saveFlow.ts`, `settle.ts` | The tap-synchronous "端末に保存" start and the escape for a share call that never settles |
| `src/lib/storagePersist.ts` | One-time `navigator.storage.persist()` request |
| `src/lib/ai.ts`, `generation.ts` | `AiProvider` interface and the generation runner; the controller uses the local provider |
| `src/app/` | Controller hook, context, in-app navigation (History API) |
| `src/screens/`, `src/components/` | UI |
| `tests/unit/` | Unit tests (reducer, share helper, repository with `fake-indexeddb`, restore, persistence) |
| `tests/e2e/` | Playwright main-flow and failure-path tests |

## Not implemented / open

- **Physical-phone local AI support is unverified.** WebGPU with `shader-f16` is required; availability alone does not guarantee enough memory or acceptable speed. Unsupported devices keep the manual flow. This implementation does not use ChatGPT subscription usage.
- Draft deletion, retention limits and storage-size limits (U-04, U-05).
- Not verified on real devices: the iOS/Android share sheet, "画像を保存" into the photo library, the X app hand-off, and video playback from stored blobs on iOS Safari. Browsers may also evict site data (for example Safari after a period without use); the app does not claim permanent storage.

## Historical cloud prototype (2026-10-19; not used by the current UI)

写真を選ぶと、同じ画面で自動的に投稿文を作ります。自動作成はオフにでき、生成中も本文を編集できます。手入力や写真を消す操作は遅れて来た生成結果で上書きしません。別の写真の結果が現在の写真に混ざらないよう、写真IDでも対応付けます。

AIは運営側のGroq無料枠を使う接続口を実装しています。ChatGPTの契約枠やCodexを外部Webから使う方式とは別です。利用者にAPIキーやChatGPT内の操作を要求しません。実際の生成には運営用キーと無料プラン確認が必要です。未設定・上限時は手入力で進められます。

- Sites runtime secret: `GROQ_API_KEY`
- Sites runtime configuration: `LT_AI_PROVIDER=groq`
- 無料プラン確認後のみ: `LT_AI_FREE_TIER_CONFIRMED=true`

無料プランであることはアプリが自動判定できません。カード登録/課金を有効にせず、実際の組織のLimitsを確認してください。APIの429で停止し、自動再試行・別モデル・別キーへの切替をしません。APIキーはブラウザに配布しません。サーバーに写真や下書きを保存するDBはありません。

```sh
npm run test:unit
npm run test:server
npm run test:e2e
npm run build:worker
npm run preview:worker -- --port 4395
```

`npm run build`はブラウザのみの確認用。`build:worker`はフロントを生成後、全アセットを埋め込んだWorkerを`dist/server/index.js`へ出力します。配布manifestは従来のSite IDを維持したWorker方式です。

[構成と利用条件の比較](../docs/ai-delivery-options-20261019.md)。動画の生成は静止画に限り、音声要約ではありません。写真アプリへの自動保存・物理スマホの動作は未確認です。


## 端末内AI（2026-10-20）

「端末内AIを準備」を押したときだけ、Qwen3.5 0.8B の画像対応モデルを約0.9GB読み込みます。Wi-Fiを推奨します。準備後の写真取り込みは自動生成し、先に取り込んだ写真も未編集なら準備完了時に生成します。手入力・全消去後の本文は自動で上書きしません。作り直しは明示操作です。動画は冒頭の静止画だけを使い、音声を要約しません。

- 初回にモデルと実行ライブラリをHugging Face/CDNから取得。写真・本文・タグは送信しません。
- Cache APIに保存できたモデルは再利用します。再訪時は準備ボタンを再度押します。保存領域の削除・容量不足・ブラウザによる削除後は再取得が必要です。完全オフライン動作は保証しません。
- Web Workerで処理し、準備・生成とも中止できます。中止するとWorker/GPU処理を終了し、下書きは残します。準備5分・生成2分でタイムアウトし、無制限に再試行しません。
- 記録が読み取れない場合は失敗を表示し、手入力・再試行へ進めます。軽量モデルの出力は最終確認が必要です。100文字へ無理に水増ししません。
- ChatGPT/Groq/Grokの契約・APIキー・従量課金を使用しません。クラウドへの自動切替はありません。

実モデルを使う任意の試験（初回はモデルをダウンロードするため通常CIから分離）:

```sh
npm run dev -- --host 127.0.0.1 --port 4396
# 別のターミナル。専用のChromeテストプロファイルを使用。
node scripts/test-local-model.mjs
```

`.local-ai-qa/`に結果・専用キャッシュを保存し、Gitには含めません。モデル・runtimeの固定バージョンと制限は[検証記録](../docs/verification.md)に記載します。
