import { test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { Persistence } from "../../src/lib/persistence.ts";
import { createIndexedDbRepository, type AppMeta, type Repository } from "../../src/lib/repository.ts";
import { restoreState } from "../../src/lib/restore.ts";
import { createDraft, draftReducer, type Draft, type DraftState, type Media } from "../../src/lib/draft.ts";

function media(id: string): Media {
  return { id, kind: "photo", mime: "image/jpeg", name: `${id}.jpg`, size: 3, saveStatus: "saved" };
}

function stateOf(overrides: Partial<Draft> = {}): DraftState {
  const current: Draft = {
    ...createDraft({ id: "d1", index: 1, tags: ["#TechLTNight"], now: 1000 }),
    body: "本文",
    ...overrides,
  };
  return { current, history: [], nextId: 2 };
}

// Wraps a repository to count writes and to fail on demand.
function spyRepo(inner: Repository) {
  const spy = {
    writes: [] as Array<{ ids: string[]; meta: AppMeta }>,
    deletedMedia: [] as string[],
    failWrites: 0,
    failMediaPut: false,
    failMediaGet: false,
    repo: {
      load: () => inner.load(),
      async writeDrafts(drafts: Draft[], meta: AppMeta) {
        if (spy.failWrites > 0) {
          spy.failWrites -= 1;
          throw new DOMException("quota", "QuotaExceededError");
        }
        spy.writes.push({ ids: drafts.map((d) => d.id), meta });
        return inner.writeDrafts(drafts, meta);
      },
      async putMedia(id: string, blob: Blob) {
        if (spy.failMediaPut) throw new DOMException("quota", "QuotaExceededError");
        return inner.putMedia(id, blob);
      },
      async getMedia(id: string) {
        if (spy.failMediaGet) throw new DOMException("read failed", "UnknownError");
        return inner.getMedia(id);
      },
      listMediaIds: () => inner.listMediaIds(),
      async deleteMedia(id: string) {
        spy.deletedMedia.push(id);
        return inner.deleteMedia(id);
      },
    } satisfies Repository,
  };
  return spy;
}

test("everything survives a reload: draft, media blob and app state", async () => {
  const factory = new IDBFactory();
  const first = new Persistence(createIndexedDbRepository(factory), () => 9000);

  const blob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
  assert.deepEqual(await first.putMedia("m1", blob), { persisted: true });

  let state = stateOf({ media: media("m1") });
  state = draftReducer(state, { type: "nextDraft", now: 2000 });
  state = draftReducer(state, { type: "addTags", input: "#Rust" });
  state = draftReducer(state, { type: "setBody", body: "二本目の本文" });
  assert.deepEqual(await first.flush(state), { ok: true });

  // New page load: nothing in memory, only IndexedDB.
  const second = new Persistence(createIndexedDbRepository(factory));
  const restored = restoreState(await second.load(), 10_000);

  assert.ok(restored);
  assert.equal(restored.current.id, "d2");
  assert.equal(restored.current.body, "二本目の本文");
  assert.deepEqual(restored.current.tags, ["#TechLTNight", "#Rust"]);
  assert.equal(restored.history.length, 1);
  assert.equal(restored.history[0]?.body, "本文");
  assert.deepEqual(restored.history[0]?.tags, ["#TechLTNight"]);
  assert.equal(restored.history[0]?.media?.id, "m1");
  assert.equal(restored.history[0]?.media?.saveStatus, "saved");
  assert.equal(restored.nextId, 3);

  const stored = await second.getMedia("m1");
  assert.equal(await stored?.text(), "jpeg-bytes");
});

test("flush stamps updatedAt and writes only the drafts that changed", async () => {
  const spy = spyRepo(createIndexedDbRepository(new IDBFactory()));
  const persistence = new Persistence(spy.repo, () => 9000);

  let state = stateOf({ media: media("m1") });
  state = draftReducer(state, { type: "nextDraft", now: 2000 });
  state = draftReducer(state, { type: "setBody", body: "二本目" });

  await persistence.flush(state);
  assert.deepEqual(spy.writes[0]?.ids.sort(), ["d1", "d2"]);

  // Only the current draft changes now.
  state = draftReducer(state, { type: "setBody", body: "二本目 改" });
  await persistence.flush(state);
  assert.deepEqual(spy.writes[1]?.ids, ["d2"]);

  // Nothing changed: nothing is written.
  await persistence.flush(state);
  assert.equal(spy.writes.length, 2);

  const stored = await spy.repo.load();
  assert.equal(stored.drafts.find((d) => d.id === "d2")?.updatedAt, 9000);
});

test("a failed write is reported, keeps the state, and is retried by the next flush", async () => {
  const spy = spyRepo(createIndexedDbRepository(new IDBFactory()));
  const persistence = new Persistence(spy.repo);
  const state = stateOf();

  spy.failWrites = 1;
  const failed = await persistence.flush(state);
  assert.equal(failed.ok, false);
  assert.equal((failed as { error: { name: string } }).error.name, "QuotaExceededError");
  assert.equal((await spy.repo.load()).drafts.length, 0);

  assert.deepEqual(await persistence.flush(state), { ok: true });
  assert.equal((await spy.repo.load()).drafts[0]?.body, "本文");
});

test("media replaced by a re-recording is deleted only after the new draft is written", async () => {
  const spy = spyRepo(createIndexedDbRepository(new IDBFactory()));
  const persistence = new Persistence(spy.repo);

  await persistence.putMedia("old", new Blob(["old"]));
  const withOld = stateOf({ media: media("old") });
  await persistence.flush(withOld);

  await persistence.putMedia("new", new Blob(["new"]));
  persistence.queueMediaDelete("old");
  const withNew = stateOf({ media: media("new") });

  // The write that would drop the reference fails: the old blob must stay.
  spy.failWrites = 1;
  assert.equal((await persistence.flush(withNew)).ok, false);
  assert.deepEqual(spy.deletedMedia, []);
  assert.ok(await persistence.getMedia("old"));

  // A flush that still references the old media does not delete it either.
  await persistence.flush(withOld);
  assert.deepEqual(spy.deletedMedia, []);

  assert.deepEqual(await persistence.flush(withNew), { ok: true });
  assert.deepEqual(spy.deletedMedia, ["old"]);
  assert.equal(await persistence.getMedia("old"), null);
  assert.ok(await persistence.getMedia("new"));
});

test("a missing blob is null, but a read error is reported instead of looking like a missing blob", async () => {
  const spy = spyRepo(createIndexedDbRepository(new IDBFactory()));
  const persistence = new Persistence(spy.repo);
  await spy.repo.putMedia("m1", new Blob(["bytes"]));

  assert.equal(await persistence.getMedia("unknown"), null);

  spy.failMediaGet = true;
  await assert.rejects(persistence.getMedia("m1"), { name: "UnknownError" });

  // The blob was never touched by the failed read and is readable once the error clears.
  spy.failMediaGet = false;
  assert.equal(await (await persistence.getMedia("m1"))?.text(), "bytes");
});

test("a transient read error never leads to deleting a blob that a draft still references", async () => {
  const spy = spyRepo(createIndexedDbRepository(new IDBFactory()));
  const persistence = new Persistence(spy.repo);
  await persistence.putMedia("m1", new Blob(["bytes"]));
  const state = stateOf({ media: media("m1") });
  await persistence.flush(state);

  // After a reload nothing is in memory, so a read goes to storage and fails.
  const reloaded = new Persistence(spy.repo);
  reloaded.queueMediaDelete("m1"); // even a stale delete request is ignored while referenced
  spy.failMediaGet = true;
  await assert.rejects(reloaded.getMedia("m1"));
  await reloaded.flush(state);

  assert.deepEqual(spy.deletedMedia, []);
  spy.failMediaGet = false;
  assert.ok(await spy.repo.getMedia("m1"));
});

test("retainMedia releases blobs that are no longer needed in memory but keeps them in storage", async () => {
  const spy = spyRepo(createIndexedDbRepository(new IDBFactory()));
  const persistence = new Persistence(spy.repo);
  for (const id of ["a", "b", "c"]) await persistence.putMedia(id, new Blob([id]));

  persistence.retainMedia(["a"]);

  assert.ok(persistence.peekMedia("a"));
  assert.equal(persistence.peekMedia("b"), undefined);
  assert.equal(persistence.peekMedia("c"), undefined);
  // Released blobs are still stored and can be read back from storage.
  assert.equal(await (await persistence.getMedia("b"))?.text(), "b");
  assert.deepEqual(spy.deletedMedia, []);
});

test("retainMedia never releases a blob that only exists in memory", async () => {
  const spy = spyRepo(createIndexedDbRepository(new IDBFactory()));
  const persistence = new Persistence(spy.repo);
  spy.failMediaPut = true;
  await persistence.putMedia("unsaved", new Blob(["only here"]));

  persistence.retainMedia([]);

  assert.ok(persistence.peekMedia("unsaved"), "the user's only copy must survive");
});

test("collectGarbage deletes blobs that no draft references, and only those", async () => {
  const factory = new IDBFactory();
  const writer = new Persistence(createIndexedDbRepository(factory));
  await writer.putMedia("kept", new Blob(["kept"]));
  await writer.putMedia("orphan", new Blob(["orphan"]));
  await writer.flush(stateOf({ media: media("kept") }));

  const spy = spyRepo(createIndexedDbRepository(factory));
  const persistence = new Persistence(spy.repo);
  const snapshot = await persistence.load();
  assert.equal(await persistence.collectGarbage(snapshot), 1);

  assert.deepEqual(spy.deletedMedia, ["orphan"]);
  assert.ok(await spy.repo.getMedia("kept"));
  assert.equal(await spy.repo.getMedia("orphan"), null);
});

test("collectGarbage keeps everything when listing or deleting fails", async () => {
  const factory = new IDBFactory();
  const writer = new Persistence(createIndexedDbRepository(factory));
  await writer.putMedia("orphan", new Blob(["orphan"]));
  await writer.flush(stateOf());

  const inner = createIndexedDbRepository(factory);
  const failingList: Repository = {
    ...inner,
    listMediaIds: async () => {
      throw new DOMException("list failed", "UnknownError");
    },
  };
  const failing = new Persistence(failingList);
  assert.equal(await failing.collectGarbage(await failing.load()), 0);
  assert.ok(await inner.getMedia("orphan"));

  const failingDelete: Repository = {
    ...inner,
    deleteMedia: async () => {
      throw new DOMException("delete failed", "UnknownError");
    },
  };
  const stuck = new Persistence(failingDelete);
  assert.equal(await stuck.collectGarbage(await stuck.load()), 0);
  assert.ok(await inner.getMedia("orphan"));
});

test("collectGarbage never deletes a blob held in memory or referenced by a draft", async () => {
  const spy = spyRepo(createIndexedDbRepository(new IDBFactory()));
  const persistence = new Persistence(spy.repo);
  await persistence.putMedia("fresh", new Blob(["captured a moment ago"]));

  assert.equal(await persistence.collectGarbage({ drafts: [], meta: null }), 0);
  assert.deepEqual(spy.deletedMedia, []);
});

test("a media write that fails stays available in memory and is reported", async () => {
  const spy = spyRepo(createIndexedDbRepository(new IDBFactory()));
  const persistence = new Persistence(spy.repo);
  spy.failMediaPut = true;

  const result = await persistence.putMedia("m1", new Blob(["bytes"]));
  assert.equal(result.persisted, false);
  assert.equal(await (await persistence.getMedia("m1"))?.text(), "bytes");
});

test("without IndexedDB the app keeps working in memory and says it is not persisting", async () => {
  const persistence = new Persistence(null);

  assert.equal(persistence.available, false);
  assert.equal((await persistence.putMedia("m1", new Blob(["bytes"]))).persisted, false);
  assert.equal(await (await persistence.getMedia("m1"))?.text(), "bytes");
  assert.equal((await persistence.flush(stateOf())).ok, false);
  await assert.rejects(persistence.load());
});

test("a reload does not rewrite or re-stamp what is already stored", async () => {
  const factory = new IDBFactory();
  const writer = new Persistence(createIndexedDbRepository(factory), () => 9000);
  await writer.flush(stateOf());

  const spy = spyRepo(createIndexedDbRepository(factory));
  const persistence = new Persistence(spy.repo, () => 20_000);
  const restored = restoreState(await persistence.load(), 20_000);
  assert.ok(restored);

  await persistence.flush(restored);
  assert.equal(spy.writes.length, 0);
  assert.equal((await spy.repo.load()).drafts[0]?.updatedAt, 9000);

  // A real change after the reload is written (and stamped).
  await persistence.flush({ ...restored, current: { ...restored.current, body: "直した" } });
  assert.equal(spy.writes.length, 1);
  assert.equal((await spy.repo.load()).drafts[0]?.updatedAt, 20_000);
});

test("a generation interrupted by the reload is persisted as failed", async () => {
  const factory = new IDBFactory();
  const writer = new Persistence(createIndexedDbRepository(factory));
  await writer.flush(stateOf({ generation: "generating" }));

  const spy = spyRepo(createIndexedDbRepository(factory));
  const persistence = new Persistence(spy.repo);
  const restored = restoreState(await persistence.load());
  assert.ok(restored);
  await persistence.flush(restored);

  assert.equal((await spy.repo.load()).drafts[0]?.generation, "failed");
});

test("media that could not be written are remembered and retried", async () => {
  const spy = spyRepo(createIndexedDbRepository(new IDBFactory()));
  const persistence = new Persistence(spy.repo);

  spy.failMediaPut = true;
  await persistence.putMedia("m1", new Blob(["bytes"]));
  assert.deepEqual([...persistence.unpersistedMediaIds], ["m1"]);

  // Still failing: stays unpersisted and the in-memory copy is kept.
  assert.equal(await persistence.retryUnpersistedMedia(), false);
  assert.deepEqual([...persistence.unpersistedMediaIds], ["m1"]);

  spy.failMediaPut = false;
  assert.equal(await persistence.retryUnpersistedMedia(), true);
  assert.equal(persistence.unpersistedMediaIds.size, 0);
  assert.equal(await (await spy.repo.getMedia("m1"))?.text(), "bytes");
});

test("peekMedia is synchronous for blobs held in memory; getMedia can remember a stored blob", async () => {
  const factory = new IDBFactory();
  await createIndexedDbRepository(factory).putMedia("m1", new Blob(["stored"]));

  const persistence = new Persistence(createIndexedDbRepository(factory));
  assert.equal(persistence.peekMedia("m1"), undefined);

  await persistence.getMedia("m1"); // not remembered by default
  assert.equal(persistence.peekMedia("m1"), undefined);

  const blob = await persistence.getMedia("m1", { remember: true });
  assert.equal(persistence.peekMedia("m1"), blob);
});
