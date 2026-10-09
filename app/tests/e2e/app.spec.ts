import { expect, test, type Page } from "@playwright/test";

const PHOTO = "tests/fixtures/lt-photo.jpg";
const WELCOME_FLAG = "lt-share:welcome-seen";

type ShareMode = "ok" | "abort" | "fail" | "none";
type SharedCall = { text: string | null; files: Array<{ name: string; type: string; size: number }> };

// Headless Chromium has no share sheet. Stub navigator.share/canShare and record the calls.
// "none" simulates a browser without file sharing (the download fallback).
async function stubShare(page: Page, mode: ShareMode) {
  await page.addInitScript((mode) => {
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    if (mode === "none") {
      Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      return;
    }
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data?: ShareData) => Array.isArray(data?.files) && (data?.files?.length ?? 0) > 0,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        if (mode === "abort") throw new DOMException("cancelled", "AbortError");
        if (mode === "fail") throw new DOMException("denied", "NotAllowedError");
        w.__shared.push({
          text: data.text ?? null,
          files: (data.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
        });
      },
    });
  }, mode);
}

async function sharedCalls(page: Page): Promise<SharedCall[]> {
  return page.evaluate(() => (window as unknown as { __shared: SharedCall[] }).__shared);
}

async function open(page: Page, mode: ShareMode = "ok", { welcome = false } = {}) {
  await stubShare(page, mode);
  if (!welcome) {
    await page.addInitScript((key) => localStorage.setItem(key, "1"), WELCOME_FLAG);
  }
  await page.goto("/");
}

async function addTag(page: Page, text: string) {
  const input = page.getByLabel("ハッシュタグを追加");
  await input.fill(text);
  await input.press("Enter");
}

async function pickPhoto(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer } = PHOTO) {
  await page.getByTestId("pick-photo").setInputFiles(file);
}

const bodyBox = (page: Page) => page.getByRole("textbox", { name: "投稿文", exact: true });
const saveButton = (page: Page) => page.getByRole("button", { name: "端末に保存", exact: true });
const notSavedYet = (page: Page) => page.getByText("まだ端末に保存されていません", { exact: true });
const savedLine = (page: Page) => page.getByText("端末に保存済み", { exact: true });
const askLine = (page: Page) => page.getByText("写真アプリ（ギャラリー）に保存できましたか？");

async function recordAndConfirm(page: Page) {
  await pickPhoto(page);
  await saveButton(page).click();
  await page.getByRole("button", { name: "保存できた" }).click();
  await expect(savedLine(page)).toBeVisible();
}

