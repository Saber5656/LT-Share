// Draft state for LT Share on X. Pure logic only: no DOM, storage or network.
// Ported from the approved screen mock (mock/src/lib/draft.ts) and extended with
// the device-save confirmation flow (FR-03) and persistence-friendly fields (6.2).

export type MediaKind = "photo" | "video";

// "unsaved"    captured and held in the app only; not on the device yet
// "confirming" a share sheet / download was handed off; waiting for the user to confirm
// "saved"      the user confirmed the file is in the photo library / gallery
// "failed"     the share/download call threw; retry or fall back to a download
// "saved" is only ever reached through the user's confirmation (FR-03).
export type SaveStatus = "unsaved" | "confirming" | "saved" | "failed";
export type Generation = "idle" | "generating" | "done" | "failed" | "quota";
export type BodySource = "none" | "ai" | "user";

export type Media = {
  // Key of the Blob in the media store; the Blob itself is not part of the draft.
  id: string;
  kind: MediaKind;
  mime: string;
  name: string;
  size: number;
  saveStatus: SaveStatus;
};

export type Draft = {
  id: string;
  index: number;
  createdAt: number;
  updatedAt: number;
  // Snapshot of the hashtags used by this draft (FR-01).
  tags: string[];
  body: string;
  bodySource: BodySource;
  media: Media | null;
  includeDeveloper: boolean;
  generation: Generation;
  // The draft was handed to X. Never means "posted" (FR-11).
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
  | { type: "mediaCaptured"; draftId: string; media: Media }
  | { type: "saveHandedOff"; draftId: string; mediaId: string }
  | { type: "saveConfirmed"; draftId: string; mediaId: string }
  | { type: "saveDeclined"; draftId: string; mediaId: string }
  | { type: "saveFailed"; draftId: string; mediaId: string }
  | { type: "generateStart"; draftId: string }
  | { type: "generateDone"; draftId: string; text: string }
  | { type: "generateFailed"; draftId: string; reason: "failed" | "quota" }
  | { type: "setBody"; body: string }
  | { type: "setIncludeDeveloper"; value: boolean }
  | { type: "openedInX"; draftId: string }
  // `id` should be a createDraftId(); the counter-based fallback exists for tests and old data.
  | { type: "nextDraft"; now?: number; id?: string };

export const X_POST_LIMIT = 280;
export const DEVELOPER_LABEL = "開発者：";

// Collision-safe draft id. Earlier versions used "d1", "d2", ...; those still restore
// fine (restoreState only reads the number from ids of that exact shape).
export function createDraftId(): string {
  const random = globalThis.crypto;
  const suffix =
    typeof random?.randomUUID === "function"
      ? random.randomUUID()
      : Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8).padEnd(6, "0")).join("");
  return `d-${suffix}`;
}

export function createDraft({
  id,
  index,
  tags,
  now = Date.now(),
}: {
  id: string;
  index: number;
  tags: string[];
  now?: number;
}): Draft {
  return {
    id,
    index,
    createdAt: now,
    updatedAt: now,
    tags: [...tags],
    body: "",
    bodySource: "none",
    media: null,
    includeDeveloper: false,
    generation: "idle",
    openedInX: false,
  };
}

export function createInitialState(tags: string[] = [], now = Date.now()): DraftState {
  return { current: createDraft({ id: createDraftId(), index: 1, tags, now }), history: [], nextId: 2 };
}

/* ---------- hashtags (FR-01) ---------- */

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

/* ---------- composing the post (FR-07, FR-08) ---------- */

