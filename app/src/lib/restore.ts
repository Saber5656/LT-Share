import { createDraft, createDraftId, createInitialState, type Draft, type DraftState } from "./draft.ts";
import type { StoredSnapshot } from "./repository.ts";

function numericId(id: string): number {
  const match = /^d(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

// Rebuilds the in-memory state from what is stored on the device (AT-15).
// Returns null when nothing has been stored yet.
export function restoreState(snapshot: StoredSnapshot, now = Date.now()): DraftState | null {
  const { meta } = snapshot;
  if (snapshot.drafts.length === 0) {
    return meta ? createInitialState(meta.tags, now) : null;
  }

  // A reload interrupts any running generation; show it as failed so it can be retried.
  const drafts: Draft[] = snapshot.drafts
    .map((draft) => (draft.generation === "generating" ? { ...draft, generation: "failed" as const } : draft))
    .sort((a, b) => a.index - b.index);

  const maxIndex = Math.max(...drafts.map((draft) => draft.index));
  let nextId = Math.max(meta?.nextId ?? 0, ...drafts.map((draft) => numericId(draft.id) + 1), 1);

  const stored = meta ? drafts.find((draft) => draft.id === meta.currentDraftId) : undefined;
  if (stored) {
    return {
      current: meta ? { ...stored, tags: [...meta.tags] } : stored,
      history: drafts.filter((draft) => draft.id !== stored.id),
      nextId,
    };
  }

  // The current draft is missing: keep every stored draft and start an empty one
  // that carries the hashtags, so nothing stored is lost or overwritten.
  const tags = meta?.tags ?? drafts[drafts.length - 1]?.tags ?? [];
  const current = createDraft({ id: createDraftId(), index: maxIndex + 1, tags, now });
  nextId += 1;
  return { current, history: drafts, nextId };
}