test("main flow: record, confirm the device save, post to X, move on, and survive a reload", async ({
  page,
  context,
}) => {
  // Never reach the real X in tests; the popup gets a stub page.
  await context.route("https://x.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>X stub</title>" }),
  );
  await open(page);

  await expect(page.getByRole("heading", { name: "LT Share on X", level: 1 })).toBeVisible();
  await expect(page.getByText("1本目の投稿案")).toBeVisible();
  // AI generation is not available in this version: no AI wording anywhere on the composer.
  await expect(page.getByText(/ChatGPT|AIで生成/)).toHaveCount(0);

  // ① hashtags: several tags, normalization and case-insensitive de-duplication
  await addTag(page, "TechLTNight");
  await addTag(page, "＃Rust");
  await addTag(page, "#rust");
  await expect(page.locator(".tag-chip")).toHaveText(["#TechLTNight", "#Rust"]);

  // ② record: the photo is held by the app but is NOT saved on the device yet
  await pickPhoto(page);
  await expect(page.getByRole("img", { name: "記録した写真" })).toBeVisible();
  await expect(notSavedYet(page)).toBeVisible();
  await expect(savedLine(page)).toHaveCount(0);

  // ③ save to device: the share sheet is only a hand-off; the user must confirm
  await saveButton(page).click();
  await expect(askLine(page)).toBeVisible();
  await expect(savedLine(page)).toHaveCount(0);
  const [first] = await sharedCalls(page);
  expect(first?.files).toHaveLength(1);
  expect(first?.files[0]).toMatchObject({ name: "lt-photo.jpg", type: "image/jpeg" });
  expect(first?.text).toBeNull();
  await page.getByRole("button", { name: "保存できた" }).click();
  await expect(savedLine(page)).toBeVisible();
  await expect(askLine(page)).toHaveCount(0);

  // ④ post text + developer toggle
  const body = "RustでCLIを作るLT。clapで引数処理を書き、cargo-distで配布まで自動化する流れを紹介。";
  await bodyBox(page).fill(body);
  const developer = page.getByRole("switch", { name: "開発者をポストに含める" });
  await expect(developer).toHaveAttribute("aria-checked", "false");
  await developer.click();
  await expect(developer).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/^X換算 \d+ \/ 280$/)).toBeVisible();

  // ポスト確認
  await page.getByRole("button", { name: "ポスト確認" }).click();
  const sheet = page.getByRole("dialog", { name: "ポスト確認" });
  await expect(sheet).toBeVisible();
  const expectedText = `${body}\n\n#TechLTNight #Rust\n\n開発者：`;
  await expect(sheet.getByLabel("Xに渡す本文")).toHaveText(expectedText);
  await expect(sheet.getByText("Xで写真アプリから添付してください", { exact: false })).toBeVisible();

  const xLink = sheet.getByRole("link", { name: /Xで開く/ });
  const href = await xLink.getAttribute("href");
  expect(href).toBe(`https://x.com/intent/post?text=${encodeURIComponent(expectedText)}`);
  expect(href).toContain(encodeURIComponent("#TechLTNight"));
  expect(href).toContain(encodeURIComponent("開発者："));
  await expect(xLink).toHaveAttribute("target", "_blank");
  await expect(xLink).toHaveAttribute("rel", /noopener/);

  // Media + text share (user picks X in the share sheet)
  await sheet.getByRole("button", { name: "写真付きで共有" }).click();
  await expect.poll(async () => (await sharedCalls(page)).length).toBe(2);
  const second = (await sharedCalls(page))[1];
  expect(second?.text).toBe(expectedText);
  expect(second?.files[0]?.name).toBe("lt-photo.jpg");

  // The real anchor opens X in a new tab and marks the draft as opened (never as posted)
  const popup = page.waitForEvent("popup");
  await xLink.click();
  await (await popup).close();
  await expect(sheet.getByText("Xの投稿画面を開きました", { exact: false })).toBeVisible();
  await expect(page.getByText("投稿済み")).toHaveCount(0);
  await sheet.getByRole("button", { name: "閉じる" }).click();
  await expect(sheet).toHaveCount(0);

  // 次の投稿へ: tags stay; text, media and the developer toggle are reset
  await page.getByRole("button", { name: "次の投稿へ" }).click();
  await expect(page.getByText("1本目を保存しました", { exact: false })).toBeVisible();
  await expect(page.getByText("2本目の投稿案")).toBeVisible();
  await expect(page.locator(".tag-chip")).toHaveCount(2);
  await expect(bodyBox(page)).toHaveValue("");
  await expect(page.getByRole("img", { name: "記録した写真" })).toHaveCount(0);
  await expect(page.getByText("LTのスライドや様子を記録")).toBeVisible();
  await expect(page.getByRole("switch", { name: "開発者をポストに含める" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: /保存した投稿案 1/ })).toBeVisible();

  // Reload: everything is restored from the device (IndexedDB)
  await page.reload();
  await expect(page.getByText("2本目の投稿案")).toBeVisible();
  await expect(page.locator(".tag-chip")).toHaveCount(2);
  await page.getByRole("button", { name: /保存した投稿案 1/ }).click();

  const row = page.getByTestId("draft-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("1本目");
  await expect(row).toContainText("Xで開いた");
  await expect(row).toContainText("RustでCLIを作るLT。");
  await expect(row).toContainText("#TechLTNight #Rust");
  const thumb = row.locator("img");
  await expect(thumb).toBeVisible();
  expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("X上で修正した内容や、投稿したかどうかは、ここには反映されません。").first()).toBeVisible();

  // Detail: media, text, and a second post check
  await row.click();
  await expect(page.getByRole("img", { name: "記録した写真" })).toBeVisible();
  await expect(page.getByLabel("保存した投稿案の本文")).toHaveText(expectedText);
  await page.getByRole("button", { name: "もう一度ポスト確認" }).click();
  await expect(page.getByRole("dialog", { name: "ポスト確認" }).getByRole("link", { name: /Xで開く/ })).toHaveAttribute(
    "href",
    `https://x.com/intent/post?text=${encodeURIComponent(expectedText)}`,
  );
});

