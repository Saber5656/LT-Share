import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from "react";
import { getAiProvider } from "../lib/ai.ts";
import { mediaToFile, saveToDevice, sharePostWithMedia } from "../lib/deviceShare.ts";
import {
  composeDraftPost,
  draftReducer,
  nextDraftBlocker,
  type Draft,
  type DraftAction,
  type DraftState,
  type Media,
  type MediaKind,
} from "../lib/draft.ts";
import { runGeneration } from "../lib/generation.ts";
import type { Persistence } from "../lib/persistence.ts";
import { useNavigation, type Navigation } from "./useNavigation.ts";

export type StorageProblem = { kind: "unavailable" } | { kind: "write" };
export type ToastAction = { label: string; run: () => void };
export type ToastState = { id: number; message: string; action?: ToastAction };

export type App = {
  state: DraftState;
  dispatch: Dispatch<DraftAction>;
  nav: Navigation;
  persistence: Persistence;
  aiEnabled: boolean;
  captureKind: MediaKind;
  setCaptureKind: (kind: MediaKind) => void;
  // True while a share sheet / download hand-off is being opened (NFR-01).
  saveBusy: boolean;
  storageProblem: StorageProblem | null;
  retryStorage: () => Promise<void>;
  toast: ToastState | null;
  showToast: (message: string, action?: ToastAction) => void;
  captureFile: (file: File, fallbackKind: MediaKind) => Promise<void>;
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
  const [toast, setToast] = useState<ToastState | null>(null);
  const [storageProblem, setStorageProblem] = useState<StorageProblem | null>(initialProblem);

  const findDraft = useCallback((draftId: string | null) => findDraftIn(stateRef.current, draftId), []);
  const nav = useNavigation({ view: firstRun ? "welcome" : "composer" }, (id) => findDraft(id) !== null);
  const aiEnabled = useMemo(() => getAiProvider() !== null, []);

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
    async (snapshot: DraftState = stateRef.current): Promise<boolean> => {
      if (!persistence.available) return false;
      const result = await persistence.flush(snapshot);
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

  const retryStorage = useCallback(async () => {
    await persistence.retryUnpersistedMedia();
    const ok = await persist();
    if (ok) showToast("端末内（ブラウザ）に保存しました");
  }, [persistence, persist, showToast]);

  /* ---------- AI (not wired in this version) ---------- */

  const retryGenerate = useCallback(
    async (draftId: string) => {
      const provider = getAiProvider();
      const draft = findDraftIn(stateRef.current, draftId);
      if (!provider || !draft?.media) return;
      const image = await persistence.getMedia(draft.media.id);
      if (!image) return;
      await runGeneration({ provider, draftId, image, tags: draft.tags, dispatch });
    },
    [persistence],
  );

  /* ---------- recording (FR-02) ---------- */

  const captureFile = useCallback(
    async (file: File, fallbackKind: MediaKind) => {
      const draftId = stateRef.current.current.id;
      const kind = kindOf(file, fallbackKind);
      const media: Media = {
        id: newId(),
        kind,
        mime: file.type || (kind === "photo" ? "image/jpeg" : "video/mp4"),
        name: file.name,
        size: file.size,
        saveStatus: "unsaved",
      };

      // Store the blob first; the draft only points at it once it is in the media store.
      const stored = await persistence.putMedia(media.id, file);
      if (!stored.persisted && persistence.available) setStorageProblem({ kind: "write" });

      const current = stateRef.current.current;
      if (current.id !== draftId) {
        // The user moved on while the file was being stored; never attach it to another draft.
        persistence.queueMediaDelete(media.id);
        return;
      }
      if (current.media) persistence.queueMediaDelete(current.media.id);
      dispatch({ type: "mediaCaptured", draftId, media });
    },
    [persistence],
  );

  /* ---------- save to device (FR-03) ---------- */

  const saveMedia = useCallback(
    async (draftId: string, mode: "auto" | "download" = "auto") => {
      if (saveBusyRef.current) return;
      const media = findDraftIn(stateRef.current, draftId)?.media;
      if (!media) return;

      // Prefer the blob that is already in memory so the share sheet is opened
      // while the tap's user activation is still valid.
      const blob = persistence.peekMedia(media.id) ?? (await persistence.getMedia(media.id, { remember: true }));
      if (!blob) {
        showToast(`${mediaNoun(media.kind)}を読み込めません。もう一度記録してください`);
        return;
      }

      saveBusyRef.current = true;
      setSaveBusy(true);
      try {
        const result = await saveToDevice(mediaToFile(blob, media), { mode });
        // Cancelled: nothing changed. Otherwise the user still has to confirm.
        if (result !== "cancelled") dispatch({ type: "saveHandedOff", draftId, mediaId: media.id });
      } catch {
        dispatch({ type: "saveFailed", draftId, mediaId: media.id });
      } finally {
        saveBusyRef.current = false;
        setSaveBusy(false);
      }
    },
    [persistence, showToast],
  );

  const confirmSaved = useCallback(
    (draftId: string, mediaId: string) => {
      dispatch({ type: "saveConfirmed", draftId, mediaId });
      const draft = findDraftIn(stateRef.current, draftId);
      if (draft && draft.bodySource !== "user") void retryGenerate(draftId);
    },
    [retryGenerate],
  );

  const saveAgain = useCallback(
    async (draftId: string, mediaId: string) => {
      dispatch({ type: "saveDeclined", draftId, mediaId });
      await saveMedia(draftId);
    },
    [saveMedia],
  );

  /* ---------- 次の投稿へ (FR-10) ---------- */

  const goNext = useCallback(async () => {
    if (nextBusyRef.current) return;
    nextBusyRef.current = true;
    try {
      const current = stateRef.current.current;
      const blocker = nextDraftBlocker(current);

      if (blocker === "empty") {
        showToast("まだ記録も投稿文もありません。入力してから次へ進めます");
        return;
      }
      if (blocker) {
        const noun = current.media ? mediaNoun(current.media.kind) : "記録";
        document.getElementById("step-record")?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (blocker === "media-confirming") {
          showToast(`${noun}を端末に保存できたか、「記録」の下で確認してください`);
        } else {
          const retry = blocker === "media-failed";
          showToast(
            retry
              ? `${noun}を端末に保存できていません。もう一度保存してください`
              : `${noun}がまだ端末に保存されていません。保存してから次へ進めます`,
            { label: retry ? "再試行" : "端末に保存", run: () => void saveMedia(current.id) },
          );
        }
        return;
      }

      // FR-10: never move on (and never drop the draft from the screen) unless the
      // result is safely stored on the device: the saved draft, the empty new one
      // and the app state are written first, then the screen switches. Without any
      // storage the app runs in memory only and says so, so there is nothing to wait for.
      const action: DraftAction = { type: "nextDraft", now: Date.now() };
      if (persistence.available) {
        await persistence.retryUnpersistedMedia();
        const ok = await persist(draftReducer(stateRef.current, action));
        if (!ok) {
          showToast("投稿案を端末内に保存できなかったため、次へ進めません。空き容量を確認して再試行してください", {
            label: "再試行",
            run: () => void goNextRef.current(),
          });
          return;
        }
      }

      dispatch(action);
      window.scrollTo({ top: 0 });
      showToast(`${current.index}本目を保存しました。タグは引き継ぎます`);
    } finally {
      nextBusyRef.current = false;
    }
  }, [persistence, persist, saveMedia, showToast]);

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
        showToast("共有できませんでした。「Xで開く」から本文だけ渡せます");
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
    captureKind,
    setCaptureKind,
    saveBusy,
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
