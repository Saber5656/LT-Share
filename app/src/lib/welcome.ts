// First-run notice flag. Kept in localStorage (a per-device UI convenience, not
// draft data), and tolerant of storage being blocked: the notice just shows again.

const KEY = "lt-share:welcome-seen";

type ReadWrite = Pick<Storage, "getItem" | "setItem">;

export function browserStorage(): ReadWrite | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasSeenWelcome(storage: ReadWrite | null = browserStorage()): boolean {
  try {
    return storage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markWelcomeSeen(storage: ReadWrite | null = browserStorage()): void {
  try {
    storage?.setItem(KEY, "1");
  } catch {
    // Ignore: the notice will simply be shown again next time.
  }
}
