import { test } from "node:test";
import assert from "node:assert/strict";
import { hasSeenWelcome, markWelcomeSeen } from "../../src/lib/welcome.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

test("the first-run notice is shown until it has been dismissed once", () => {
  const storage = memoryStorage();
  assert.equal(hasSeenWelcome(storage), false);

  markWelcomeSeen(storage);
  assert.equal(hasSeenWelcome(storage), true);
  assert.equal(storage.data.size, 1);
});

test("unavailable localStorage never breaks the app (the notice simply shows again)", () => {
  const blocked = {
    getItem() {
      throw new DOMException("denied", "SecurityError");
    },
    setItem() {
      throw new DOMException("denied", "SecurityError");
    },
  };

  assert.equal(hasSeenWelcome(blocked), false);
  assert.doesNotThrow(() => markWelcomeSeen(blocked));
  assert.equal(hasSeenWelcome(null), false);
  assert.doesNotThrow(() => markWelcomeSeen(null));
});
