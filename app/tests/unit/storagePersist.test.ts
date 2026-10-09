import { test } from "node:test";
import assert from "node:assert/strict";
import { requestPersistentStorage } from "../../src/lib/storagePersist.ts";

function flagStore(initial?: string) {
  const data = new Map<string, string>(initial ? [["lt-share:persist-requested", initial]] : []);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

test("persistent storage is requested once, then never again", async () => {
  let calls = 0;
  const storage = {
    persist: async () => {
      calls += 1;
      return true;
    },
  };
  const flags = flagStore();

  assert.equal(await requestPersistentStorage(storage, flags), true);
  assert.equal(await requestPersistentStorage(storage, flags), false);
  assert.equal(calls, 1);
});

test("a refusal or a failure is ignored and not retried", async () => {
  const denied = { persist: async () => false };
  assert.equal(await requestPersistentStorage(denied, flagStore()), false);

  let calls = 0;
  const throwing = {
    persist: async () => {
      calls += 1;
      throw new Error("blocked");
    },
  };
  const flags = flagStore();
  assert.equal(await requestPersistentStorage(throwing, flags), false);
  assert.equal(await requestPersistentStorage(throwing, flags), false);
  assert.equal(calls, 1);
});

test("a browser without the Storage API, or without a flag store, does not break", async () => {
  assert.equal(await requestPersistentStorage(undefined, flagStore()), false);
  assert.equal(await requestPersistentStorage({}, flagStore()), false);
  assert.equal(await requestPersistentStorage({ persist: async () => true }, null), true);
  const brokenFlags = {
    getItem() {
      throw new DOMException("denied", "SecurityError");
    },
    setItem() {
      throw new DOMException("denied", "SecurityError");
    },
  };
  assert.equal(await requestPersistentStorage({ persist: async () => true }, brokenFlags), true);
});
