// Single-writer guard (NFR-02). Two tabs of this app share one IndexedDB, and each
// keeps its own in-memory copy, so both writing would overwrite each other's drafts
// and blobs. The first page takes a Web Lock and keeps it until it is closed; any
// other page runs read-only. Where Web Locks are unavailable nothing is guarded,
// as before.

export const WRITER_LOCK_NAME = "lt-share-writer";

export type WriterLockResult = "acquired" | "denied" | "unsupported";

type LockManagerLike = {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown | null) => Promise<void> | void,
  ): Promise<unknown>;
};

const RETRY_DELAY_MS = 300;

function attempt(locks: LockManagerLike): Promise<WriterLockResult> {
  return new Promise((resolve) => {
    try {
      locks
        .request(WRITER_LOCK_NAME, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve("denied");
            return;
          }
          resolve("acquired");
          // Never settles: the lock is held for the lifetime of the page.
          return new Promise<void>(() => {});
        })
        .catch(() => resolve("unsupported"));
    } catch {
      resolve("unsupported");
    }
  });
}

export async function acquireWriterLock(
  options: {
    locks?: LockManagerLike | undefined;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<WriterLockResult> {
  const locks = "locks" in options ? options.locks : (globalThis.navigator?.locks as LockManagerLike | undefined);
  if (!locks || typeof locks.request !== "function") return "unsupported";

  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let result = await attempt(locks);
  if (result === "denied") {
    // A reloading page can overlap with its predecessor for a moment: try once more.
    await wait(RETRY_DELAY_MS);
    result = await attempt(locks);
  }
  return result;
}
