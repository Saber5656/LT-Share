// Design-QA capture for the LT Share on X screen mock.
// Captures the 1:1 phone screen (393 x 852 CSS px, deviceScaleFactor 1) for each main state,
// plus side-by-side comparison images against the selected visual target.
//
// Usage (with `npm run dev` running):
//   MOCK_URL=http://127.0.0.1:5173/ npm run qa:capture
// Output: test-results/qa/ (git-ignored) unless OUT_DIR is set.
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const MOCK_DIR = path.resolve(__dirname, "../..");
const OUT = path.resolve(process.env.OUT_DIR || path.join(MOCK_DIR, "test-results/qa"));
const URL = process.env.MOCK_URL || "http://127.0.0.1:5173/";
const REF = path.resolve(MOCK_DIR, "../docs/design/concepts/post-preview-form-revised.png");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

  const screen = page.getByTestId("device-screen");
  const open = async () => {
    await page.goto(URL);
    await screen.waitFor({ state: "visible" });
    await page.waitForTimeout(600);
  };
  await open();
  const box = await screen.boundingBox();
  console.log("device screen box", JSON.stringify(box));
  if (!box || Math.abs(box.width - 393) > 1 || Math.abs(box.height - 852) > 1) {
    throw new Error(`Expected an unscaled 393x852 screen, got ${box?.width}x${box?.height}`);
  }

  const shot = async (name) => {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(450);
    // Playwright's click-into-view can scroll the overflow-hidden device screen; normalize it.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="device-screen"]');
      if (el) el.scrollTop = 0;
    });
    await screen.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log("captured", name);
  };
  const click = (name) => page.getByRole("button", { name, exact: true }).first().click();
  const scroll = async (deltaY) => {
    const b = await screen.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(700);
  };
  const expectDisabled = async (name) => {
    const disabled = await page.getByRole("button", { name, exact: true }).first().isDisabled();
    if (!disabled) throw new Error(`Expected "${name}" to be disabled`);
    console.log(`checked: "${name}" is disabled`);
  };

  // Hero state (the selected visual target)
  await shot("01-composer-hero");
  await scroll(400);
  await shot("02-composer-hero-scrolled");
  await scroll(-3000);

  // Hashtags
  const tagInput = page.getByLabel("ハッシュタグを追加");
  await tagInput.click();
  await tagInput.fill("#AI");
  await shot("03-tag-typing-keyboard");
  await tagInput.press("Enter");
  await page.locator(".step-title").first().click();
  await shot("04-tag-added");

  // Developer label and post check
  await page.getByRole("switch", { name: "開発者をポストに含める" }).click();
  await click("ポスト確認");
  await page.waitForTimeout(500);
  await shot("05-handoff-sheet");
  await click("Xで開く");
  await page.waitForTimeout(300);
  await shot("06-after-open-x-toast");

  // Next draft keeps tags, resets the rest
  await page.waitForTimeout(2800);
  await click("次の投稿へ");
  await page.waitForTimeout(400);
  await shot("07-next-draft-empty");

  // Record a photo: saving -> generating -> generated
  await click("記録する");
  await shot("08-camera-photo");
  await click("撮影");
  await page.waitForTimeout(150);
  await shot("09-saving");
  await expectDisabled("ポスト確認");
  await expectDisabled("記録する");
  await page.waitForTimeout(900);
  await shot("10-generating");
  await page.waitForTimeout(2000);
  await shot("11-generated");

  // Saved drafts and detail
  await page.getByRole("button", { name: /保存した投稿案/ }).click();
  await page.waitForTimeout(500);
  await shot("12-history");
  await page.getByRole("button", { name: /3本目/ }).click();
  await page.waitForTimeout(500);
  await shot("13-draft-detail");
  await page.getByRole("button", { name: "戻る" }).click();
  await page.waitForTimeout(400);

  // Mock controls: next save fails, next generation hits the usage limit
  await page.getByRole("switch", { name: "次の端末保存を失敗させる" }).click();
  await page.getByRole("radio", { name: "利用上限" }).click();
  await scroll(600);
  await shot("14-history-mock-panel");
  await click("初回の案内画面を見る");
  await page.waitForTimeout(500);
  await shot("15-welcome");
  await click("ChatGPTで続ける");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "戻る" }).click();
  await page.waitForTimeout(500);

  // Re-record as video: save fails, next draft is refused, retry, then the usage limit notice
  await page.getByRole("radio", { name: "動画" }).first().click();
  await click("記録する");
  await shot("16-camera-video");
  await click("録画を開始");
  await page.waitForTimeout(2100);
  await shot("17-camera-recording");
  await click("録画を停止");
  await page.waitForTimeout(1200);
  await shot("18-save-failed");
  await click("次の投稿へ");
  await page.waitForTimeout(200);
  await shot("19-next-blocked-toast");
  await click("再試行");
  await page.waitForTimeout(3200);
  await scroll(300);
  await shot("20-ai-quota");

  // Pixel 10 preset
  await open();
  await page.getByTestId("device-picker").click();
  await page.locator("[data-testid^=device-option-pixel]").first().click();
  await page.waitForTimeout(600);
  await shot("21-pixel-hero");
  await click("記録する");
  await shot("22-pixel-camera");
  await click("キャンセル");

  // Comparison inputs against the selected visual target
  const ref = fs.readFileSync(REF).toString("base64");
  const impl = fs.readFileSync(path.join(OUT, "01-composer-hero.png")).toString("base64");
  const cmp = await browser.newPage({ viewport: { width: 840, height: 900 }, deviceScaleFactor: 1 });
  await cmp.setContent(`<body style="margin:0;display:flex;gap:24px;padding:12px;background:#ddd;font:12px sans-serif">
    <div><div>source (normalized 390 wide)</div><img src="data:image/png;base64,${ref}" style="width:390px;display:block"></div>
    <div><div>implementation 393x852</div><img src="data:image/png;base64,${impl}" style="width:393px;display:block"></div></body>`);
  await cmp.screenshot({ path: path.join(OUT, "compare-hero.png"), fullPage: true });
  const crop = (src, w, top, h, label) =>
    `<div><div>${label}</div><div style="width:${w}px;height:${h}px;overflow:hidden;position:relative;border:1px solid #999"><img src="data:image/png;base64,${src}" style="width:${w}px;position:absolute;top:-${top}px"></div></div>`;
  const focus = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 2 });
  await focus.setContent(`<body style="margin:0;padding:10px;background:#ddd;font:12px sans-serif;display:grid;gap:12px">
    <div style="display:flex;gap:16px">${crop(ref, 390, 140, 150, "source: steps 1-2")}${crop(impl, 393, 180, 150, "implementation: steps 1-2")}</div>
    <div style="display:flex;gap:16px">${crop(ref, 390, 580, 140, "source: step 3")}${crop(impl, 393, 618, 160, "implementation: step 3")}</div></body>`);
  await focus.screenshot({ path: path.join(OUT, "compare-focus.png"), fullPage: true });
  console.log("captured comparisons");

  console.log("console errors/warnings:", problems.length ? `\n${problems.join("\n")}` : "none");
  await browser.close();
  if (problems.length) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
