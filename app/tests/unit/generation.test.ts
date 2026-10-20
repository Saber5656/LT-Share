import { test } from "node:test";
import assert from "node:assert/strict";
import { AiQuotaError, getAiProvider, type AiProvider } from "../../src/lib/ai.ts";
import { runGeneration } from "../../src/lib/generation.ts";
import type { DraftAction } from "../../src/lib/draft.ts";

test("Web inference uses the same-origin HTTP provider", () => {
  assert.equal(typeof getAiProvider().generate, "function");
});

function run(provider: AiProvider) {
  const actions: DraftAction[] = [];
  const image = new Blob(["img"], { type: "image/jpeg" });
  const done = runGeneration({
    provider,
    draftId: "d1",
    image,
    tags: ["#Rust"],
    dispatch: (action) => actions.push(action),
  });
  return { actions, image, done };
}

test("runGeneration reports start and the trimmed result for its own draft", async () => {
  let received: Parameters<AiProvider["generate"]>[0] | undefined;
  const { actions, image, done } = run({
    async generate(input) {
      received = input;
      return "  RustでCLIを作るLT。  ";
    },
  });
  await done;

  assert.deepEqual(actions, [
    { type: "generateStart", draftId: "d1" },
    { type: "generateDone", draftId: "d1", text: "RustでCLIを作るLT。" },
  ]);
  assert.equal(received?.image, image);
  assert.deepEqual(received?.tags, ["#Rust"]);
});

test("runGeneration maps a usage limit to quota and other errors to failed", async () => {
  const quota = run({
    async generate() {
      throw new AiQuotaError("limit");
    },
  });
  await quota.done;
  assert.deepEqual(quota.actions.at(-1), { type: "generateFailed", draftId: "d1", reason: "quota" });

  const failed = run({
    async generate() {
      throw new Error("network");
    },
  });
  await failed.done;
  assert.deepEqual(failed.actions.at(-1), { type: "generateFailed", draftId: "d1", reason: "failed" });
});

test("runGeneration treats an empty result as a failure instead of an empty post", async () => {
  const empty = run({
    async generate() {
      return "   ";
    },
  });
  await empty.done;
  assert.deepEqual(empty.actions.at(-1), { type: "generateFailed", draftId: "d1", reason: "failed" });
});
