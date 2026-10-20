# LT Share

Share each lightning talk to X in a few taps while you keep listening.

LT Share is a mobile web app for attendees of developer lightning-talk events. Set the event hashtags once, record a photo or video of the talk, save it to your phone, write the post, and hand it off to X. The hashtags carry over to the next talk.

> **Status:** Standalone mobile web app on owner-private OpenAI Sites. The current change replaces the browser model download with **server-side photo summaries via Cloudflare Workers AI**. Deployment and real-inference status are recorded in [verification](docs/verification.md). No ChatGPT subscription or end-user API key is needed for this path. Camera, photo-library saving and X hand-off still require physical-phone verification.

<p>
  <img src="docs/design/screenshots/01-composer-hero.png" width="240" alt="Composer screen with hashtags, recorded photo, post text and the post check button">
  <img src="docs/design/screenshots/05-handoff-sheet.png" width="240" alt="Post check sheet before opening X">
  <img src="docs/design/screenshots/12-history.png" width="240" alt="Saved drafts list">
</p>

## Repository layout

| Path | Contents |
| --- | --- |
| [`app/`](app/) | The web app (Vite + React + TypeScript, browser UI for OpenAI Sites). See [`app/README.md`](app/README.md). |
| [`docs/requirements.md`](docs/requirements.md) | Requirements definition LT-SRS-001 v1.0 (Japanese) |
| [`docs/verification.md`](docs/verification.md) | Feasibility checks G-01 to G-03 and the pending AI decision (Japanese) |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Screen design record (Japanese) |
| [`docs/design/`](docs/design/) | Design concepts and screenshots of the mock |
| [`mock/`](mock/) | Clickable screen mock used as the approved visual reference |

## Run the app

Requires Node.js 22.18 or later.

```bash
cd app
npm ci
npm run dev
```

Checks: `npm run typecheck`, `npm run test:unit`, `npm run build`, and `LT_E2E_PORT=4391 npm run test:e2e` (Playwright).

## How it is built

- Browser UI served by the existing Sites Worker, without a database. Photos, videos and drafts are stored in the visitor's browser (IndexedDB). A reduced image is sent through the authenticated Sites server to Cloudflare Workers AI; no model is downloaded to the phone. No database or image archive is added.
- Saving to the phone's photo library goes through the share sheet or a download, and is marked as saved only after the user confirms.
- Posting always happens in X by the user. The app opens X with the composed text; photos and videos are attached through the share sheet or from the photo library.
