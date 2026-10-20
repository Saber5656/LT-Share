// Asks the browser to treat this site's storage as persistent so recordings are
// less likely to be evicted under storage pressure. Best effort: the answer is
// ignored, and the request is made at most once (some browsers show a prompt).

const FLAG = "lt-share:persist-requested";

type Flags = Pick<Storage, "getItem" | "setItem">;
type StorageApi = { persist?: () => Promise<boolean> };

export async function requestPersistentStorage(
  storage: StorageApi | undefined,
  flags: Flags | null,
): Promise<boolean> {
  if (typeof storage?.persist !== "function") return false;
  try {
    if (flags?.getItem(FLAG) === "1") return false;
  } catch {
    // Flag store unavailable: ask anyway.
  }
  try {
    flags?.setItem(FLAG, "1"); // before asking, so a failure is not retried
  } catch {
    // ignore
  }
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}