test("a dismissed share sheet changes nothing; the media stays unsaved", async ({ page }) => {
  await open(page, "abort");
  await pickPhoto(page);
  await saveButton(page).click();

  await expect(notSavedYet(page)).toBeVisible();
  await expect(askLine(page)).toHaveCount(0);
  await expect(saveButton(page)).toBeEnabled();
});

test("without file sharing the file is downloaded, and still needs the user's confirmation", async ({ page }) => {
  await open(page, "none");
  await pickPhoto(page);

  const download = page.waitForEvent("download");
  await saveButton(page).click();
  expect((await download).suggestedFilename()).toBe("lt-photo.jpg");

  await expect(askLine(page)).toBeVisible();
  await expect(savedLine(page)).toHaveCount(0);
  await page.getByRole("button", { name: "もう一度" }).click();
  // "もう一度" starts the save again and asks again afterwards.
  await expect(askLine(page)).toBeVisible();
});

test("a failing share shows a failure with retry and a download fallback", async ({ page }) => {
  await open(page, "fail");
  await pickPhoto(page);
  await saveButton(page).click();

  await expect(page.getByText("端末に保存できませんでした")).toBeVisible();
  await expect(savedLine(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ダウンロードで保存" }).click();
  expect((await download).suggestedFilename()).toBe("lt-photo.jpg");
  await expect(askLine(page)).toBeVisible();
});

test("次の投稿へ refuses an empty draft and media that is not confirmed saved", async ({ page }) => {
  await open(page);
  const next = page.getByRole("button", { name: "次の投稿へ" });

  await next.click();
  await expect(page.getByText("まだ記録も投稿文もありません", { exact: false })).toBeVisible();
  await expect(page.getByText("2本目の投稿案")).toHaveCount(0);

  await pickPhoto(page);
  await bodyBox(page).fill("本文");
  await next.click();
  const toast = page.getByRole("status");
  await expect(toast).toContainText("まだ端末に保存されていません");
  await expect(page.getByText("1本目の投稿案")).toBeVisible();

  // The toast offers the save action directly
  await toast.getByRole("button", { name: "端末に保存" }).click();
  await expect(askLine(page)).toBeVisible();
  await next.click();
  await expect(page.getByRole("status")).toContainText("確認してください");
  await expect(page.getByText("1本目の投稿案")).toBeVisible();

  await page.getByRole("button", { name: "保存できた" }).click();
  await next.click();
  await expect(page.getByText("2本目の投稿案")).toBeVisible();
});

test("re-recording replaces the draft's media and removes the old blob only after it is stored", async ({ page }) => {
  await open(page);
  await recordAndConfirm(page);

  const mediaCount = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open("lt-share");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const count = open.result.transaction("media").objectStore("media").count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
          };
        }),
    );
  await expect.poll(mediaCount).toBe(1);

  // A second recording replaces the first and starts as "not saved" again
  await pickPhoto(page, { name: "second.jpg", mimeType: "image/jpeg", buffer: Buffer.from("second-photo-bytes") });
  await expect(notSavedYet(page)).toBeVisible();
  await expect(savedLine(page)).toHaveCount(0);
  await expect.poll(mediaCount).toBe(1);
});

test("a video is recorded through the video picker", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "動画" }).click();
  await page
    .getByTestId("pick-video")
    .setInputFiles({ name: "talk.mp4", mimeType: "video/mp4", buffer: Buffer.from("not-a-real-video") });

  await expect(page.locator(".media-frame video")).toBeVisible();
  await expect(notSavedYet(page)).toBeVisible();
  await saveButton(page).click();
  await page.getByRole("button", { name: "保存できた" }).click();
  await expect(savedLine(page)).toBeVisible();
  const [call] = await sharedCalls(page);
  expect(call?.files[0]).toMatchObject({ name: "talk.mp4", type: "video/mp4" });
});

