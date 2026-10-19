import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PHOTO = "tests/fixtures/lt-photo.jpg";
type Call = { text: string; name: string; type: string; hash: string; activation: boolean; sameTask: boolean };
type Mode = "ok" | "abort" | "fail" | "hang" | "unsupported";
const body = "写真から感想をつくれる「LT Share」。LTを聞きながら共有するのに便利そう！";
const expected = `${body}\n\n開発者：\n\n#aimeetup`;
const sheet = (page: Page) => page.getByRole("dialog", { name: "ポスト確認" });
const primary = (page: Page) => sheet(page).getByRole("button", { name: "写真と本文をXへ", exact: true });
const calls = (page: Page) => page.evaluate(() => (window as unknown as { handoffCalls: Call[] }).handoffCalls);
const persistedBodies = (page: Page) => page.evaluate(() => new Promise<string[]>((resolve) => {
  const request = indexedDB.open("lt-share");
  request.onsuccess = () => {
    const read = request.result.transaction("drafts").objectStore("drafts").getAll();
    read.onsuccess = () => { request.result.close(); resolve(read.result.map(d => d.body)); };
  };
}));

async function start(page: Page, mode: Mode = "ok") {
  await page.addInitScript((mode) => {
    localStorage.setItem("lt-share:welcome-seen", "1");
    const state = window as unknown as { handoffCalls: unknown[] };
    state.handoffCalls = [];
    let sameTask = false;
    document.addEventListener("click", () => {
      sameTask = true;
      setTimeout(() => { sameTask = false; }, 0);
    }, true);
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => mode !== "unsupported" });
    Object.defineProperty(navigator, "share", { configurable: true, value: (data: ShareData) => {
      const file = data.files![0]!;
      const call = { text: data.text, name: file.name, type: file.type, hash: "", activation: navigator.userActivation.isActive, sameTask };
      state.handoffCalls.push(call);
      void file.arrayBuffer().then(async bytes => {
        call.hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
      });
      if (mode === "hang") return new Promise<void>(() => {});
      if (mode === "abort") return Promise.reject(new DOMException("cancel", "AbortError"));
      if (mode === "fail") return Promise.reject(new DOMException("failed", "NotAllowedError"));
      return Promise.resolve();
    } });
  }, mode);
  await page.route("**/api/ai/status", route => route.fulfill({ json: { available: false } }));
  await page.goto("/");
  await page.getByTestId("pick-library").setInputFiles(PHOTO);
  await expect(page.getByRole("img", { name: "記録した写真" })).toBeVisible();
  await page.getByRole("textbox", { name: "投稿文", exact: true }).fill(body);
  await page.getByLabel("ハッシュタグを追加").fill("aimeetup");
  await page.getByLabel("ハッシュタグを追加").press("Enter");
  await page.getByRole("switch", { name: "開発者をポストに含める" }).click();
  await page.getByRole("button", { name: "ポスト確認", exact: true }).click();
}

test("primary handoff carries original photo bytes and final text in the tap task", async ({ page }) => {
  await start(page);
  await page.screenshot({ path: process.env.LT_PHOTO_SCREENSHOT ?? "test-results/photo-handoff.png", animations: "disabled" });
  await expect(primary(page)).toHaveClass(/primary-button/);
  await expect(sheet(page).getByText("次の共有画面でXを選んでください。", { exact: true })).toBeVisible();
  await primary(page).click();
  const hash = createHash("sha256").update(readFileSync(PHOTO)).digest("hex");
  await expect.poll(async () => (await calls(page))[0]?.hash).toBe(hash);
  expect(await calls(page)).toEqual([{ text: expected, name: "lt-photo.jpg", type: "image/jpeg", hash, activation: true, sameTask: true }]);
  await expect(page).toHaveURL(/127\.0\.0\.1/);
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByText(/投稿済み|添付完了/)).toHaveCount(0);
});

