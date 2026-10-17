import { expect, test, type Page } from "@playwright/test";

const PHOTO = "tests/fixtures/lt-photo.jpg";
const WELCOME_FLAG = "lt-share:welcome-seen";

type ShareMode = "ok" | "abort" | "fail" | "hang" | "none";
type SharedCall = {
  text: string | null;
  files: Array<{ name: string; type: string; size: number }>;
  // Was navigator.share() called in the same task as the tap, while the tap's user activation was live?
  sameTask: boolean;
  activation: boolean | null;
};

// Headless Chromium has no share sheet. Stub navigator.share/canShare and record the calls.
// "none" simulates a browser without file sharing (the download fallback); "hang" a
// WebView whose share() never settles.
async function stubShare(page: Page, mode: ShareMode) {
  await page.addInitScript((mode) => {
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    if (mode === "none") {
      Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      return;
    }
    let inClickTask = false;
    document.addEventListener(
      "click",
      () => {
        inClickTask = true;
        setTimeout(() => {
          inClickTask = false;
        }, 0);
      },
      true,
    );
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data?: ShareData) => Array.isArray(data?.files) && (data?.files?.length ?? 0) > 0,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (data: ShareData) => {
        w.__shared.push({
          text: data.text ?? null,
          files: (data.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
          sameTask: inClickTask,
          activation: navigator.userActivation?.isActive ?? null,
        });
        if (mode === "hang") return new Promise<void>(() => {});
        if (mode === "abort") return Promise.reject(new DOMException("cancelled", "AbortError"));
        if (mode === "fail") return Promise.reject(new DOMException("denied", "NotAllowedError"));
        return Promise.resolve();
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

// Keys of an object store in the app's IndexedDB (to check what is really on disk).
const storedKeys = (page: Page, store: "drafts" | "media") =>
  page.evaluate(
    (store) =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("lt-share");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const keys = open.result.transaction(store).objectStore(store).getAllKeys();
          keys.onsuccess = () => resolve(keys.result.map(String));
          keys.onerror = () => reject(keys.error);
        };
      }),
    store,
  );

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

  await expect(page.getByRole("heading", { name: "LT Share", level: 1, exact: true })).toBeVisible();
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
  await expect(sheet.getByText("Xへの移動を開始しました", { exact: false })).toBeVisible();
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
  await expect(row).toContainText("Xを開く操作済み");
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

test("the share sheet is requested inside the tap, and only once the file has been loaded", async ({ page }) => {
  // Make reading a blob from storage slow, so the "file not loaded yet" window is visible.
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess");
    if (!original?.set) return;
    Object.defineProperty(IDBRequest.prototype, "onsuccess", {
      configurable: true,
      get: original.get,
      set(this: IDBRequest, handler: ((ev: Event) => void) | null) {
        const source = this.source as { name?: string } | null;
        const slow = sessionStorage.getItem("slowRead") === "1" && source?.name === "media";
        original.set!.call(
          this,
          slow && handler
            ? (event: Event) => {
                setTimeout(() => handler.call(this, event), 1200);
              }
            : handler,
        );
      },
    });
  });
  await open(page);
  await pickPhoto(page);
  await page.waitForTimeout(600); // let the draft be written
  await page.evaluate(() => sessionStorage.setItem("slowRead", "1"));
  await page.reload();

  // After a reload nothing is in memory: the button is disabled until the file is loaded.
  const save = saveButton(page);
  await expect(save).toBeDisabled();
  await expect(save).toBeEnabled();
  await save.click();

  const [call] = await sharedCalls(page);
  expect(call).toMatchObject({ sameTask: true, files: [{ name: "lt-photo.jpg" }] });
  expect(call?.activation).toBe(true);
});

test("a share call that never settles does not leave the save stuck (page visible again)", async ({ page }) => {
  await open(page, "hang");
  await pickPhoto(page);
  await saveButton(page).click();
  await expect(page.getByText("共有画面を開いています")).toBeVisible();

  // The user comes back to the page; the share promise never settled.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(askLine(page)).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "保存できた" }).click();
  await expect(savedLine(page)).toBeVisible();
});

