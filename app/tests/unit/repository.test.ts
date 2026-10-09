import { test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createIndexedDbRepository, transactionDone } from "../../src/lib/repository.ts";
import { createDraft, type Draft } from "../../src/lib/draft.ts";

function draft(id: string, index: number, overrides: Partial<Draft> = {}): Draft {
  return { ...createDraft({ id, index, tags: ["#TechLTNight"], now: 1000 + index }), ...overrides };
}

test("drafts and app state round-trip through IndexedDB and survive a reload", async () => {
  const factory = new IDBFactory();
  const first = createIndexedDbRepository(factory);
  const d1 = draft("d1", 1, {
    body: "一本目",
    media: { id: "m1", kind: "photo", mime: "image/jpeg", name: "lt.jpg", size: 3, saveStatus: "saved" },
  });
  const d2 = draft("d2", 2, { body: "二本目", includeDeveloper: true });
  const meta = { currentDraftId: "d2", tags: ["#TechLTNight", "#Rust"], nextId: 3 };

  await first.writeDrafts([d1, d2], meta);

  // "Reload": a brand new repository over the same database.
  const reloaded = createIndexedDbRepository(factory);
  const snapshot = await reloaded.load();

  assert.deepEqual(
    [...snapshot.drafts].sort((a, b) => a.index - b.index),
    [d1, d2],
  );
  assert.deepEqual(snapshot.meta, meta);
});

test("an empty database loads as no drafts and no meta", async () => {
  const snapshot = await createIndexedDbRepository(new IDBFactory()).load();
  assert.deepEqual(snapshot, { drafts: [], meta: null });
});

test("writeDrafts updates an existing draft in place", async () => {
  const repo = createIndexedDbRepository(new IDBFactory());
  const meta = { currentDraftId: "d1", tags: [], nextId: 2 };

  await repo.writeDrafts([draft("d1", 1, { body: "A" })], meta);
  await repo.writeDrafts([draft("d1", 1, { body: "B" })], meta);

  const { drafts } = await repo.load();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.body, "B");
});

test("media blobs are stored by id and can be deleted", async () => {
  const factory = new IDBFactory();
  const repo = createIndexedDbRepository(factory);

  await repo.putMedia("m1", new Blob(["jpeg-bytes"], { type: "image/jpeg" }));

  const reloaded = createIndexedDbRepository(factory);
  const blob = await reloaded.getMedia("m1");
  assert.ok(blob);
  assert.equal(await blob.text(), "jpeg-bytes");
  assert.equal(blob.type, "image/jpeg");
  assert.equal(await reloaded.getMedia("missing"), null);

  await reloaded.deleteMedia("m1");
  assert.equal(await reloaded.getMedia("m1"), null);
});

test("listMediaIds returns the ids of every stored blob", async () => {
  const repo = createIndexedDbRepository(new IDBFactory());
  assert.deepEqual(await repo.listMediaIds(), []);

  await repo.putMedia("m1", new Blob(["1"]));
  await repo.putMedia("m2", new Blob(["2"]));
  assert.deepEqual((await repo.listMediaIds()).sort(), ["m1", "m2"]);

  await repo.deleteMedia("m1");
  assert.deepEqual(await repo.listMediaIds(), ["m2"]);
});

type FakeTx = {
  error: DOMException | null;
  oncomplete: (() => void) | null;
  onerror: ((event: Event) => void) | null;
  onabort: ((event: Event) => void) | null;
};

function fakeTx(error: DOMException | null = null): FakeTx {
  return { error, oncomplete: null, onerror: null, onabort: null };
}

test("transactionDone rejects with the transaction error when there is one", async () => {
  const tx = fakeTx(new DOMException("full", "QuotaExceededError"));
  const done = transactionDone(tx as unknown as IDBTransaction);
  tx.onabort?.({ target: tx } as unknown as Event);
  await assert.rejects(done, { name: "QuotaExceededError" });
});

test("transactionDone falls back to the failing request's error when tx.error is empty", async () => {
  const tx = fakeTx(null);
  const done = transactionDone(tx as unknown as IDBTransaction);
  const requestError = new DOMException("constraint", "ConstraintError");
  tx.onerror?.({ target: { error: requestError } } as unknown as Event);
  await assert.rejects(done, { name: "ConstraintError" });
});

test("transactionDone never rejects with undefined", async () => {
  const tx = fakeTx(null);
  const done = transactionDone(tx as unknown as IDBTransaction);
  tx.onabort?.({ target: null } as unknown as Event);
  await assert.rejects(done, (error: unknown) => error instanceof Error && error.message.length > 0);
});

test("transactionDone resolves on complete", async () => {
  const tx = fakeTx(null);
  const done = transactionDone(tx as unknown as IDBTransaction);
  tx.oncomplete?.();
  await done;
});

test("an unavailable IndexedDB rejects instead of throwing synchronously", async () => {
  const broken = {
    open() {
      throw new Error("SecurityError");
    },
  } as unknown as IDBFactory;

  await assert.rejects(createIndexedDbRepository(broken).load(), /SecurityError/);
});
