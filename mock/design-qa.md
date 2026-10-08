# Design QA — LT Share on X screen mock

- Date: 2026-10-09
- Source visual truth: `docs/design/concepts/post-preview-form-revised.png` (853 x 1844 px, app content only, no device chrome; scaled to 390 px wide for comparison)
- Implementation screenshot: `docs/design/screenshots/01-composer-hero.png`. Element capture of `[data-testid="device-screen"]` on the iPhone preset at `deviceScaleFactor: 1`. The element's bounding box is 393 x 852 CSS px (unscaled, checked by the script); the PNG is 394 x 852 px because the element starts at x = 503.5.
- Capture: `npm run qa:capture` (`tests/qa/capture-states.cjs`, Playwright Chromium headless, 1400 x 1200 viewport). Claude in Chrome was unreachable in this session, so the Playwright capture path described by the design-qa skill was used. The script resets the device screen's `scrollTop` before each capture, because Playwright's click-into-view can scroll the overflow-hidden device screen during a screen transition (not reproducible with a normal click).
- State compared: composer, 3本目 draft, tags `#TechLTNight #Rust`, photo saved, text generated, developer toggle OFF.
- Full-view comparison: `docs/design/screenshots/compare-hero.png`
- Focused comparison (steps 1–2 and step 3): `docs/design/screenshots/compare-focus.png`
- Console errors/warnings during the scripted run: none (the script exits non-zero if any appear)

## Findings (final)

No open P0/P1/P2 findings.

### Expected deviations

- The source frame omits the status bar; the template keeps its live status bar (54 px), so the same content starts ~45 px lower and step 4 sits below the fold on the iPhone preset. Device chrome is template-owned and intentionally preserved.
- Photo content differs: the prototype uses separately generated venue photos (`mock/public/assets/photos/`) in the same art direction, without third-party logos.
- `X換算` reads 153 instead of the source's 152: the prototype computes the weighted count of the actual composed post.

### Follow-up polish (P3)

- Japanese glyphs render with the platform font (Hiragino on Apple, Noto Sans CJK on Android) instead of Noto Sans JP, which changes line breaks slightly. Chosen to match what the real mobile web app will show and to avoid shipping several MB of Japanese web fonts.
- "記録する" label is ~1 px larger than the source.

## Comparison history

1. Iteration 1 (first build)
   - [P1] Content showed through below the fixed "ポスト確認" footer on iOS. FlowStack already lifts the footer above the home indicator, and the footer added its own safe-area padding. Fix: footer height 70, removed the extra padding, painted the gap below the footer white (`.app-footer::after`), and padded screens with `--mobile-safe-area-height`.
   - [P2] Tag input wrapped to a second row (chips 15 px), pushing every step down. Fix: chips 14 px / 31 px tall, tighter padding, 12 px remove icon, input min-width 104 px.
   - [P2] Extra top spacing above step 1. Fix: screen top padding 12 → 4 px, meta link 32 → 30 px, step padding 14 px.
   - [P2] A previous toast rendered above the camera shutter. Fix: toast layer below the camera; toast cleared when the camera opens.
2. Iteration 2
   - [P2] Post text wrapped to 4 lines vs 3 in the source (15 px vs ~14 px). Fix: text field 14 px / 1.45.
3. Iteration 3 (all states)
   - [P2] "Xで開いた" badge wrapped onto two lines on the draft detail screen. Fix: badge `flex: none; white-space: nowrap`.
4. Iteration 4 (after the independent code review)
   - [P2] On Pixel 10 the camera's top row overlapped the status bar (fixed 54 px offset; Pixel safe area is 64 px). Fix: offset from the device geometry. Evidence: `22-pixel-camera.png`.
   - [P2] "記録する" is now disabled while a recording is saving or being summarized, but looked enabled. Fix: disabled outline buttons at 45 % opacity. Evidence: `09-saving.png`.
   - Post-fix evidence for all iterations: `compare-hero.png`, `compare-focus.png`, `13-draft-detail.png`, `09-saving.png`, `22-pixel-camera.png`.

## Primary interactions tested (scripted)

Tag add (simulated keyboard) and remove, developer toggle, ポスト確認 sheet → Xで開く (mock toast and "Xで開いた" status), 次の投稿へ (tags carried, body/media reset), camera photo capture → 端末に保存中 (ポスト確認 and 記録する disabled, asserted) → ChatGPTで生成中 → generated, saved drafts list and detail, mock controls, first-run screen, video recording timer, save failure → 次の投稿へ refused → 再試行, usage-limit notice, Pixel 10 composer and camera.

Not covered by the script: the 280-character over-limit state, a manually edited body surviving a re-record, and late generation results on a saved draft (these are covered by `npm run test:unit` at the state level).

final result: passed