test("a share call that never settles is given up after a timeout", async ({ page }) => {
  await page.clock.install();
  await open(page, "hang");
  await pickPhoto(page);
  await saveButton(page).click();
  await expect(page.getByText("共有画面を開いています")).toBeVisible();

  await page.clock.fastForward(61_000);
  await expect(askLine(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "もう一度" })).toBeEnabled();
  await expect(savedLine(page)).toHaveCount(0);
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
  // A refused move leaves no speculative second draft on disk.
  await page.waitForTimeout(600);
  expect(await storedKeys(page, "drafts")).toHaveLength(1);

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

test("次の投稿へ waits while a capture is still being stored, and the capture is never lost", async ({ page }) => {
  // Make storing a media blob slow: its transaction reports "complete" 1.5 s late.
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "oncomplete");
    if (!original?.set) return;
    Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
      configurable: true,
      get: original.get,
      set(this: IDBTransaction, handler: ((ev: Event) => void) | null) {
        const names = Array.from(this.objectStoreNames);
        const slow =
          sessionStorage.getItem("slowMedia") === "1" &&
          names.length === 1 &&
          names[0] === "media" &&
          this.mode === "readwrite";
        original.set!.call(
          this,
          slow && handler
            ? (event: Event) => {
                setTimeout(() => handler.call(this, event), 1500);
              }
            : handler,
        );
      },
    });
  });
  await open(page);
  await bodyBox(page).fill("本文あり");
  await page.waitForTimeout(400);
  await page.evaluate(() => sessionStorage.setItem("slowMedia", "1"));

  await pickPhoto(page);
  const importing = page.getByText("写真を取り込んでいます");
  await expect(importing).toBeVisible();
  const next = page.getByRole("button", { name: "次の投稿へ" });
  await expect(next).toBeDisabled();
  await expect(page.getByRole("button", { name: "ポスト確認" })).toBeDisabled();
  await expect(page.getByText("1本目の投稿案")).toBeVisible();
  await expect(page.getByText("本目を保存しました", { exact: false })).toHaveCount(0);

  // The capture lands in the draft that was on screen; nothing was thrown away.
  await expect(page.getByRole("img", { name: "記録した写真" })).toBeVisible();
  await expect(importing).toHaveCount(0);
  await expect(next).toBeEnabled();
  await expect(page.getByText("1本目の投稿案")).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem("slowMedia"));

  await saveButton(page).click();
  await page.getByRole("button", { name: "保存できた" }).click();
  await next.click();
  await expect(page.getByText("1本目を保存しました", { exact: false })).toBeVisible();
  await expect(page.getByText("2本目の投稿案")).toBeVisible();

  // Exactly the saved draft and the new current one are on disk (no ghost), and the photo is kept.
  await page.waitForTimeout(600);
  expect(await storedKeys(page, "drafts")).toHaveLength(2);
  expect(await storedKeys(page, "media")).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: /保存した投稿案 1/ }).click();
  const thumb = page.getByTestId("draft-row").locator("img");
  await expect(thumb).toBeVisible();
  expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
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

test("re-recording an unsaved photo asks inside the app (not window.confirm) and opens the picker from the tap", async ({
  page,
}) => {
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => {
    nativeDialogs += 1;
    void dialog.dismiss();
  });
  await open(page);
  await pickPhoto(page);
  await expect(notSavedYet(page)).toBeVisible();

  const record = page.getByRole("button", { name: "記録する" });
  const dialog = page.getByRole("dialog", { name: "撮り直しますか？" });

  // "やめる" keeps everything as it was.
  await record.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "やめる" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("img", { name: "記録した写真" })).toBeVisible();
  await expect(notSavedYet(page)).toBeVisible();

  // "撮り直す" opens the file picker directly from that tap (user activation), then replaces the photo.
  await record.click();
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "撮り直す" }).click();
  await (await chooser).setFiles({ name: "second.jpg", mimeType: "image/jpeg", buffer: Buffer.from("second-bytes") });
  await expect(dialog).toHaveCount(0);
  await expect(notSavedYet(page)).toBeVisible();
  await expect.poll(() => storedKeys(page, "media")).toHaveLength(1); // the replaced blob is removed once the draft is written
  expect(nativeDialogs).toBe(0);

  // A photo that is already saved on the device needs no confirmation.
  await saveButton(page).click();
  await page.getByRole("button", { name: "保存できた" }).click();
  const direct = page.waitForEvent("filechooser");
  await record.click();
  await direct;
  await expect(dialog).toHaveCount(0);
  expect(nativeDialogs).toBe(0);
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

test("a storage that never answers offers 再読込 or continuing without saving", async ({ page }) => {
  await page.clock.install();
  // indexedDB.open() returns a request that never fires.
  await page.addInitScript(() => {
    indexedDB.open = () => ({}) as IDBOpenDBRequest;
  });
  await open(page);

  const notice = page.getByRole("alert").filter({ hasText: "読み込みに時間がかかっています" });
  await expect(notice).toHaveCount(0);
  await page.clock.fastForward(5_500);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("削除されていません");
  await expect(page.getByRole("button", { name: "再読込" })).toBeVisible();

  await page.getByRole("button", { name: "保存せずに続ける" }).click();
  await expect(page.getByText("1本目の投稿案")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "保存せずに使っています" })).toBeVisible();
  await bodyBox(page).fill("保存せずに入力できる");
  await expect(bodyBox(page)).toHaveValue("保存せずに入力できる");
});

