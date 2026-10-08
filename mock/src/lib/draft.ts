// Mock-only draft state for the LT Share on X screen prototype.
// No camera, storage, AI or X integration lives here; the prototype simulates
// those with timers and bundled photos.

export type MediaKind = "photo" | "video";
export type SaveStatus = "saving" | "saved" | "failed";
export type Generation = "idle" | "generating" | "done" | "failed" | "quota";
export type BodySource = "none" | "ai" | "user";

export type Media = {
  kind: MediaKind;
  src: string;
  saveStatus: SaveStatus;
  durationSec?: number;
};

export type Draft = {
  id: string;
  index: number;
  tags: string[];
  body: string;
  bodySource: BodySource;
  media: Media | null;
  includeDeveloper: boolean;
  generation: Generation;
  openedInX: boolean;
};

export type DraftState = {
  current: Draft;
  history: Draft[];
  nextId: number;
};

export type DraftAction =
  | { type: "addTags"; input: string }
  | { type: "removeTag"; tag: string }
  | { type: "mediaCaptured"; media: Media }
  | { type: "mediaSaveResult"; ok: boolean }
  | { type: "generateStart"; draftId: string }
  | { type: "generateDone"; draftId: string; text: string }
  | { type: "generateFailed"; draftId: string; reason: "failed" | "quota" }
  | { type: "setBody"; body: string }
  | { type: "setIncludeDeveloper"; value: boolean }
  | { type: "openedInX"; draftId: string }
  | { type: "nextDraft" };

export const X_POST_LIMIT = 280;

export function createDraft({ id, index, tags }: { id: string; index: number; tags: string[] }): Draft {
  return {
    id,
    index,
    tags: [...tags],
    body: "",
    bodySource: "none",
    media: null,
    includeDeveloper: false,
    generation: "idle",
    openedInX: false,
  };
}

export function parseTags(input: string): string[] {
  return input
    .split(/[\s,、，]+/)
    .map((token) => token.replace(/^[#＃]+/, "").trim())
    .filter((token) => token.length > 0)
    .map((token) => `#${token}`);
}

export function addTags(current: string[], input: string): string[] {
  const seen = new Set(current.map((tag) => tag.toLowerCase()));
  const next = [...current];

  for (const tag of parseTags(input)) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(tag);
  }

  return next;
}

export function composePost({
  body,
  tags,
  includeDeveloper,
}: {
  body: string;
  tags: string[];
  includeDeveloper: boolean;
}): string {
  return [body.trim(), tags.join(" "), includeDeveloper ? "開発者：" : ""]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

// X counts most CJK characters as 2 and Latin/punctuation ranges as 1.
// URLs and emoji sequences are not special-cased; the mock shows it as an estimate.
const SINGLE_WEIGHT_RANGES: Array<[number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

export function xWeightedLength(text: string): number {
  let length = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    const single = SINGLE_WEIGHT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
    length += single ? 1 : 2;
  }

  return length;
}

function updateDraft(state: DraftState, draftId: string, update: (draft: Draft) => Draft): DraftState {
  if (state.current.id === draftId) {
    return { ...state, current: update(state.current) };
  }

  return {
    ...state,
    history: state.history.map((draft) => (draft.id === draftId ? update(draft) : draft)),
  };
}

export function isEmptyDraft(draft: Draft): boolean {
  return draft.media === null && draft.body.trim().length === 0;
}

export function canMoveToNextDraft(draft: Draft): boolean {
  if (isEmptyDraft(draft)) return false;
  return draft.media === null || draft.media.saveStatus === "saved";
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "addTags":
      return { ...state, current: { ...state.current, tags: addTags(state.current.tags, action.input) } };
    case "removeTag":
      return {
        ...state,
        current: { ...state.current, tags: state.current.tags.filter((tag) => tag !== action.tag) },
      };
    case "mediaCaptured":
      // A new recording needs a new summary; the existing body stays until it arrives.
      return { ...state, current: { ...state.current, media: action.media, generation: "idle" } };
    case "mediaSaveResult": {
      const media = state.current.media;
      if (!media) return state;
      return {
        ...state,
        current: { ...state.current, media: { ...media, saveStatus: action.ok ? "saved" : "failed" } },
      };
    }
    case "generateStart":
      return updateDraft(state, action.draftId, (draft) => ({ ...draft, generation: "generating" }));
    case "generateDone":
      // NFR-02: never overwrite text the user wrote or edited.
      return updateDraft(state, action.draftId, (draft) =>
        draft.bodySource === "user"
          ? { ...draft, generation: "done" }
          : { ...draft, body: action.text, bodySource: "ai", generation: "done" },
      );
    case "generateFailed":
      return updateDraft(state, action.draftId, (draft) => ({ ...draft, generation: action.reason }));
    case "setBody":
      return {
        ...state,
        current: { ...state.current, body: action.body, bodySource: action.body.trim() ? "user" : "none" },
      };
    case "setIncludeDeveloper":
      return { ...state, current: { ...state.current, includeDeveloper: action.value } };
    case "openedInX":
      return updateDraft(state, action.draftId, (draft) => ({ ...draft, openedInX: true }));
    case "nextDraft": {
      // FR-10: never discard a draft whose media is not safely on the device yet.
      if (!canMoveToNextDraft(state.current)) return state;
      const next = createDraft({
        id: `d${state.nextId}`,
        index: state.current.index + 1,
        tags: state.current.tags,
      });
      return { current: next, history: [...state.history, state.current], nextId: state.nextId + 1 };
    }
  }
}
