# LT Share: web app (v1)

A mobile-first web app for lightning-talk attendees: set the event hashtags once, record a photo or video of the talk, write the post, and hand it to X. The hashtags carry over to the next talk.

The UI is built with Vite + React 19 + TypeScript and served by the existing Sites Worker. Photos, videos and drafts stay in the visitor's browser (IndexedDB). AI uses Cloudflare Workers AI through the authenticated Sites server. A resized image is sent for inference; originals and drafts remain in IndexedDB. No model download, end-user API key or server database is required. Requirements: [`../docs/requirements.md`](../docs/requirements.md). Screen design: [`../docs/DESIGN.md`](../docs/DESIGN.md). The clickable mock in [`../mock/`](../mock/) is the approved visual reference.

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
- `.openai/hosting.json` preserves the existing Site ID. `npm run build:worker` packages the UI in `dist/server/index.js` for Sites. The Site remains **private** (owner only). The phone downloads only the web app. The separate Cloudflare Worker uses an AI binding; model weights are managed by Cloudflare.
- **Check on a real device after publishing.** The following cannot be verified headlessly and must be tried on an iPhone (Safari) and an Android phone (Chrome), ideally also inside the X app's in-app browser: previews of photos and videos read back from the browser's storage (`blob:` URLs), the share sheet ("画像を保存" / "ビデオを保存" into the photo library), and the hand-off to X using the primary "写真/動画と本文をXへ" button and selecting X in the OS share sheet.

## How it behaves

- **Record (FR-02):** a hidden `<input type="file" capture="environment">` per kind (`image/*` or `video/*`) opens the phone's camera UI. Cancelling the picker changes nothing. Re-recording replaces the draft's media; the copy in the phone's photo library is never touched.
- **Save to device (FR-03):** browsers cannot write to the photo library silently. "端末に保存" opens the share sheet (iOS offers "画像を保存" / "ビデオを保存") when the browser can share files, otherwise it starts a download. Neither tells the page whether the user really saved the file, so the app asks "写真アプリ（ギャラリー）に保存できましたか？". Only "保存できた" marks the media as saved. A dismissed share sheet changes nothing; an error shows a retry and a download fallback.
- **Post text (FR-05/06):** server-side photo summary (automatic by default, switchable off) plus an editable textarea with the X weighted counter (`X換算 n / 280`). See the server AI section below.
- **Developer label (FR-07):** "開発者：" is appended only while the toggle is on; it resets to off for the next post.
- **ポスト確認 (FR-08/09):** shows the full text and media preview. With media, the primary "写真/動画と本文をXへ" button shares the original File and final text together, synchronously from the tap; the user selects X in the OS share sheet. While the File is loading, missing, or unsupported, this button stays disabled. Cancellation/errors retain both inputs; a stuck share becomes retryable. Web Share success does not prove which app received the data or whether it kept the text and file. Text-only opening remains an explicitly labelled alternative. Without media, the existing text link remains primary. On iPhone/iPad, "Xアプリで開く" requests the native composer using the `twitter:` scheme; Android uses a package-targeted Chrome Intent with a web fallback. Desktop keeps the HTTPS composer. App-link support must be verified on the target phone and X version. Mobile users can explicitly select "ブラウザ版で開く" or copy the full post text. No timer redirects the user after a launch attempt. Sharing is disabled over the X limit. The app records "Xを開く操作済み", not verified app launch or posting success.
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
| `src/lib/ai.ts`, `generation.ts` | `AiProvider` interface and the generation runner; same-origin HTTP provider |
| `src/app/` | Controller hook, context, in-app navigation (History API) |
| `src/screens/`, `src/components/` | UI |
| `tests/unit/` | Unit tests (reducer, share helper, repository with `fake-indexeddb`, restore, persistence) |
| `tests/e2e/` | Playwright main-flow and failure-path tests |

## Not implemented / open

- **Cloudflare connection and real-inference verification depend on deployment.** See the current verification record. This implementation does not consume the visitor’s ChatGPT subscription usage.
- Draft deletion, retention limits and storage-size limits (U-04, U-05).
- Not verified on real devices: the iOS/Android share sheet, "画像を保存" into the photo library, the X app hand-off, and video playback from stored blobs on iOS Safari. Browsers may also evict site data (for example Safari after a period without use); the app does not claim permanent storage.

## Server AI (2026-10-20)

写真を選ぶと同じ画面で投稿文を自動生成します。自動生成はOFFにでき、生成中も本文編集・中止ができます。途中の手入力・全消去、写真の交換は遅れた生成結果で上書きしません。動画は冒頭の静止画を使い、音声は要約しません。

`browser → Sites /api/summary → authenticated Cloudflare Worker → Workers AI`

- 固定の画像対応モデル `@cf/qwen/qwen3.8-27b`。日本語約100文字、出力最大700トークン、応答最大140文字。写真を縮小して送り、ハッシュタグはモデルへ送信しません。
- Sitesは利用者の認証・同一オリジン・実ボディサイズを検査。Cloudflareにはサーバー間専用の秘密値で接続します。Cloudflare側でも画像形式・サイズ・秘密値を検査します。
- データベース、画像保存先、AI Gateway、プロンプトログを作りません。写真送信先を画面に明示します。
- Workers **Free**アカウントでのみ無料枠利用を有効にする運用です。1日10,000 Neuronsはアカウント全体で共有します。超過時は生成停止、再試行・有料化・別モデルへの切替を自動実行しません。Paidアカウントでは超過課金されるため、単に確認フラグを立ててはいけません。
- 中止は画面の待機とHTTPリクエストを止めます。受理済みのサーバー推論が完了する場合があります。
- 詳細な配置手順・検証状態は [server-ai-cloudflare.md](../docs/server-ai-cloudflare.md)。

```sh
npm run test:unit
npm run test:server
npm run test:e2e
npm run build:worker
npx wrangler deploy --dry-run --config cloudflare/wrangler.jsonc
```

通常の`npm run dev`/`preview`は静的フロントのみでAI未接続です。E2Eのサーバー応答はテスト用です。実モデルの成功と混同しません。