test("over the X limit the post cannot be handed to X", async ({ page }) => {
  await open(page);
  await addTag(page, "TechLTNight");
  await bodyBox(page).fill("あ".repeat(150)); // 300 weighted characters
  await expect(page.getByText("Xの上限を超えています", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "ポスト確認" }).click();
  const sheet = page.getByRole("dialog", { name: "ポスト確認" });
  await expect(sheet.getByRole("link", { name: /Xで開く/ })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: /Xで開く/ })).toBeDisabled();
});

test("the first-run notice is shown once and can be reopened", async ({ page }) => {
  await open(page, "ok", { welcome: true });

  await expect(page.getByRole("heading", { name: "データの扱い" })).toBeVisible();
  await expect(page.getByText("この端末（ブラウザ）に保存します", { exact: false })).toBeVisible();
  await expect(page.getByText("独自のサーバーやデータベースを持たない設計です", { exact: false })).toBeVisible();
  await expect(page.getByText(/一切.*送信されない/)).toHaveCount(0);

  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.getByText("1本目の投稿案")).toBeVisible();

  await page.reload();
  await expect(page.getByText("1本目の投稿案")).toBeVisible();

  await page.getByRole("button", { name: /保存した投稿案/ }).click();
  await page.getByRole("button", { name: "使い方とデータの扱い" }).click();
  await expect(page.getByRole("heading", { name: "データの扱い" })).toBeVisible();
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(page.getByRole("heading", { name: "保存した投稿案" })).toBeVisible();
});

test("the phone's back button moves between screens", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /保存した投稿案/ }).click();
  await expect(page.getByRole("heading", { name: "保存した投稿案" })).toBeVisible();

  await page.goBack();
  await expect(page.getByText("1本目の投稿案")).toBeVisible();

  await bodyBox(page).fill("本文");
  await page.getByRole("button", { name: "ポスト確認" }).click();
  const sheet = page.getByRole("dialog", { name: "ポスト確認" });
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText("1本目の投稿案")).toBeVisible();
});

test("when the browser blocks on-device storage the app says so and keeps working in memory", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
  });
  await open(page);

  await expect(page.getByRole("alert").filter({ hasText: "このブラウザでは端末内への保存を使えません" })).toBeVisible();
  await bodyBox(page).fill("入力は続けられる");
  await expect(bodyBox(page)).toHaveValue("入力は続けられる");
  await page.getByRole("button", { name: "ポスト確認" }).click();
  await expect(page.getByRole("dialog", { name: "ポスト確認" }).getByRole("link", { name: /Xで開く/ })).toBeVisible();
});

test("a write failure (e.g. storage full) is shown without losing anything, and 次の投稿へ waits for a retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __failWrites: boolean };
    w.__failWrites = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (w.__failWrites) throw new DOMException("quota", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await open(page);

  await bodyBox(page).fill("容量不足でも入力は消えない");
  const banner = page.getByRole("alert").filter({ hasText: "端末内（ブラウザ）に保存できませんでした" });
  await expect(banner).toBeVisible();
  await expect(bodyBox(page)).toHaveValue("容量不足でも入力は消えない");

  // FR-10: the draft is not stored, so the app does not move on and keeps it on screen.
  await page.getByRole("button", { name: "次の投稿へ" }).click();
  await expect(page.getByRole("status")).toContainText("次へ進めません");
  await expect(page.getByText("1本目の投稿案")).toBeVisible();
  await expect(bodyBox(page)).toHaveValue("容量不足でも入力は消えない");

  // Space is available again: retry stores everything and the banner goes away.
  await page.evaluate(() => {
    (window as unknown as { __failWrites: boolean }).__failWrites = false;
  });
  await banner.getByRole("button", { name: "再試行" }).click();
  await expect(banner).toHaveCount(0);
  await page.getByRole("button", { name: "次の投稿へ" }).click();
  await expect(page.getByText("2本目の投稿案")).toBeVisible();
});

test("text and tags are restored after a reload without moving on", async ({ page }) => {
  await open(page);
  await addTag(page, "TechLTNight");
  await bodyBox(page).fill("リロードしても残る");
  await page.waitForTimeout(600); // let the debounced write finish
  await page.reload();

  await expect(page.locator(".tag-chip")).toHaveText("#TechLTNight");
  await expect(bodyBox(page)).toHaveValue("リロードしても残る");
});