for (const mode of ["abort", "fail"] as const) {
  test(`${mode}: keep photo and text, offer retry without text-only navigation`, async ({ page }) => {
    await start(page, mode);
    await primary(page).click();
    await expect(sheet(page).getByRole("status")).toContainText(mode === "abort" ? "キャンセル" : "共有できませんでした");
    await expect(primary(page)).toBeEnabled();
    await expect(sheet(page).getByLabel("Xに渡す本文")).toHaveText(expected);
    await primary(page).click();
    expect(await calls(page)).toHaveLength(2);
    await expect(page).toHaveURL(/127\.0\.0\.1/);
    await sheet(page).getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(page.getByRole("img", { name: "記録した写真" })).toBeVisible();
  });
}

test("unsupported sharing never presents a text-only link as the primary action", async ({ page }) => {
  await start(page, "unsupported");
  await expect(primary(page)).toBeDisabled();
  await expect(sheet(page).getByText(/このブラウザでは写真と本文をまとめて共有できません/)).toBeVisible();
  await expect(sheet(page).locator("a.primary-button")).toHaveCount(0);
  const fallback = sheet(page).getByRole("link", { name: "本文だけでXを開く", exact: true });
  await expect(fallback).toHaveAttribute("href", `https://x.com/intent/post?text=${encodeURIComponent(expected)}`);
  expect(await calls(page)).toHaveLength(0);
});

test("pending share is single-flight and an unsettled share becomes retryable", async ({ page }) => {
  await start(page, "hang");
  await page.clock.install();
  await primary(page).click();
  await expect(sheet(page).getByRole("button", { name: "共有画面を開いています…" })).toBeDisabled();
  // Reopening the sheet must not enable a second call while the OS owns the first.
  await sheet(page).getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.getByRole("button", { name: "端末に保存", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "ポスト確認", exact: true }).click();
  await expect(sheet(page).getByRole("button", { name: "共有画面を開いています…" })).toBeDisabled();
  expect(await calls(page)).toHaveLength(1);
  await page.clock.fastForward(60_001);
  await expect(primary(page)).toBeEnabled();
  await expect(sheet(page).getByRole("status")).toContainText("共有結果を確認できませんでした");
});

test("missing original blocks photo handoff and offers reselect", async ({ page }) => {
  await start(page);
  await expect.poll(() => persistedBodies(page)).toContain(body);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("lt-share");
      request.onsuccess = () => {
        const tx = request.result.transaction("media", "readwrite");
        tx.objectStore("media").clear();
        tx.oncomplete = () => { request.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "ポスト確認", exact: true }).click();
  await expect(primary(page)).toBeDisabled();
  await expect(sheet(page).getByText(/写真を読み込めません/)).toBeVisible();
  await sheet(page).getByRole("button", { name: "写真を選び直すために戻る" }).click();
  await expect(sheet(page)).not.toBeVisible();
  expect(await calls(page)).toHaveLength(0);
});

test("slow storage keeps media primary disabled until the original File is ready", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess")!;
    Object.defineProperty(IDBRequest.prototype, "onsuccess", {
      configurable: true, get: original.get,
      set(this: IDBRequest, handler: ((ev: Event) => void) | null) {
        const source = this.source as { name?: string } | null;
        const slow = sessionStorage.getItem("slowPhotoRead") === "1" && source?.name === "media";
        original.set!.call(this, slow && handler ? (event: Event) => {
          setTimeout(() => handler.call(this, event), 1500);
        } : handler);
      },
    });
  });
  await start(page);
  await expect.poll(() => persistedBodies(page)).toContain(body);
  await page.evaluate(() => sessionStorage.setItem("slowPhotoRead", "1"));
  await page.reload();
  await page.getByRole("button", { name: "ポスト確認", exact: true }).click();
  await expect(primary(page)).toBeDisabled();
  await expect(sheet(page).getByText("写真を準備しています…", { exact: true })).toBeVisible();
  await expect(sheet(page).locator("a.primary-button")).toHaveCount(0);
  await expect(primary(page)).toBeEnabled();
  await primary(page).click();
  expect((await calls(page))[0]).toMatchObject({ text: expected, activation: true, sameTask: true });
});
