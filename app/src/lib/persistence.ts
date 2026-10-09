import type { Draft, DraftState } from "./draft.ts";
import type { AppMeta, Repository, StoredSnapshot } from "./repository.ts";

export type FlushResult = { ok: true } | { ok: false; error: unknown };

/**
 * Keeps the on-device copy in step with the in-memory state.
 *
 * - Storage failures are returned, never thrown, and never touch the in-memory
 *   state or delete anything (NFR-02). A later flush simply tries again.
 * - A media blob is only deleted after a write that no longer references it has
 *   succeeded, so replacing a recording can never leave a draft without media.
 * - Blobs also live in an in-memory map so the app keeps working (and the user
 *   can still share the file) when IndexedDB refuses the write.
 */
export class Persistence {
  // JSON of each draft as last stored, to write only what changed.
  private readonly written = new Map<string, string>();
  private lastMeta = "";
  private chain: Promise<unknown> = Promise.resolve();
  private readonly memory = new Map<string, Blob>();
  private readonly pendingMediaDeletes = new Set<string>();
  private readonly unpersisted = new Set<string>();
  // Ids whose write is in progress: never released from memory meanwhile.
  private readonly pinned = new Set<string>();
  private readonly repo: Repository | null;
  private readonly now: () => number;
  private readonly readOnly: boolean;

  constructor(repo: Repository | null, now: () => number = Date.now, options: { readOnly?: boolean } = {}) {
    this.repo = repo;
    this.now = now;
    this.readOnly = options.readOnly ?? false;
  }

  /**
   * True when this page may write to storage. False without storage, and also in
   * read-only mode (another tab holds the writer lock): such a page can read but
   * never writes, deletes or cleans up anything.
   */
  get available(): boolean {
    return this.repo !== null && !this.readOnly;
  }

  /** Reads what is stored and remembers it, so an unchanged reload writes nothing. */
  async load(): Promise<StoredSnapshot> {
    if (!this.repo) throw new Error("On-device storage is not available");
    const snapshot = await this.repo.load();
    this.written.clear();
    for (const draft of snapshot.drafts) this.written.set(draft.id, JSON.stringify(draft));
    this.lastMeta = snapshot.meta ? JSON.stringify(snapshot.meta) : "";
    return snapshot;
  }

  /**
   * Writes what changed. `omit` lists draft ids that must NOT be written yet (the
   * speculative empty draft of a 次の投稿へ that may still be refused); the app
   * state is written regardless, and a reload simply starts a fresh empty draft.
   */
  flush(state: DraftState, options: { omit?: ReadonlySet<string> } = {}): Promise<FlushResult> {
    const run = this.chain.then(() => this.write(state, options.omit ?? new Set()));
    this.chain = run;
    return run;
  }

  async putMedia(id: string, blob: Blob): Promise<{ persisted: boolean; error?: unknown }> {
    this.memory.set(id, blob);
    if (!this.repo || this.readOnly) return { persisted: false };
    this.pinned.add(id);
    try {
      await this.repo.putMedia(id, blob);
      this.unpersisted.delete(id);
      return { persisted: true };
    } catch (error) {
      this.unpersisted.add(id);
      return { persisted: false, error };
    } finally {
      this.pinned.delete(id);
    }
  }

  /**
   * Keeps only the blobs that are needed right now (the current draft's media) in
   * memory. Everything else can be read back from storage on demand. A blob that
   * exists nowhere else (its write failed) or is being written is never released.
   */
  retainMedia(ids: Iterable<string>): void {
    const keep = new Set(ids);
    for (const id of [...this.memory.keys()]) {
      if (keep.has(id) || this.unpersisted.has(id) || this.pinned.has(id)) continue;
      this.memory.delete(id);
    }
  }

