# LT Share

Share each lightning talk to X in a few taps while you keep listening.

LT Share is a mobile web app for attendees of developer lightning-talk events. Set the event hashtags once, record a photo or video of the talk, save it to your phone, write the post, and hand it off to X. The hashtags carry over to the next talk.

> **Status:** v1 web app implemented in [`app/`](app/), tested in a headless browser and published **privately** (owner only) on OpenAI Sites. Experimental **on-device photo summaries** are implemented (see [verification](docs/verification.md)). Prepare the local model once (~0.9GB download) on a compatible browser; no AI API key is needed. The camera, share sheet and X hand-off have not been verified on a real phone yet.

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

- Browser UI served by the existing Sites Worker, without a database. Photos, videos and drafts are stored in the visitor's browser (IndexedDB). AI inference runs on the device; model/runtime downloads are the only external AI requests.
- Saving to the phone's photo library goes through the share sheet or a download, and is marked as saved only after the user confirms.
- Posting always happens in X by the user. The app opens X with the composed text; photos and videos are attached through the share sheet or from the photo library.
