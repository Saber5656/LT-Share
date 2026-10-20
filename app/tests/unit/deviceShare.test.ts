import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSharePostWithMedia,
  mediaToFile,
  saveToDevice,
  sharePostWithMedia,
  type ShareEnv,
} from "../../src/lib/deviceShare.ts";

type Recorder = {
  env: ShareEnv;
  canShareCalls: ShareData[];
  shareCalls: ShareData[];
  downloads: Array<{ blob: Blob; filename: string }>;
};

function setup(options: {
  canShare?: boolean | "missing";
  share?: "ok" | "missing" | Error;
}): Recorder {
  const rec: Recorder = {
    env: undefined as unknown as ShareEnv,
    canShareCalls: [],
    shareCalls: [],
    downloads: [],
  };
  const nav: ShareEnv["navigator"] = {};
  const canShare = options.canShare ?? true;
  if (canShare !== "missing") {
    nav.canShare = (data) => {
      rec.canShareCalls.push(data);
      return canShare;
    };
  }
  if (options.share !== "missing") {
    nav.share = async (data) => {
      rec.shareCalls.push(data);
      if (options.share instanceof Error) throw options.share;
    };
  }
  rec.env = {
    navigator: nav,
    triggerDownload: (blob, filename) => {
      rec.downloads.push({ blob, filename });
    },
  };
  return rec;
}

const photo = new File(["jpeg-bytes"], "lt.jpg", { type: "image/jpeg" });

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

test("saveToDevice opens the share sheet when files can be shared", async () => {
  const rec = setup({ canShare: true });

  assert.equal(await saveToDevice(photo, {}, rec.env), "shared");
  assert.deepEqual(rec.canShareCalls, [{ files: [photo] }]);
  assert.deepEqual(rec.shareCalls, [{ files: [photo] }]);
  assert.equal(rec.downloads.length, 0);
});

test("the share sheet is requested synchronously, inside the caller's click handler (iOS user activation)", async () => {
  const rec = setup({ canShare: true });
  const saving = saveToDevice(photo, {}, rec.env);
  assert.equal(rec.shareCalls.length, 1, "navigator.share must be called before any await");
  await saving;

  const sharing = sharePostWithMedia(photo, "本文", rec.env);
  assert.equal(rec.shareCalls.length, 2, "navigator.share must be called before any await");
  await sharing;
});

test("saveToDevice downloads when file sharing is unavailable", async () => {
  for (const options of [
    { canShare: false as const },
    { canShare: "missing" as const },
    { canShare: true as const, share: "missing" as const },
  ]) {
    const rec = setup(options);
    assert.equal(await saveToDevice(photo, {}, rec.env), "downloaded");
    assert.equal(rec.shareCalls.length, 0);
    assert.equal(rec.downloads.length, 1);
    assert.equal(rec.downloads[0]?.filename, "lt.jpg");
    assert.equal(rec.downloads[0]?.blob, photo);
  }
});

test("saveToDevice treats AbortError as a cancel without falling back to a download", async () => {
  const rec = setup({ canShare: true, share: domError("AbortError") });

  assert.equal(await saveToDevice(photo, {}, rec.env), "cancelled");
  assert.equal(rec.downloads.length, 0);
});

test("saveToDevice surfaces other errors so the UI can show a failure and retry", async () => {
  const rec = setup({ canShare: true, share: domError("NotAllowedError") });

  await assert.rejects(saveToDevice(photo, {}, rec.env), { name: "NotAllowedError" });
  assert.equal(rec.downloads.length, 0);
});

test("saveToDevice can be forced to download (fallback path after a failure)", async () => {
  const rec = setup({ canShare: true });

  assert.equal(await saveToDevice(photo, { mode: "download" }, rec.env), "downloaded");
  assert.equal(rec.shareCalls.length, 0);
  assert.equal(rec.downloads.length, 1);
});

test("saveToDevice surfaces download errors", async () => {
  const rec = setup({ canShare: false });
  rec.env.triggerDownload = () => {
    throw new Error("download blocked");
  };

  await assert.rejects(saveToDevice(photo, {}, rec.env), /download blocked/);
});

test("canSharePostWithMedia asks the browser about files and text together", () => {
  const rec = setup({ canShare: true });
  assert.equal(canSharePostWithMedia(photo, "本文", rec.env), true);
  assert.deepEqual(rec.canShareCalls, [{ files: [photo], text: "本文" }]);

  assert.equal(canSharePostWithMedia(photo, "本文", setup({ canShare: false }).env), false);
  assert.equal(canSharePostWithMedia(photo, "本文", setup({ canShare: "missing" }).env), false);
  assert.equal(canSharePostWithMedia(photo, "本文", setup({ canShare: true, share: "missing" }).env), false);
});

test("sharePostWithMedia shares the file and the text, and reports a cancel", async () => {
  const rec = setup({ canShare: true });
  assert.equal(await sharePostWithMedia(photo, "本文 #Rust", rec.env), "shared");
  assert.deepEqual(rec.shareCalls, [{ files: [photo], text: "本文 #Rust" }]);

  const cancelled = setup({ canShare: true, share: domError("AbortError") });
  assert.equal(await sharePostWithMedia(photo, "本文", cancelled.env), "cancelled");

  const failing = setup({ canShare: true, share: domError("DataError") });
  await assert.rejects(sharePostWithMedia(photo, "本文", failing.env), { name: "DataError" });
});

test("mediaToFile rebuilds a shareable File from the stored Blob", async () => {
  const file = mediaToFile(new Blob(["abc"], { type: "image/jpeg" }), {
    kind: "photo",
    mime: "image/jpeg",
    name: "lt.jpg",
  });
  assert.equal(file.name, "lt.jpg");
  assert.equal(file.type, "image/jpeg");
  assert.equal(await file.text(), "abc");
});

test("mediaToFile gives nameless captures a sensible file name", () => {
  const photoFile = mediaToFile(new Blob(["a"]), { kind: "photo", mime: "image/heic", name: "" });
  assert.equal(photoFile.name, "lt-photo.heic");
  assert.equal(photoFile.type, "image/heic");

  const video = mediaToFile(new Blob(["a"]), { kind: "video", mime: "video/quicktime", name: "" });
  assert.equal(video.name, "lt-video.mov");

  const noExt = mediaToFile(new Blob(["a"]), { kind: "video", mime: "video/mp4", name: "capture" });
  assert.equal(noExt.name, "capture.mp4");

  const unknown = mediaToFile(new Blob(["a"]), { kind: "photo", mime: "", name: "" });
  assert.equal(unknown.name, "lt-photo.jpg");
  assert.equal(unknown.type, "image/jpeg");
});
