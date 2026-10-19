import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from "react";
import { getAiProvider, loadAiStatus, type AiStatus } from "../lib/ai.ts";
import { sharePostWithMedia } from "../lib/deviceShare.ts";
import {
  composeDraftPost,
  createDraftId,
  draftReducer,
  nextDraftBlocker,
  type Draft,
  type NextDraftBlocker,
  type DraftAction,
  type DraftState,
  type Media,
  type MediaKind,
} from "../lib/draft.ts";
import { runGeneration } from "../lib/generation.ts";
import type { Persistence } from "../lib/persistence.ts";
import { startDeviceSave } from "../lib/saveFlow.ts";
import { requestPersistentStorage } from "../lib/storagePersist.ts";
import { browserStorage } from "../lib/welcome.ts";
import { useNavigation, type Navigation } from "./useNavigation.ts";

export type StorageProblem =
  // The browser refuses on-device storage (private mode, blocked): memory only.
  | { kind: "unavailable" }
  // Another tab of this app holds the writer lock: this tab is read-only.
  | { kind: "readonly" }
  // The user chose to continue without waiting for a slow storage: memory only.
  | { kind: "skipped" }
  // A write failed (for example storage full); retrying is offered.
  | { kind: "write" };
export type ToastAction = { label: string; run: () => void };
export type ToastState = { id: number; message: string; action?: ToastAction };

export type App = {
  state: DraftState;
  dispatch: Dispatch<DraftAction>;
  nav: Navigation;
  persistence: Persistence;
  aiEnabled: boolean;
  aiStatus: AiStatus;
  autoSummary: boolean;
  setAutoSummary: (enabled: boolean) => void;
  captureKind: MediaKind;
  setCaptureKind: (kind: MediaKind) => void;
  // True while a share sheet / download hand-off is being opened (NFR-01).
  saveBusy: boolean;
  // The kind of the file being stored right now, or null. 次の投稿へ waits for it.
  captureBusy: MediaKind | null;
  storageProblem: StorageProblem | null;
  retryStorage: () => Promise<void>;
  toast: ToastState | null;
  showToast: (message: string, action?: ToastAction) => void;
  captureFile: (file: File, fallbackKind: MediaKind) => Promise<void>;
  // Starts synchronously (call it straight from a click handler).
  saveMedia: (draftId: string, mode?: "auto" | "download") => Promise<void>;
  confirmSaved: (draftId: string, mediaId: string) => void;
  saveAgain: (draftId: string, mediaId: string) => Promise<void>;
  goNext: () => Promise<void>;
  openPostSheet: (draftId: string) => void;
  markOpenedInX: (draftId: string) => void;
  shareWithMedia: (draft: Draft, file: File) => Promise<void>;
  retryGenerate: (draftId: string) => Promise<void>;
  findDraft: (draftId: string | null) => Draft | null;
};

export function findDraftIn(state: DraftState, draftId: string | null): Draft | null {
  if (!draftId) return null;
  if (state.current.id === draftId) return state.current;
  return state.history.find((draft) => draft.id === draftId) ?? null;
}

const mediaNoun = (kind: MediaKind) => (kind === "video" ? "動画" : "写真");

function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function kindOf(file: File, fallback: MediaKind): MediaKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "photo";
  return fallback;
}

