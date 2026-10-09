// On-device storage (C-03, 6.3). Everything lives in the visitor's own browser
// (IndexedDB); there is no server or remote database. The rest of the app only
// sees the Repository interface, so it can be tested with fake-indexeddb.

import type { Draft } from "./draft.ts";

/** App-level state that is not part of a single draft. */
export type AppMeta = {
  currentDraftId: string;
  // The current hashtag setting (FR-01). Saved drafts keep their own snapshot.
  tags: string[];
  nextId: number;
};

export type StoredSnapshot = {
  drafts: Draft[];
  meta: AppMeta | null;
};

export interface Repository {
  load(): Promise<StoredSnapshot>;
  /** Upserts the given drafts and the app state in a single transaction. */
  writeDrafts(drafts: Draft[], meta: AppMeta): Promise<void>;
  putMedia(id: string, blob: Blob): Promise<void>;
  getMedia(id: string): Promise<Blob | null>;
  deleteMedia(id: string): Promise<void>;
}

const DB_NAME = "lt-share";
const DB_VERSION = 1;
const DRAFTS = "drafts";
const MEDIA = "media";
const META = "meta";
const META_KEY = "app";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Writes are only durable once the transaction completes (quota errors surface here).
export function transactionDone(tx: IDBTransaction): Promise<void> {
  // tx.error can still be null while the handler runs; the failing request carries
  // the real reason then. Never reject with undefined.
  const reason = (event: Event) =>
    tx.error ??
    (event.target as IDBRequest | null)?.error ??
    new Error("The on-device storage transaction failed");
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (event) => reject(reason(event));
    tx.onabort = (event) => reject(reason(event));
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export function createIndexedDbRepository(factory: IDBFactory = indexedDB, name = DB_NAME): Repository {
  let connection: Promise<IDBDatabase> | null = null;

  const connect = () => {
    connection ??= openDatabase(factory, name).then(
      (db) => {
        // Another tab upgrading, or the browser closing an idle connection
        // (Safari does this): reconnect on next use.
        db.onversionchange = () => db.close();
        db.onclose = () => {
          connection = null;
        };
        return db;
      },
      (error) => {
        connection = null;
        throw error;
      },
    );
    return connection;
  };

  async function withDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
    try {
      return await run(await connect());
    } catch (error) {
      if ((error as { name?: string } | null)?.name !== "InvalidStateError") throw error;
      connection = null; // the connection was closing; retry once on a fresh one
      return run(await connect());
    }
  }

  return {
    load: () =>
      withDb(async (db) => {
        const tx = db.transaction([DRAFTS, META], "readonly");
        const [drafts, meta] = await Promise.all([
          request(tx.objectStore(DRAFTS).getAll()),
          request(tx.objectStore(META).get(META_KEY)),
        ]);
        return {
          drafts: drafts as Draft[],
          meta: meta ? (meta as { value: AppMeta }).value : null,
        };
      }),

    writeDrafts: (drafts, meta) =>
      withDb(async (db) => {
        const tx = db.transaction([DRAFTS, META], "readwrite");
        const done = transactionDone(tx);
        const store = tx.objectStore(DRAFTS);
        for (const draft of drafts) store.put(draft);
        tx.objectStore(META).put({ key: META_KEY, value: meta });
        await done;
      }),

    putMedia: (id, blob) =>
      withDb(async (db) => {
        const tx = db.transaction(MEDIA, "readwrite");
        const done = transactionDone(tx);
        tx.objectStore(MEDIA).put({ id, blob });
        await done;
      }),

    getMedia: (id) =>
      withDb(async (db) => {
        const record = (await request(db.transaction(MEDIA, "readonly").objectStore(MEDIA).get(id))) as
          | { blob: Blob }
          | undefined;
        return record?.blob ?? null;
      }),

    deleteMedia: (id) =>
      withDb(async (db) => {
        const tx = db.transaction(MEDIA, "readwrite");
        const done = transactionDone(tx);
        tx.objectStore(MEDIA).delete(id);
        await done;
      }),
  };
}
