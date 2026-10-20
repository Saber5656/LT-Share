import { test } from "node:test";
import assert from "node:assert/strict";
import { STUCK, settleOrEscape, type EscapeEnv } from "../../src/lib/settle.ts";
import { startDeviceSave } from "../../src/lib/saveFlow.ts";
import type { ShareEnv } from "../../src/lib/deviceShare.ts";

/* ---------- a controllable clock / visibility for settleOrEscape ---------- */

function fakeEscapeEnv() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const listeners = new Set<() => void>();
  const env: EscapeEnv = {
    timeoutMs: 60_000,
    visibleGraceMs: 1_500,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id as number);
    },
    onVisible(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    env,
    listeners,
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    becomeVisible() {
      for (const listener of [...listeners]) listener();
    },
  };
}

const never = () => new Promise<never>(() => {});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("settleOrEscape passes through a result that arrives in time and cleans up", async () => {
  const clock = fakeEscapeEnv();
  const result = settleOrEscape(Promise.resolve("shared"), clock.env);

  assert.equal(await result, "shared");
  assert.equal(clock.listeners.size, 0);
  assert.equal(clock.timers.size, 0);
});

test("settleOrEscape passes through a rejection", async () => {
  const clock = fakeEscapeEnv();
  await assert.rejects(settleOrEscape(Promise.reject(new Error("denied")), clock.env), /denied/);
  assert.equal(clock.listeners.size, 0);
});

test("settleOrEscape gives up on a call that never settles after the timeout", async () => {
  const clock = fakeEscapeEnv();
  const result = settleOrEscape(never(), clock.env);

  clock.advance(59_999);
  await tick();
  clock.advance(1);
  assert.equal(await result, STUCK);
  assert.equal(clock.listeners.size, 0);
});

test("settleOrEscape gives up a short grace period after the page becomes visible again", async () => {
  const clock = fakeEscapeEnv();
  const result = settleOrEscape(never(), clock.env);

  clock.becomeVisible();
  clock.advance(1_499);
  await tick();
  clock.advance(1);
  assert.equal(await result, STUCK);
});

test("a call that settles during the grace period still wins over the escape", async () => {
  const clock = fakeEscapeEnv();
  let finish!: (value: string) => void;
  const result = settleOrEscape(new Promise<string>((resolve) => (finish = resolve)), clock.env);

  clock.becomeVisible();
  clock.advance(1_000);
  finish("cancelled");
  assert.equal(await result, "cancelled");
  clock.advance(10_000); // the pending escape timers are gone
  assert.equal(clock.timers.size, 0);
});

/* ---------- startDeviceSave: the part that must run inside the click handler ---------- */

function recordingEnv(share: (data: ShareData) => Promise<void>) {
  const calls: ShareData[] = [];
  const downloads: string[] = [];
  const env: ShareEnv = {
    navigator: {
      canShare: () => true,
      share: (data) => {
        calls.push(data);
        return share(data);
      },
    },
    triggerDownload: (_blob, filename) => void downloads.push(filename),
  };
  return { env, calls, downloads };
}

const media = { kind: "photo", mime: "image/jpeg", name: "lt.jpg" } as const;
const blob = new Blob(["jpeg"], { type: "image/jpeg" });

test("startDeviceSave opens the share sheet synchronously, before it returns (iOS user activation)", () => {
  const rec = recordingEnv(async () => {});
  const started = startDeviceSave({ blob, media, mode: "auto", shareEnv: rec.env, escapeEnv: fakeEscapeEnv().env });

  // Nothing has been awaited yet: navigator.share must already have been called.
  assert.equal(rec.calls.length, 1);
  assert.equal(started.status, "started");
});

test("startDeviceSave refuses to start without the blob instead of loading it asynchronously", () => {
  const rec = recordingEnv(async () => {});
  const started = startDeviceSave({
    blob: undefined,
    media,
    mode: "auto",
    shareEnv: rec.env,
    escapeEnv: fakeEscapeEnv().env,
  });

  assert.deepEqual(started, { status: "not-ready" });
  assert.equal(rec.calls.length, 0);
  assert.equal(rec.downloads.length, 0);
});

test("startDeviceSave reports hand-off, cancel, and stuck outcomes, and rethrows real errors", async () => {
  const shared = startDeviceSave({
    blob,
    media,
    mode: "auto",
    shareEnv: recordingEnv(async () => {}).env,
    escapeEnv: fakeEscapeEnv().env,
  });
  assert.equal(shared.status === "started" && (await shared.outcome), "handed-off");

  const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
  const cancelled = startDeviceSave({
    blob,
    media,
    mode: "auto",
    shareEnv: recordingEnv(() => Promise.reject(abort)).env,
    escapeEnv: fakeEscapeEnv().env,
  });
  assert.equal(cancelled.status === "started" && (await cancelled.outcome), "cancelled");

  const clock = fakeEscapeEnv();
  const hung = startDeviceSave({
    blob,
    media,
    mode: "auto",
    shareEnv: recordingEnv(never).env,
    escapeEnv: clock.env,
  });
  clock.becomeVisible();
  clock.advance(1_500);
  // The page came back and the share promise never settled: ask the user instead of staying busy.
  assert.equal(hung.status === "started" && (await hung.outcome), "stuck");

  const failing = startDeviceSave({
    blob,
    media,
    mode: "auto",
    shareEnv: recordingEnv(() => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" }))).env,
    escapeEnv: fakeEscapeEnv().env,
  });
  assert.ok(failing.status === "started");
  await assert.rejects(failing.outcome, { name: "NotAllowedError" });
});

test("a download counts as a hand-off too, and can be forced", async () => {
  const rec = recordingEnv(async () => {});
  const started = startDeviceSave({ blob, media, mode: "download", shareEnv: rec.env, escapeEnv: fakeEscapeEnv().env });

  assert.equal(started.status === "started" && (await started.outcome), "handed-off");
  assert.deepEqual(rec.downloads, ["lt.jpg"]);
  assert.equal(rec.calls.length, 0);
});