export function useController({
  initial,
  persistence,
  initialProblem,
  firstRun,
}: {
  initial: DraftState;
  persistence: Persistence;
  initialProblem: StorageProblem | null;
  firstRun: boolean;
}): App {
  const [state, dispatch] = useReducer(draftReducer, initial);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [captureKind, setCaptureKind] = useState<MediaKind>("photo");
  const [saveBusy, setSaveBusy] = useState(false);
  const saveBusyRef = useRef(false);
  const nextBusyRef = useRef(false);
  // Set while a captured file is being stored (kind shown in the indicator).
  const [captureBusy, setCaptureBusy] = useState<MediaKind | null>(null);
  const captureBusyRef = useRef(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [storageProblem, setStorageProblem] = useState<StorageProblem | null>(initialProblem);

  const activeGenerations = useRef(new Set<string>());

  const findDraft = useCallback((draftId: string | null) => findDraftIn(stateRef.current, draftId), []);
  const nav = useNavigation({ view: firstRun ? "welcome" : "composer" }, (id) => findDraft(id) !== null);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ available: false, reason: "checking" });
  const [autoSummary, setAutoSummaryState] = useState(() => {
    try { return browserStorage()?.getItem("lt-share:auto-summary") !== "0"; } catch { return true; }
  });
  const setAutoSummary = useCallback((enabled: boolean) => {
    setAutoSummaryState(enabled);
    try { browserStorage()?.setItem("lt-share:auto-summary", enabled ? "1" : "0"); } catch { /* optional preference */ }
  }, []);
  const aiEnabled = aiStatus.available && autoSummary;
  useEffect(() => {
    let alive = true;
    void loadAiStatus().then(status => { if (alive) setAiStatus(status); });
    return () => { alive = false; };
  }, []);

  const showToast = useCallback((message: string, action?: ToastAction) => {
    setToast({ id: Date.now() + Math.random(), message, action });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.action ? 9000 : 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /* ---------- on-device persistence (C-03, NFR-02) ---------- */

  const persist = useCallback(
    async (
      snapshot: DraftState = stateRef.current,
      options: { omit?: ReadonlySet<string> } = {},
    ): Promise<boolean> => {
      if (!persistence.available) return false;
      const result = await persistence.flush(snapshot, options);
      const ok = result.ok && persistence.unpersistedMediaIds.size === 0;
      setStorageProblem((prev) => (ok ? (prev?.kind === "write" ? null : prev) : { kind: "write" }));
      return ok;
    },
    [persistence],
  );

  // Typing is written after a short pause; switching to another draft is written
  // right away so the saved "current draft" never lags behind the screen.
  const lastCurrentId = useRef(state.current.id);
  useEffect(() => {
    if (!persistence.available) return;
    const switched = lastCurrentId.current !== state.current.id;
    lastCurrentId.current = state.current.id;
    const timer = window.setTimeout(() => void persist(), switched ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [state, persistence, persist]);

  useEffect(() => {
    const flushWhenLeaving = () => {
      if (document.visibilityState === "hidden") void persist();
    };
    document.addEventListener("visibilitychange", flushWhenLeaving);
    window.addEventListener("pagehide", flushWhenLeaving);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenLeaving);
      window.removeEventListener("pagehide", flushWhenLeaving);
    };
  }, [persist]);

  // Only the current draft's media is kept in memory; the rest is read from storage on demand.
  const currentMediaId = state.current.media?.id;
  useEffect(() => {
    persistence.retainMedia(currentMediaId ? [currentMediaId] : []);
  }, [persistence, currentMediaId]);

  const retryStorage = useCallback(async () => {
    await persistence.retryUnpersistedMedia();
    const ok = await persist();
    if (ok) showToast("端末内（ブラウザ）に保存しました");
  }, [persistence, persist, showToast]);

  /* ---------- Same-origin image summarization ---------- */

  const retryGenerate = useCallback(
    async (draftId: string) => {
      const provider = getAiProvider();
      const draft = findDraftIn(stateRef.current, draftId);
      if (!aiStatus.available || !draft?.media || draft.generation === "generating") return;
      const mediaId = draft.media.id;
      if (activeGenerations.current.has(mediaId)) return;
      activeGenerations.current.add(mediaId);
      dispatch({ type: "generateStart", draftId, mediaId, replaceUserText: true });
      try {
        const image = await persistence.getMedia(mediaId).catch(() => null);
        if (!image) { dispatch({type:"generateFailed",draftId,mediaId,reason:"failed"}); return; }
        await runGeneration({ provider, draftId, mediaId, image, tags: draft.tags, dispatch, alreadyStarted: true });
      } finally { activeGenerations.current.delete(mediaId); }
    },
    [persistence, aiStatus.available],
  );

  /* ---------- recording (FR-02) ---------- */

  const captureFile = useCallback(
    async (file: File, fallbackKind: MediaKind) => {
      const kind = kindOf(file, fallbackKind);
      const media: Media = {
        id: newId(),
        kind,
        mime: file.type || (kind === "photo" ? "image/jpeg" : "video/mp4"),
        name: file.name,
        size: file.size,
        saveStatus: "unsaved",
      };

      // While the file is being stored, 次の投稿へ is blocked (goNext checks this), so
      // the draft on screen cannot change underneath it and the capture is never lost.
      captureBusyRef.current = true;
      setCaptureBusy(kind);
      try {
        // Store the blob first; the draft only points at it once it is in the media store.
        const stored = await persistence.putMedia(media.id, file);
        if (!stored.persisted && persistence.available) setStorageProblem({ kind: "write" });
        // After the first successful save, ask the browser to keep this site's storage (best effort, once).
        if (stored.persisted) void requestPersistentStorage(navigator.storage, browserStorage());

        const current = stateRef.current.current;
        if (current.media) persistence.queueMediaDelete(current.media.id);
        dispatch({ type: "mediaCaptured", draftId: current.id, media });
        // Inference starts from the captured file, independently of the Photos save flow.
        if (aiEnabled && current.bodySource !== "user") {
          void runGeneration({ provider: getAiProvider(), draftId: current.id, mediaId: media.id, image: file, tags: current.tags, dispatch });
        }
      } finally {
        captureBusyRef.current = false;
        setCaptureBusy(null);
      }
    },
    [persistence, aiEnabled],
  );

  /* ---------- save to device (FR-03) ---------- */

  // Not an async function on purpose: everything up to navigator.share() has to run
  // synchronously inside the click handler (iOS user activation). The blob therefore
  // comes from memory only; the buttons stay disabled until the media is loaded.
  const saveMedia = useCallback(
    (draftId: string, mode: "auto" | "download" = "auto"): Promise<void> => {
      if (saveBusyRef.current) return Promise.resolve();
      const media = findDraftIn(stateRef.current, draftId)?.media;
      if (!media) return Promise.resolve();

      const started = startDeviceSave({ blob: persistence.peekMedia(media.id), media, mode });
      if (started.status === "not-ready") {
        showToast(`${mediaNoun(media.kind)}を読み込み中です。読み込みが終わってからもう一度押してください`);
        return Promise.resolve();
      }

      saveBusyRef.current = true;
      setSaveBusy(true);
      return started.outcome
        .then(
          (outcome) => {
            // Cancelled: nothing changes. Otherwise (hand-off, or a share call that never
            // came back) the user is asked to confirm; "saved" is never assumed.
            if (outcome !== "cancelled") dispatch({ type: "saveHandedOff", draftId, mediaId: media.id });
          },
          () => dispatch({ type: "saveFailed", draftId, mediaId: media.id }),
        )
        .finally(() => {
          saveBusyRef.current = false;
          setSaveBusy(false);
        });
    },
    [persistence, showToast],
  );

  const confirmSaved = useCallback(
    (draftId: string, mediaId: string) => {
      dispatch({ type: "saveConfirmed", draftId, mediaId });
    },
    [],
  );

  const saveAgain = useCallback(
    async (draftId: string, mediaId: string) => {
      dispatch({ type: "saveDeclined", draftId, mediaId });
      await saveMedia(draftId);
    },
    [saveMedia],
  );

  /* ---------- 次の投稿へ (FR-10) ---------- */

  // Says why 次の投稿へ was refused (and offers the fix where there is one).
  const explainRefusal = useCallback(
    (current: Draft, blocker: NextDraftBlocker) => {
      if (blocker === "empty") {
        showToast("まだ記録も投稿文もありません。入力してから次へ進めます");
        return;
      }
      const noun = current.media ? mediaNoun(current.media.kind) : "記録";
      document.getElementById("step-record")?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (blocker === "media-confirming") {
        showToast(`${noun}を端末に保存できたか、「記録」の下で確認してください`);
        return;
      }
      const retry = blocker === "media-failed";
      showToast(
        retry
          ? `${noun}を端末に保存できていません。もう一度保存してください`
          : `${noun}がまだ端末に保存されていません。保存してから次へ進めます`,
        { label: retry ? "再試行" : "端末に保存", run: () => void saveMedia(current.id) },
      );
    },
    [saveMedia, showToast],
  );

  const goNext = useCallback(async () => {
    if (nextBusyRef.current) return;
    // A file that is still being stored must land in this draft first; moving on now
    // would leave it without a home (NFR-02).
    if (captureBusyRef.current) {
      showToast("取り込み中です。終わってから次へ進めます");
      return;
    }
    nextBusyRef.current = true;
    try {
      const current = stateRef.current.current;
      const blocker = nextDraftBlocker(current);
      if (blocker) {
        explainRefusal(current, blocker);
        return;
      }

      // FR-10: never move on (and never drop the draft from the screen) unless the
      // result is safely stored on the device. The saved draft and the app state are
      // written first, WITHOUT the new empty draft: if the move is refused after all,
      // nothing speculative stays on disk, and a reload at this instant simply starts
      // a fresh empty draft with the same hashtags. Without any storage the app runs
      // in memory only and says so, so there is nothing to wait for.
      const action: DraftAction = { type: "nextDraft", now: Date.now(), id: createDraftId() };
      if (persistence.available) {
        await persistence.retryUnpersistedMedia();
        const upcoming = draftReducer(stateRef.current, action);
        const ok = await persist(upcoming, { omit: new Set([upcoming.current.id]) });
        if (!ok) {
          showToast("投稿案を端末内に保存できなかったため、次へ進めません。空き容量を確認して再試行してください", {
            label: "再試行",
            run: () => void goNextRef.current(),
          });
          return;
        }
      }

      // The screen may have changed while the write ran (a capture started, the text
      // was cleared...). Decide against what is on screen now, not what was.
      const latest = stateRef.current;
      const latestBlocker = nextDraftBlocker(latest.current);
      if (captureBusyRef.current || latestBlocker) {
        // Refused after all: point the saved app state back at the draft on screen.
        if (persistence.available) await persist(latest);
        if (captureBusyRef.current) showToast("取り込み中です。終わってから次へ進めます");
        else if (latestBlocker) explainRefusal(latest.current, latestBlocker);
        return;
      }

      dispatch(action);
      window.scrollTo({ top: 0 });
      // Only now that the move really happened.
      showToast(`${latest.current.index}本目を保存しました。タグは引き継ぎます`);
    } finally {
      nextBusyRef.current = false;
    }
  }, [persistence, persist, explainRefusal, showToast]);

  const goNextRef = useRef(goNext);
  useLayoutEffect(() => {
    goNextRef.current = goNext;
  }, [goNext]);

  /* ---------- post check / hand-off to X (FR-08, FR-09) ---------- */

  const openPostSheet = useCallback((draftId: string) => nav.openSheet(draftId), [nav]);

  const markOpenedInX = useCallback((draftId: string) => {
    dispatch({ type: "openedInX", draftId });
  }, []);

  const shareWithMedia = useCallback(
    async (draft: Draft, file: File) => {
      try {
        const result = await sharePostWithMedia(file, composeDraftPost(draft));
        if (result === "shared") showToast("共有しました。投稿が完了したかどうかはXでご確認ください");
      } catch {
        showToast("共有できませんでした。Xを開くリンクから本文だけ渡せます");
      }
    },
    [showToast],
  );

  return {
    state,
    dispatch,
    nav,
    persistence,
    aiEnabled,
    aiStatus,
    autoSummary,
    setAutoSummary,
    captureKind,
    setCaptureKind,
    saveBusy,
    captureBusy,
    storageProblem,
    retryStorage,
    toast,
    showToast,
    captureFile,
    saveMedia,
    confirmSaved,
    saveAgain,
    goNext,
    openPostSheet,
    markOpenedInX,
    shareWithMedia,
    retryGenerate,
    findDraft,
  };
}