test("a rendering error shows a recoverable message, not a white screen, and deletes nothing", async ({ page }) => {
  await open(page);
  await bodyBox(page).fill("無事な投稿案");
  await page.waitForTimeout(600); // let the debounced write finish

  // A stored draft with a broken shape makes the saved-drafts list throw while rendering.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("lt-share");
        open.onsuccess = () => {
          const tx = open.result.transaction("drafts", "readwrite");
          tx.objectStore("drafts").put({
            id: "d-broken",
            index: 9,
            createdAt: 1,
            updatedAt: 1,
            tags: null,
            body: "壊れたデータ",
            bodySource: "user",
            media: null,
            includeDeveloper: false,
            generation: "idle",
            openedInX: false,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await page.getByRole("button", { name: /保存した投稿案 1/ }).click();

  const crash = page.getByRole("alert").filter({ hasText: "問題が発生しました" });
  await expect(crash).toBeVisible();
  await expect(crash).toContainText("削除されることはありません");
  expect(await storedKeys(page, "drafts")).toContain("d-broken");

  // "もう一度表示" boots again from storage and returns to the composer.
  await page.getByRole("button", { name: "もう一度表示" }).click();
  await expect(page.getByText("1本目の投稿案")).toBeVisible();
  await expect(bodyBox(page)).toHaveValue("無事な投稿案");
  await page.getByRole("button", { name: /保存した投稿案 1/ }).click();
  await expect(crash).toBeVisible();

  // Reloading must not reopen the screen that just crashed.
  await page.getByRole("button", { name: "再読込" }).click();
  await expect(page.getByText("1本目の投稿案")).toBeVisible();
  await expect(bodyBox(page)).toHaveValue("無事な投稿案");
  expect(await storedKeys(page, "drafts")).toContain("d-broken");
});

test("a second tab is read-only, writes nothing, and becomes editable once the first tab is closed", async ({
  context,
}) => {
  const first = await context.newPage();
  await open(first);
  await bodyBox(first).fill("一つ目のタブ");
  await first.waitForTimeout(600); // let the debounced write finish

  const second = await context.newPage();
  await open(second);
  const banner = second.getByRole("alert").filter({ hasText: "別のタブで開いています。このタブでは編集できません。" });
  await expect(banner).toBeVisible();
  await expect(second.locator(".app-body")).toHaveAttribute("inert", "");
  // It still shows what is saved, but offers nothing to change it with.
  await expect(bodyBox(second)).toHaveValue("一つ目のタブ");

  // The first tab is unaffected and keeps saving.
  await bodyBox(first).fill("一つ目のタブ 更新");
  await first.waitForTimeout(600);
  await expect(first.getByRole("alert")).toHaveCount(0);

  await first.close();
  await banner.getByRole("button", { name: "再読込" }).click();
  await expect(banner).toHaveCount(0);
  await expect(bodyBox(second)).toHaveValue("一つ目のタブ 更新");
  await bodyBox(second).fill("二つ目のタブで編集");
  await second.waitForTimeout(600);
  await second.reload();
  await expect(bodyBox(second)).toHaveValue("二つ目のタブで編集");
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

test("persistent storage is requested once; on start only orphaned blobs are cleaned up", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __persistCalls: number };
    w.__persistCalls = 0;
    Object.defineProperty(navigator.storage, "persist", {
      configurable: true,
      value: async () => {
        w.__persistCalls += 1;
        return true;
      },
    });
  });
  await open(page);
  await recordAndConfirm(page);
  await pickPhoto(page, { name: "second.jpg", mimeType: "image/jpeg", buffer: Buffer.from("second-photo-bytes") });
  await expect(notSavedYet(page)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls)).toBe(1);
  await page.waitForTimeout(600); // let the debounced write finish

  const mediaIds = () =>
    page.evaluate(
      () =>
        new Promise<string[]>((resolve, reject) => {
          const open = indexedDB.open("lt-share");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const keys = open.result.transaction("media").objectStore("media").getAllKeys();
            keys.onsuccess = () => resolve(keys.result.map(String));
            keys.onerror = () => reject(keys.error);
          };
        }),
    );
  const [referenced] = await mediaIds();
  expect(await mediaIds()).toHaveLength(1);

  // A blob that no draft references (e.g. an interrupted capture) is left in storage.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("lt-share");
        open.onsuccess = () => {
          const tx = open.result.transaction("media", "readwrite");
          tx.objectStore("media").put({ id: "orphan", blob: new Blob(["orphan"]) });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  expect(await mediaIds()).toHaveLength(2);

  await page.reload();
  await expect.poll(mediaIds).toEqual([referenced]);
  await expect(page.getByRole("img", { name: "記録した写真" })).toBeVisible();
});

