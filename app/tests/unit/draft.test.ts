import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addTags,
  canMoveToNextDraft,
  composePost,
  createDraft,
  createDraftId,
  draftReducer,
  nextDraftBlocker,
  parseTags,
  xWeightedLength,
  type Draft,
  type DraftState,
  type Media,
  type SaveStatus,
} from "../../src/lib/draft.ts";

function media(saveStatus: SaveStatus = "saved", overrides: Partial<Media> = {}): Media {
  return { id: "m1", kind: "photo", mime: "image/jpeg", name: "lt.jpg", size: 1024, saveStatus, ...overrides };
}

function stateWithDraft(overrides: Partial<Draft> = {}): DraftState {
  const current: Draft = {
    ...createDraft({ id: "d3", index: 3, tags: ["#TechLTNight"], now: 1000 }),
    body: "本文",
    media: media("saved"),
    includeDeveloper: true,
    ...overrides,
  };
  return { current, history: [], nextId: 4 };
}

/* ---------- tags ---------- */

test("parseTags normalizes '#', full-width '＃', separators and empties", () => {
  assert.deepEqual(parseTags("#TechLTNight"), ["#TechLTNight"]);
  assert.deepEqual(parseTags("Rust"), ["#Rust"]);
  assert.deepEqual(parseTags("＃LT  #Rust,#AI、##ML"), ["#LT", "#Rust", "#AI", "#ML"]);
  assert.deepEqual(parseTags("#"), []);
  assert.deepEqual(parseTags("   "), []);
});

test("addTags appends new tags and skips case-insensitive duplicates", () => {
  assert.deepEqual(addTags(["#TechLTNight"], "#rust #techltnight"), ["#TechLTNight", "#rust"]);
  assert.deepEqual(addTags([], "#Rust #RUST ＃rust"), ["#Rust"]);
});

/* ---------- composing the post ---------- */

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

test("xWeightedLength counts every URL as 23, like X does", () => {
  assert.equal(xWeightedLength("https://example.com/a/very/long/path?with=query&and=more#fragment"), 23);
  assert.equal(xWeightedLength("見て https://example.com/x"), 5 + 23);
});

test("xWeightedLength ends a URL at the first non-ASCII character", () => {
  // Japanese text glued to a URL is counted normally (2 per character), not swallowed by the URL.
  assert.equal(xWeightedLength("https://example.com/とても長い"), 23 + 5 * 2);
  assert.equal(xWeightedLength("詳細はhttps://example.com/a。続き"), 3 * 2 + 23 + 1 * 2 + 2 * 2);
  assert.equal(xWeightedLength("https://example.com　全角スペース"), 23 + 2 + 6 * 2);
  // Plain "http" without "://" and a scheme with nothing after it are not URLs.
  assert.equal(xWeightedLength("https://"), 8);
  assert.equal(xWeightedLength("http only"), 9);
});

/* ---------- next draft ---------- */

test("nextDraft saves the current draft and carries only the tags over", () => {
  const next = draftReducer(stateWithDraft(), { type: "nextDraft", now: 2000 });

  assert.equal(next.history.length, 1);
  assert.equal(next.history[0]?.body, "本文");
  assert.deepEqual(next.history[0]?.tags, ["#TechLTNight"]);
  assert.equal(next.history[0]?.media?.id, "m1");
  assert.equal(next.current.id, "d4");
  assert.equal(next.current.index, 4);
  assert.equal(next.current.createdAt, 2000);
  assert.deepEqual(next.current.tags, ["#TechLTNight"]);
  assert.equal(next.current.body, "");
  assert.equal(next.current.media, null);
  assert.equal(next.current.includeDeveloper, false);
  assert.equal(next.nextId, 5);
});

test("nextDraft uses the id it is given, so two tabs can never mint the same draft id", () => {
  const next = draftReducer(stateWithDraft(), { type: "nextDraft", id: "d-fixed", now: 2000 });
  assert.equal(next.current.id, "d-fixed");
  assert.equal(next.history[0]?.id, "d3");

  // Without an id the counter-based id is kept (existing "d1"-style ids keep working).
  assert.equal(draftReducer(stateWithDraft(), { type: "nextDraft" }).current.id, "d4");
});

