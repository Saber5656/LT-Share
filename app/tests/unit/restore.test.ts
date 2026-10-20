import { test } from "node:test";
import assert from "node:assert/strict";
import { createDraft, type Draft } from "../../src/lib/draft.ts";
import { restoreState } from "../../src/lib/restore.ts";

function draft(id: string, index: number, overrides: Partial<Draft> = {}): Draft {
  return { ...createDraft({ id, index, tags: ["#A"], now: 1000 + index }), ...overrides };
}

test("nothing stored means a fresh start", () => {
  assert.equal(restoreState({ drafts: [], meta: null }, 5000), null);
});

test("restores the current draft, the history in order, and the stored tags", () => {
  const state = restoreState(
    {
      drafts: [draft("d3", 3, { body: "三" }), draft("d1", 1), draft("d2", 2)],
      meta: { currentDraftId: "d3", tags: ["#A", "#B"], nextId: 4 },
    },
    5000,
  );

  assert.ok(state);
  assert.equal(state.current.id, "d3");
  assert.equal(state.current.body, "三");
  assert.deepEqual(state.current.tags, ["#A", "#B"]);
  assert.deepEqual(
    state.history.map((d) => d.id),
    ["d1", "d2"],
  );
  assert.equal(state.nextId, 4);
});

test("tags saved in earlier drafts are not rewritten by the current setting", () => {
  const state = restoreState(
    {
      drafts: [draft("d1", 1, { tags: ["#Old"] }), draft("d2", 2, { tags: ["#Old"] })],
      meta: { currentDraftId: "d2", tags: ["#New"], nextId: 3 },
    },
    5000,
  );

  assert.deepEqual(state?.current.tags, ["#New"]);
  assert.deepEqual(state?.history[0]?.tags, ["#Old"]);
});

test("a missing current draft is replaced by an empty one that carries the tags", () => {
  const state = restoreState(
    {
      drafts: [draft("d1", 1, { body: "一" }), draft("d2", 2, { body: "二" })],
      meta: { currentDraftId: "gone", tags: ["#B"], nextId: 3 },
    },
    5000,
  );

  assert.ok(state);
  assert.equal(state.history.length, 2);
  assert.equal(state.current.index, 3);
  // A fresh unique id: it can never collide with a draft another tab created.
  assert.ok(!["d1", "d2"].includes(state.current.id));
  assert.match(state.current.id, /^d-/);
  assert.equal(state.current.body, "");
  assert.equal(state.current.media, null);
  assert.deepEqual(state.current.tags, ["#B"]);
  assert.equal(state.nextId, 4);
});

test("drafts without app state still restore (tags from the latest draft)", () => {
  const state = restoreState({ drafts: [draft("d1", 1, { tags: ["#X"] })], meta: null }, 5000);

  assert.ok(state);
  assert.equal(state.history.length, 1);
  assert.deepEqual(state.current.tags, ["#X"]);
  assert.equal(state.current.index, 2);
});

test("old counter-style ids and new unique ids restore side by side", () => {
  const state = restoreState(
    {
      drafts: [draft("d2", 2), draft("d-3f2a9c1e-uuid", 3), draft("d1", 1)],
      meta: { currentDraftId: "d-3f2a9c1e-uuid", tags: [], nextId: 3 },
    },
    5000,
  );

  assert.equal(state?.current.id, "d-3f2a9c1e-uuid");
  assert.deepEqual(
    state?.history.map((d) => d.id),
    ["d1", "d2"],
  );
  assert.equal(state?.nextId, 3);
});

test("nextId never collides with a stored draft id", () => {
  const state = restoreState(
    { drafts: [draft("d7", 7)], meta: { currentDraftId: "d7", tags: [], nextId: 2 } },
    5000,
  );
  assert.equal(state?.nextId, 8);
});

test("a generation that was interrupted by a reload is shown as failed so it can be retried", () => {
  const state = restoreState(
    {
      drafts: [draft("d1", 1, { generation: "generating" }), draft("d2", 2, { generation: "generating" })],
      meta: { currentDraftId: "d2", tags: [], nextId: 3 },
    },
    5000,
  );

  assert.equal(state?.current.generation, "failed");
  assert.equal(state?.history[0]?.generation, "failed");
});

test("a media still waiting for the user's confirmation is asked about again after a reload", () => {
  const state = restoreState(
    {
      drafts: [
        draft("d1", 1, {
          media: { id: "m", kind: "photo", mime: "image/jpeg", name: "a.jpg", size: 1, saveStatus: "confirming" },
        }),
      ],
      meta: { currentDraftId: "d1", tags: [], nextId: 2 },
    },
    5000,
  );

  // Confirmation is asked again after a reload instead of being assumed.
  assert.equal(state?.current.media?.saveStatus, "confirming");
});
