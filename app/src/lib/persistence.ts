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
  private readonly written = new Map<string, Draft>();
  private lastMeta = "";
  private chain: Promise<unknown> = Promise.resolve();
  private readonly memory = new Map<string, Blob>();
  private readonly pendingMediaDeletes = new Set<string>();
  private readonly unpersisted = new Set<string>();
  private readonly repo: Repository | null;
  private readonly now: () => number;

  constructor(repo: Repository | null, now: () => number = Date.now) {
    this.repo = repo;
    this.now = now;
  }

  get available(): boolean {
    return this.repo !== null;
  }

  load(): Promise<StoredSnapshot> {
    if (!this.repo) return Promise.reject(new Error("On-device storage is not available"));
    return this.repo.load();
  }

  /** Marks a state that was just restored as already stored (nothing to rewrite). */
  markWritten(state: DraftState): void {
    for (const draft of [state.current, ...state.history]) this.written.set(draft.id, draft);
    this.lastMeta = JSON.stringify(metaOf(state));
  }

  flush(state: DraftState): Promise<FlushResult> {
    const run = this.chain.then(() => this.write(state));
    this.chain = run;
    return run;
  }

  async putMedia(id: string, blob: Blob): Promise<{ persisted: boolean; error?: unknown }> {
    this.memory.set(id, blob);
    if (!this.repo) return { persisted: false };
    try {
      await this.repo.putMedia(id, blob);
      this.unpersisted.delete(id);
      return { persisted: true };
    } catch (error) {
      this.unpersisted.add(id);
      return { persisted: false, error };
    }
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

  async getMedia(id: string, options: { remember?: boolean } = {}): Promise<Blob | null> {
    const inMemory = this.memory.get(id);
    if (inMemory) return inMemory;
    if (!this.repo) return null;
    try {
      const blob = await this.repo.getMedia(id);
      if (blob && options.remember) this.memory.set(id, blob);
      return blob;
    } catch {
      return null;
    }
  }

  /** Schedules a blob for deletion once a successful write no longer references it. */
  queueMediaDelete(id: string): void {
    this.pendingMediaDeletes.add(id);
  }

  private async write(state: DraftState): Promise<FlushResult> {
    if (!this.repo) return { ok: false, error: new Error("On-device storage is not available") };

    const drafts = [state.current, ...state.history];
    const changed = drafts.filter((draft) => this.written.get(draft.id) !== draft);
    const meta = metaOf(state);
    const metaJson = JSON.stringify(meta);

    try {
      if (changed.length > 0 || metaJson !== this.lastMeta) {
        const stamp = this.now();
        await this.repo.writeDrafts(
          changed.map((draft) => ({ ...draft, updatedAt: stamp })),
          meta,
        );
        for (const draft of changed) this.written.set(draft.id, draft);
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