test("createDraftId makes unique ids that the counter-based restore logic ignores", () => {
  const ids = new Set(Array.from({ length: 200 }, () => createDraftId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^d-[0-9a-z-]{8,}$/i);
});

test("changing tags after nextDraft does not rewrite saved drafts", () => {
  let state = draftReducer(stateWithDraft(), { type: "nextDraft" });
  state = draftReducer(state, { type: "addTags", input: "#Rust" });

  assert.deepEqual(state.current.tags, ["#TechLTNight", "#Rust"]);
  assert.deepEqual(state.history[0]?.tags, ["#TechLTNight"]);
});

test("nextDraft is refused for an empty draft", () => {
  const empty: DraftState = {
    current: createDraft({ id: "d4", index: 4, tags: ["#TechLTNight"] }),
    history: [],
    nextId: 5,
  };

  assert.equal(draftReducer(empty, { type: "nextDraft" }), empty);
  assert.equal(nextDraftBlocker(empty.current), "empty");
});

test("nextDraft is refused until the media is confirmed as saved on the device", () => {
  for (const [status, blocker] of [
    ["unsaved", "media-unsaved"],
    ["confirming", "media-confirming"],
    ["failed", "media-failed"],
  ] as const) {
    const state = stateWithDraft({ media: media(status) });
    assert.equal(draftReducer(state, { type: "nextDraft" }), state, status);
    assert.equal(nextDraftBlocker(state.current), blocker, status);
    assert.equal(canMoveToNextDraft(state.current), false, status);
  }
  assert.equal(nextDraftBlocker(stateWithDraft().current), null);
});

test("a text-only draft can move on, and so can media-only", () => {
  assert.equal(canMoveToNextDraft(stateWithDraft({ media: null }).current), true);
  assert.equal(canMoveToNextDraft(stateWithDraft({ body: "" }).current), true);
});

/* ---------- media and device save confirmation (FR-02, FR-03) ---------- */

test("a captured photo starts as not saved on the device", () => {
  const state = draftReducer(stateWithDraft({ media: null }), {
    type: "mediaCaptured",
    draftId: "d3",
    media: media("unsaved"),
  });

  assert.equal(state.current.media?.saveStatus, "unsaved");
  assert.equal(state.current.body, "本文");
});

test("mediaCaptured replaces the draft's media and resets generation but keeps the body", () => {
  const generated = stateWithDraft({ generation: "done" });
  const state = draftReducer(generated, {
    type: "mediaCaptured",
    draftId: "d3",
    media: media("unsaved", { id: "m2", kind: "video", mime: "video/mp4", name: "lt.mp4" }),
  });

  assert.equal(state.current.generation, "idle");
  assert.equal(state.current.body, "本文");
  assert.equal(state.current.media?.id, "m2");
  assert.equal(state.current.media?.kind, "video");
});

test("mediaCaptured for another draft is ignored", () => {
  const state = stateWithDraft({ media: null });
  assert.equal(draftReducer(state, { type: "mediaCaptured", draftId: "other", media: media("unsaved") }), state);
});

test("a share/download hand-off only asks for confirmation; it never marks the media saved", () => {
  const unsaved = stateWithDraft({ media: media("unsaved") });
  const confirming = draftReducer(unsaved, { type: "saveHandedOff", draftId: "d3", mediaId: "m1" });
  assert.equal(confirming.current.media?.saveStatus, "confirming");

  const failed = stateWithDraft({ media: media("failed") });
  assert.equal(
    draftReducer(failed, { type: "saveHandedOff", draftId: "d3", mediaId: "m1" }).current.media?.saveStatus,
    "confirming",
  );
});

test("only the user's confirmation marks the media saved", () => {
  const confirming = stateWithDraft({ media: media("confirming") });
  const saved = draftReducer(confirming, { type: "saveConfirmed", draftId: "d3", mediaId: "m1" });
  assert.equal(saved.current.media?.saveStatus, "saved");

  // Confirming something that was never handed off is ignored.
  const unsaved = stateWithDraft({ media: media("unsaved") });
  assert.equal(draftReducer(unsaved, { type: "saveConfirmed", draftId: "d3", mediaId: "m1" }), unsaved);
  const failed = stateWithDraft({ media: media("failed") });
  assert.equal(draftReducer(failed, { type: "saveConfirmed", draftId: "d3", mediaId: "m1" }), failed);
});

test("declining the confirmation returns to unsaved so the user can try again", () => {
  const confirming = stateWithDraft({ media: media("confirming") });
  const declined = draftReducer(confirming, { type: "saveDeclined", draftId: "d3", mediaId: "m1" });
  assert.equal(declined.current.media?.saveStatus, "unsaved");
});

test("a thrown share/download error marks the save failed, but never downgrades a saved one", () => {
  const unsaved = stateWithDraft({ media: media("unsaved") });
  assert.equal(
    draftReducer(unsaved, { type: "saveFailed", draftId: "d3", mediaId: "m1" }).current.media?.saveStatus,
    "failed",
  );

  const saved = stateWithDraft({ media: media("saved") });
  assert.equal(draftReducer(saved, { type: "saveFailed", draftId: "d3", mediaId: "m1" }), saved);
});

test("save results for a replaced media are ignored", () => {
  const state = stateWithDraft({ media: media("unsaved", { id: "m2" }) });
  assert.equal(draftReducer(state, { type: "saveHandedOff", draftId: "d3", mediaId: "m1" }), state);
  assert.equal(draftReducer(state, { type: "saveFailed", draftId: "d3", mediaId: "m1" }), state);
});

/* ---------- generation (kept for a future AI provider) ---------- */

test("a late AI result lands on its own draft, not the new one", () => {
  let state = stateWithDraft();
  state = draftReducer(state, { type: "generateStart", draftId: "d3" });
  state = draftReducer(state, { type: "nextDraft" });
  state = draftReducer(state, { type: "generateDone", draftId: "d3", text: "生成結果" });

  assert.equal(state.history[0]?.body, "生成結果");
  assert.equal(state.history[0]?.generation, "done");
  assert.equal(state.current.body, "");
});

test("generated text replaces AI text but never a body the user edited", () => {
  let state = draftReducer(stateWithDraft({ body: "" }), { type: "generateDone", draftId: "d3", text: "生成A" });
  assert.equal(state.current.body, "生成A");
  assert.equal(state.current.bodySource, "ai");

  state = draftReducer(state, { type: "setBody", body: "手で直した本文" });
  assert.equal(state.current.bodySource, "user");

  state = draftReducer(state, { type: "generateDone", draftId: "d3", text: "生成B" });
  assert.equal(state.current.body, "手で直した本文");
  assert.equal(state.current.bodySource, "user");
});

test("clearing the body hands control back (bodySource none)", () => {
  const state = draftReducer(stateWithDraft(), { type: "setBody", body: "   " });
  assert.equal(state.current.bodySource, "none");
});

test("generateFailed and openedInX update a draft that is already saved", () => {
  let state = draftReducer(stateWithDraft(), { type: "generateStart", draftId: "d3" });
  state = draftReducer(state, { type: "nextDraft" });
  state = draftReducer(state, { type: "generateFailed", draftId: "d3", reason: "quota" });
  state = draftReducer(state, { type: "openedInX", draftId: "d3" });

  assert.equal(state.history[0]?.generation, "quota");
  assert.equal(state.history[0]?.openedInX, true);
  assert.equal(state.current.generation, "idle");
  assert.equal(state.current.openedInX, false);
});

test("the developer toggle only changes the current draft", () => {
  const state = draftReducer(stateWithDraft({ includeDeveloper: false }), {
    type: "setIncludeDeveloper",
    value: true,
  });
  assert.equal(state.current.includeDeveloper, true);
  assert.equal(
    composePost({ body: state.current.body, tags: state.current.tags, includeDeveloper: state.current.includeDeveloper }),
    "本文\n\n#TechLTNight\n\n開発者：",
  );
});

test("removeTag removes exactly the given tag", () => {
  const state = draftReducer(stateWithDraft(), { type: "addTags", input: "#Rust" });
  const removed = draftReducer(state, { type: "removeTag", tag: "#TechLTNight" });
  assert.deepEqual(removed.current.tags, ["#Rust"]);
});
