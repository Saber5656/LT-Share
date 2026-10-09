# LT Share on X: web app (v1)

A mobile-first web app for lightning-talk attendees: set the event hashtags once, record a photo or video of the talk, write the post, and hand it to X. The hashtags carry over to the next talk.

It is a **static site** (Vite + React 19 + TypeScript). There is no server, serverless function or database; photos, videos and drafts are stored in the visitor's own browser (IndexedDB). Requirements: [`../docs/requirements.md`](../docs/requirements.md). Screen design: [`../docs/DESIGN.md`](../docs/DESIGN.md). The clickable mock in [`../mock/`](../mock/) is the approved visual reference.

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
- `.openai/hosting.json` (`{"static": {"directory": "dist"}}`) tells OpenAI Sites to serve `dist` at the site root. The Site project id has to be added when the project is created. Nothing here has been deployed.
- **Check on a real device after publishing.** The following cannot be verified headlessly and must be tried on an iPhone (Safari) and an Android phone (Chrome), ideally also inside the X app's in-app browser: previews of photos and videos read back from the browser's storage (`blob:` URLs), the share sheet ("画像を保存" / "ビデオを保存" into the photo library), and the hand-off to the X app from "Xで開く" and "写真/動画付きで共有".

## How it behaves

- **Record (FR-02):** a hidden `<input type="file" capture="environment">` per kind (`image/*` or `video/*`) opens the phone's camera UI. Cancelling the picker changes nothing. Re-recording replaces the draft's media; the copy in the phone's photo library is never touched.
- **Save to device (FR-03):** browsers cannot write to the photo library silently. "端末に保存" opens the share sheet (iOS offers "画像を保存" / "ビデオを保存") when the browser can share files, otherwise it starts a download. Neither tells the page whether the user really saved the file, so the app asks "写真アプリ（ギャラリー）に保存できましたか？". Only "保存できた" marks the media as saved. A dismissed share sheet changes nothing; an error shows a retry and a download fallback.
- **Post text (FR-05/06):** manual textarea with the X weighted counter (`X換算 n / 280`).
- **Developer label (FR-07):** "開発者：" is appended only while the toggle is on; it resets to off for the next post.
- **ポスト確認 (FR-08/09):** shows the full text. "Xで開く" is a real `<a href="https://x.com/intent/post?text=...">` so a phone can hand it to the X app. "写真/動画付きで共有" uses the Web Share API with the file and the text when the browser supports it (the user picks X in the share sheet). Sharing is disabled over the X limit. The app never says "投稿済み": statuses are "Xで開いた" and "未確認".
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
| `src/lib/ai.ts`, `generation.ts` | `AiProvider` interface (no provider wired) and the generation runner |
| `src/app/` | Controller hook, context, in-app navigation (History API) |
| `src/screens/`, `src/components/` | UI |
| `tests/unit/` | Unit tests (reducer, share helper, repository with `fake-indexeddb`, restore, persistence) |
| `tests/e2e/` | Playwright main-flow and failure-path tests |

## Not implemented / open

- **AI text generation is not available.** The hosting platform cannot use the visitor's own ChatGPT plan (decision pending, requirement G-01). `getAiProvider()` in `src/lib/ai.ts` returns `null`, so the UI shows no AI controls. To plug a provider in, return an `AiProvider` (`generate({ image, tags }) => Promise<string>`) from that function; the reducer's generation states and the generate/retry UI are already in place and start after the user confirms the device save.
- Draft deletion, retention limits and storage-size limits (U-04, U-05).
- Not verified on real devices: the iOS/Android share sheet, "画像を保存" into the photo library, the X app hand-off, and video playback from stored blobs on iOS Safari. Browsers may also evict site data (for example Safari after a period without use); the app does not claim permanent storage.