  /**
   * Deletes stored blobs that no draft references (left behind by an interrupted
   * capture). Call once after a successful load. A blob referenced by any draft, or
   * held in memory in this session, is never deleted; any storage error just stops
   * the cleanup. Returns how many blobs were deleted.
   */
  async collectGarbage(snapshot: StoredSnapshot): Promise<number> {
    if (!this.repo || this.readOnly) return 0;
    const referenced = new Set(snapshot.drafts.flatMap((draft) => (draft.media ? [draft.media.id] : [])));
    let deleted = 0;
    try {
      for (const id of await this.repo.listMediaIds()) {
        if (referenced.has(id) || this.memory.has(id) || this.pinned.has(id)) continue;
        await this.repo.deleteMedia(id);
        deleted += 1;
      }
    } catch {
      // Leave the rest for the next start; an orphaned blob is harmless.
    }
    return deleted;
  }

  /** Blobs that live only in memory because the browser refused to store them. */
  get unpersistedMediaIds(): ReadonlySet<string> {
    return this.unpersisted;
  }

  /** Tries again to store every in-memory-only blob. True when none are left. */
  async retryUnpersistedMedia(): Promise<boolean> {
    for (const id of [...this.unpersisted]) {
      const blob = this.memory.get(id);
      if (blob) await this.putMedia(id, blob);
      else this.unpersisted.delete(id);
    }
    return this.unpersisted.size === 0;
  }

  /** The blob if it is already in memory (usable inside a user-gesture handler). */
  peekMedia(id: string): Blob | undefined {
    return this.memory.get(id);
  }

  /**
   * The stored blob, or null when it does not exist. A storage read error is NOT
   * reported as "missing": it rejects, so callers can offer a retry instead of
   * telling the user to record again.
   */
  async getMedia(id: string, options: { remember?: boolean } = {}): Promise<Blob | null> {
    const inMemory = this.memory.get(id);
    if (inMemory) return inMemory;
    if (!this.repo) return null;
    const blob = await this.repo.getMedia(id);
    if (blob && options.remember) this.memory.set(id, blob);
    return blob;
  }

  /** Schedules a blob for deletion once a successful write no longer references it. */
  queueMediaDelete(id: string): void {
    this.pendingMediaDeletes.add(id);
  }

  private async write(state: DraftState, omit: ReadonlySet<string>): Promise<FlushResult> {
    if (!this.repo || this.readOnly) {
      return { ok: false, error: new Error("On-device storage is not available for writing") };
    }

    const drafts = [state.current, ...state.history];
    const serialized = new Map(drafts.map((draft) => [draft.id, JSON.stringify(draft)] as const));
    const changed = drafts.filter(
      (draft) => !omit.has(draft.id) && this.written.get(draft.id) !== serialized.get(draft.id),
    );
    const meta = metaOf(state);
    const metaJson = JSON.stringify(meta);

    try {
      if (changed.length > 0 || metaJson !== this.lastMeta) {
        const stamp = this.now();
        await this.repo.writeDrafts(
          changed.map((draft) => ({ ...draft, updatedAt: stamp })),
          meta,
        );
        for (const draft of changed) this.written.set(draft.id, serialized.get(draft.id) ?? "");
        this.lastMeta = metaJson;
      }
    } catch (error) {
      return { ok: false, error };
    }

    await this.deleteUnreferencedMedia(drafts);
    return { ok: true };
  }

  private async deleteUnreferencedMedia(drafts: Draft[]): Promise<void> {
    if (!this.repo || this.pendingMediaDeletes.size === 0) return;
    const referenced = new Set(drafts.flatMap((draft) => (draft.media ? [draft.media.id] : [])));

    for (const id of [...this.pendingMediaDeletes]) {
      if (referenced.has(id)) continue;
      try {
        await this.repo.deleteMedia(id);
        this.pendingMediaDeletes.delete(id);
        this.unpersisted.delete(id);
        this.memory.delete(id);
      } catch {
        // Keep it queued; an orphaned blob is harmless and is retried on the next flush.
      }
    }
  }
}

function metaOf(state: DraftState): AppMeta {
  return { currentDraftId: state.current.id, tags: state.current.tags, nextId: state.nextId };
}
