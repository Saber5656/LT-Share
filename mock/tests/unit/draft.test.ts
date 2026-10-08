import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addTags,
  composePost,
  createDraft,
  draftReducer,
  parseTags,
  xWeightedLength,
  type DraftState,
} from "../../src/lib/draft.ts";

test("parseTags normalizes '#', full-width '＃', separators and empties", () => {
  assert.deepEqual(parseTags("#TechLTNight"), ["#TechLTNight"]);
  assert.deepEqual(parseTags("Rust"), ["#Rust"]);
  assert.deepEqual(parseTags("＃LT  #Rust,#AI、##ML"), ["#LT", "#Rust", "#AI", "#ML"]);
  assert.deepEqual(parseTags("#"), []);
  assert.deepEqual(parseTags("   "), []);
});

test("addTags appends new tags and skips case-insensitive duplicates", () => {
  assert.deepEqual(addTags(["#TechLTNight"], "#rust #techltnight"), ["#TechLTNight", "#rust"]);
});

test("composePost appends tags and the developer label only when enabled", () => {
  const body = "RustでCLIを作るLT。";
  assert.equal(
    composePost({ body, tags: ["#TechLTNight", "#Rust"], includeDeveloper: false }),
    "RustでCLIを作るLT。\n\n#TechLTNight #Rust",
  );
  assert.equal(
    composePost({ body, tags: ["#TechLTNight"], includeDeveloper: true }),
    "RustでCLIを作るLT。\n\n#TechLTNight\n\n開発者：",
  );
  assert.equal(composePost({ body: "", tags: ["#A"], includeDeveloper: false }), "#A");
});

test("xWeightedLength counts Latin as 1 and Japanese as 2", () => {
  assert.equal(xWeightedLength("abc"), 3);
  assert.equal(xWeightedLength("あいう"), 6);
  assert.equal(xWeightedLength("LT。"), 4);
  assert.equal(xWeightedLength("#Rust\n\n開発者："), 15);
});

function stateWithDraft(): DraftState {
  const current = {
    ...createDraft({ id: "d3", index: 3, tags: ["#TechLTNight"] }),
    body: "本文",
    media: { kind: "photo" as const, src: "/a.jpg", saveStatus: "saved" as const },
    includeDeveloper: true,
  };
  return { current, history: [], nextId: 4 };
}

test("nextDraft saves the current draft and carries only the tags over", () => {
  const next = draftReducer(stateWithDraft(), { type: "nextDraft" });

  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].body, "本文");
  assert.deepEqual(next.history[0].tags, ["#TechLTNight"]);
  assert.equal(next.current.index, 4);
  assert.deepEqual(next.current.tags, ["#TechLTNight"]);
  assert.equal(next.current.body, "");
  assert.equal(next.current.media, null);
  assert.equal(next.current.includeDeveloper, false);
});

test("changing tags after nextDraft does not rewrite saved drafts", () => {
  let state = draftReducer(stateWithDraft(), { type: "nextDraft" });
  state = draftReducer(state, { type: "addTags", input: "#Rust" });

  assert.deepEqual(state.current.tags, ["#TechLTNight", "#Rust"]);
  assert.deepEqual(state.history[0].tags, ["#TechLTNight"]);
});

test("a late AI result lands on its own draft, not the new one", () => {
  let state = stateWithDraft();
  state = draftReducer(state, { type: "generateStart", draftId: "d3" });
  state = draftReducer(state, { type: "nextDraft" });
  state = draftReducer(state, { type: "generateDone", draftId: "d3", text: "生成結果" });

  assert.equal(state.history[0].body, "生成結果");
  assert.equal(state.history[0].generation, "done");
  assert.equal(state.current.body, "");
});

test("nextDraft is refused for an empty draft", () => {
  const empty: DraftState = {
    current: createDraft({ id: "d4", index: 4, tags: ["#TechLTNight"] }),
    history: [],
    nextId: 5,
  };

  assert.equal(draftReducer(empty, { type: "nextDraft" }), empty);
});

test("nextDraft is refused while the media is still saving", () => {
  const saving = stateWithDraft();
  saving.current = {
    ...saving.current,
    media: { kind: "photo", src: "/a.jpg", saveStatus: "saving" },
  };

  assert.equal(draftReducer(saving, { type: "nextDraft" }), saving);
});

test("mediaSaveResult marks the current media saved or failed", () => {
  const saving = stateWithDraft();
  saving.current = { ...saving.current, media: { kind: "photo", src: "/a.jpg", saveStatus: "saving" } };

  assert.equal(draftReducer(saving, { type: "mediaSaveResult", ok: true }).current.media?.saveStatus, "saved");
  assert.equal(draftReducer(saving, { type: "mediaSaveResult", ok: false }).current.media?.saveStatus, "failed");
});

test("a new recording resets the generation state but keeps the body", () => {
  const generated = stateWithDraft();
  generated.current = { ...generated.current, generation: "done" };
  const state = draftReducer(generated, {
    type: "mediaCaptured",
    media: { kind: "video", src: "/b.jpg", saveStatus: "saving", durationSec: 8 },
  });

  assert.equal(state.current.generation, "idle");
  assert.equal(state.current.body, "本文");
  assert.equal(state.current.media?.durationSec, 8);
});

test("generated text replaces AI text but never a body the user edited", () => {
  let state = draftReducer(stateWithDraft(), { type: "generateDone", draftId: "d3", text: "生成A" });
  assert.equal(state.current.body, "生成A");
  assert.equal(state.current.bodySource, "ai");

  state = draftReducer(state, { type: "setBody", body: "手で直した本文" });
  assert.equal(state.current.bodySource, "user");

  state = draftReducer(state, { type: "generateDone", draftId: "d3", text: "生成B" });
  assert.equal(state.current.body, "手で直した本文");
  assert.equal(state.current.bodySource, "user");
});

test("generateFailed and openedInX update a draft that is already saved", () => {
  let state = draftReducer(stateWithDraft(), { type: "generateStart", draftId: "d3" });
  state = draftReducer(state, { type: "nextDraft" });
  state = draftReducer(state, { type: "generateFailed", draftId: "d3", reason: "quota" });
  state = draftReducer(state, { type: "openedInX", draftId: "d3" });

  assert.equal(state.history[0].generation, "quota");
  assert.equal(state.history[0].openedInX, true);
  assert.equal(state.current.generation, "idle");
  assert.equal(state.current.openedInX, false);
});

test("nextDraft is refused while the media save has failed", () => {
  const failed = stateWithDraft();
  failed.current = {
    ...failed.current,
    media: { kind: "photo", src: "/a.jpg", saveStatus: "failed" },
  };

  const next = draftReducer(failed, { type: "nextDraft" });

  assert.equal(next, failed);
});