test("a storage read error offers a retry instead of telling the user to record again", async ({ page }) => {
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore["get"]>) {
      if (sessionStorage.getItem("failMediaRead") === "1" && this.name === "media") {
        throw new DOMException("read failed", "UnknownError");
      }
      return get.apply(this, args);
    };
  });
  await open(page);
  await recordAndConfirm(page);
  await page.waitForTimeout(600); // let the debounced write finish

  await page.evaluate(() => sessionStorage.setItem("failMediaRead", "1"));
  await page.reload();
  const alert = page.getByRole("alert").filter({ hasText: "を読み込めませんでした" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("保存した写真は消えていません");
  await expect(page.getByText("選び直してください")).toHaveCount(0);
  await expect(alert.getByRole("button", { name: "再読込" })).toBeVisible();

  await page.evaluate(() => sessionStorage.removeItem("failMediaRead"));
  await alert.getByRole("button", { name: "再試行" }).click();
  await expect(page.getByRole("img", { name: "記録した写真" })).toBeVisible();
  await expect(savedLine(page)).toBeVisible();
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

for (const mobile of [
  { name: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", prefix: "twitter://post?message=" },
  { name: "Android", userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36", prefix: "intent://post?message=" },
]) {
  test.describe(`${mobile.name} X app hand-off`, () => {
    test.use({ userAgent: mobile.userAgent });
    test("uses an app link from the tap and leaves explicit alternatives", async ({ page }) => {
      await open(page);
      const text = "AI開発のLT。\n#test & @example";
      await bodyBox(page).fill(text);
      await addTag(page, "#LT");
      const expected = `${text}\n\n#LT`;
      await page.getByRole("button", { name: "ポスト確認", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "ポスト確認" });
      const appLink = sheet.getByRole("link", { name: "Xアプリで開く", exact: true });
      const href = await appLink.getAttribute("href");
      expect(href).toContain(mobile.prefix + encodeURIComponent(expected));
      await expect(appLink).toHaveAttribute("target", "_self");
      await expect(sheet.getByRole("link", { name: "ブラウザ版で開く", exact: true })).toHaveAttribute("href", `https://x.com/intent/post?text=${encodeURIComponent(expected)}`);
      await expect(sheet.getByRole("button", { name: "本文をコピー", exact: true })).toBeVisible();
      await expect(sheet.getByText("Xの投稿画面を開きました", { exact: false })).toHaveCount(0);
      await page.screenshot({ path: `test-results/${mobile.name}-handoff.png`, animations: "disabled" });
      // Suppress only the browser's external-protocol navigation. React's real
      // click handler still runs; no test claims that an OS app was launched.
      await page.evaluate(() => document.addEventListener("click", (event) => {
        const link = (event.target as Element | null)?.closest("a");
        if (link && /^(twitter|intent):/.test(link.href)) event.preventDefault();
      }));
      await appLink.click();
      await expect(sheet.getByText("Xへの移動を開始しました", { exact: false })).toBeVisible();
      await expect(sheet.getByRole("button", { name: "本文をコピー", exact: true })).toBeEnabled();
      await sheet.getByRole("button", { name: "閉じる", exact: true }).click();
      await page.reload();
      await expect(bodyBox(page)).toHaveValue(text);
      await expect(page.locator(".tag-chip")).toHaveText("#LT");
      await page.getByRole("button", { name: "次の投稿へ", exact: true }).click();
      await page.getByRole("button", { name: /保存した投稿案 1/ }).click();
      await expect(page.getByTestId("draft-row")).toContainText("Xを開く操作済み");
    });
  });
}

for (const allowed of [true, false]) {
  test(`copy post text ${allowed ? "succeeds" : "reports denied permission without losing the draft"}`, async ({ page }) => {
    await page.addInitScript((allowed) => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: (text: string) => {
          if (!allowed) return Promise.reject(new DOMException("denied", "NotAllowedError"));
          (window as unknown as { __copied: string }).__copied = text;
          return Promise.resolve();
        },
      }});
    }, allowed);
    await open(page);
    await bodyBox(page).fill("コピーするLTの本文");
    await addTag(page, "#テスト");
    await page.getByRole("button", { name: "ポスト確認", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "ポスト確認" });
    await sheet.getByRole("button", { name: "本文をコピー", exact: true }).click();
    if (allowed) {
      await expect(page.getByText("本文をコピーしました", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe("コピーするLTの本文\n\n#テスト");
    } else {
      await expect(page.getByText("コピーできませんでした。上の本文を長押ししてコピーしてください", { exact: true })).toBeVisible();
      await expect(page.getByText("本文をコピーしました", { exact: true })).toHaveCount(0);
    }
    await sheet.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(bodyBox(page)).toHaveValue("コピーするLTの本文");
    await expect(page.getByText("投稿済み", { exact: true })).toHaveCount(0);
  });
}
