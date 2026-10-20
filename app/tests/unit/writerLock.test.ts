import { test } from "node:test";
import assert from "node:assert/strict";
import { WRITER_LOCK_NAME, acquireWriterLock } from "../../src/lib/writerLock.ts";

type Callback = (lock: unknown | null) => Promise<void> | void;

// A tiny stand-in for navigator.locks that honours { ifAvailable: true }.
function fakeLockManager(options: { denyFirst?: number } = {}) {
  let held = false;
  let denyFirst = options.denyFirst ?? 0;
  const calls: Array<{ name: string; options: unknown }> = [];
  return {
    calls,
    release() {
      held = false;
    },
    request(name: string, opts: { ifAvailable: true }, callback: Callback) {
      calls.push({ name, options: opts });
      if (held || denyFirst > 0) {
        if (denyFirst > 0) denyFirst -= 1;
        return Promise.resolve(callback(null));
      }
      held = true;
      return Promise.resolve(callback({ name })); // stays pending: the lock is held
    },
  };
}

const instantly = async () => {};

test("the first tab takes the writer lock and holds it", async () => {
  const locks = fakeLockManager();

  assert.equal(await acquireWriterLock({ locks, wait: instantly }), "acquired");
  assert.equal(locks.calls[0]?.name, WRITER_LOCK_NAME);
  assert.deepEqual(locks.calls[0]?.options, { ifAvailable: true });
});

test("a second tab is denied while the first holds the lock, and gets it once it is released", async () => {
  const locks = fakeLockManager();
  assert.equal(await acquireWriterLock({ locks, wait: instantly }), "acquired");

  assert.equal(await acquireWriterLock({ locks, wait: instantly }), "denied");

  locks.release(); // the first tab was closed
  assert.equal(await acquireWriterLock({ locks, wait: instantly }), "acquired");
});

test("one short retry absorbs the overlap between a reloading page and its predecessor", async () => {
  const locks = fakeLockManager({ denyFirst: 1 });
  const waits: number[] = [];

  const result = await acquireWriterLock({
    locks,
    wait: async (ms) => {
      waits.push(ms);
    },
  });

  assert.equal(result, "acquired");
  assert.equal(locks.calls.length, 2);
  assert.deepEqual(waits, [300]);
});

test("without Web Locks the app keeps its current behaviour (no guard)", async () => {
  assert.equal(await acquireWriterLock({ locks: undefined, wait: instantly }), "unsupported");

  const throwing = {
    request() {
      throw new Error("SecurityError");
    },
  };
  assert.equal(await acquireWriterLock({ locks: throwing, wait: instantly }), "unsupported");

  const rejecting = { request: () => Promise.reject(new Error("blocked")) };
  assert.equal(await acquireWriterLock({ locks: rejecting, wait: instantly }), "unsupported");
});