export function composePost({
  body,
  tags,
  includeDeveloper,
}: {
  body: string;
  tags: string[];
  includeDeveloper: boolean;
}): string {
  return [body.trim(), tags.join(" "), includeDeveloper ? DEVELOPER_LABEL : ""]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export function composeDraftPost(draft: Draft): string {
  return composePost({ body: draft.body, tags: draft.tags, includeDeveloper: draft.includeDeveloper });
}

// X counts most CJK characters as 2 and Latin/punctuation ranges as 1, and every
// URL as 23. Emoji sequences are not special-cased, so this is a (slightly
// pessimistic) estimate. See https://docs.x.com/fundamentals/counting-characters
const SINGLE_WEIGHT_RANGES: Array<[number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
const URL_WEIGHT = 23;
// A URL runs over ASCII characters only: text that follows it (Japanese, full-width
// punctuation or spaces) is counted normally instead of being swallowed by the URL.
const URL_PATTERN = /https?:\/\/[\x21-\x7e]+/gi;

export function xWeightedLength(text: string): number {
  let length = 0;
  const withoutUrls = text.normalize("NFC").replace(URL_PATTERN, () => {
    length += URL_WEIGHT;
    return "";
  });

  for (const char of withoutUrls) {
    const codePoint = char.codePointAt(0) ?? 0;
    const single = SINGLE_WEIGHT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
    length += single ? 1 : 2;
  }

  return length;
}

/* ---------- reducer ---------- */

function updateDraft(state: DraftState, draftId: string, update: (draft: Draft) => Draft): DraftState {
  if (state.current.id === draftId) {
    return { ...state, current: update(state.current) };
  }

  const index = state.history.findIndex((draft) => draft.id === draftId);
  if (index < 0) return state;
  return { ...state, history: state.history.map((draft, i) => (i === index ? update(draft) : draft)) };
}

// Applies `next` to a draft's media only when the draft still holds that media
// (a re-recording or a stale async result must not touch the new one).
function updateMediaStatus(
  state: DraftState,
  draftId: string,
  mediaId: string,
  next: (status: SaveStatus) => SaveStatus,
): DraftState {
  const draft = state.current.id === draftId ? state.current : state.history.find((d) => d.id === draftId);
  const media = draft?.media;
  if (!draft || !media || media.id !== mediaId) return state;

  const status = next(media.saveStatus);
  if (status === media.saveStatus) return state;
  return updateDraft(state, draftId, (d) => ({ ...d, media: { ...media, saveStatus: status } }));
}

export function isEmptyDraft(draft: Draft): boolean {
  return draft.media === null && draft.body.trim().length === 0;
}

export type NextDraftBlocker = "empty" | "media-unsaved" | "media-confirming" | "media-failed";

// FR-10 / NFR-02: never leave a draft whose media is not confirmed on the device.
export function nextDraftBlocker(draft: Draft): NextDraftBlocker | null {
  if (isEmptyDraft(draft)) return "empty";
  switch (draft.media?.saveStatus) {
    case "unsaved":
      return "media-unsaved";
    case "confirming":
      return "media-confirming";
    case "failed":
      return "media-failed";
    default:
      return null;
  }
}

export function canMoveToNextDraft(draft: Draft): boolean {
  return nextDraftBlocker(draft) === null;
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
      if (state.current.id !== action.draftId) return state;
      // A new recording replaces the previous one. The body stays: text the user
      // wrote is never discarded (NFR-02).
      return { ...state, current: { ...state.current, media: action.media, generation: "idle" } };
    case "saveHandedOff":
      return updateMediaStatus(state, action.draftId, action.mediaId, (status) =>
        status === "saved" ? status : "confirming",
      );
    case "saveConfirmed":
      return updateMediaStatus(state, action.draftId, action.mediaId, (status) =>
        status === "confirming" ? "saved" : status,
      );
    case "saveDeclined":
      return updateMediaStatus(state, action.draftId, action.mediaId, (status) =>
        status === "confirming" ? "unsaved" : status,
      );
    case "saveFailed":
      return updateMediaStatus(state, action.draftId, action.mediaId, (status) =>
        status === "saved" ? status : "failed",
      );
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
      if (!canMoveToNextDraft(state.current)) return state;
      const next = createDraft({
        id: action.id ?? `d${state.nextId}`,
        index: state.current.index + 1,
        tags: state.current.tags,
        now: action.now,
      });
      return { current: next, history: [...state.history, state.current], nextId: state.nextId + 1 };
    }
  }
}
