import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CameraIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  PlayIcon,
  PlusIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  BottomSheet,
  FlowStack,
  KeyboardInput,
  KeyboardTextarea,
  MobileScroll,
  useFlow,
  useKeyboard,
  useMobileDevice,
  type FlowScreen,
} from "./mobile";
import {
  X_POST_LIMIT,
  canMoveToNextDraft,
  composePost,
  draftReducer,
  isEmptyDraft,
  xWeightedLength,
  type Draft,
  type DraftAction,
  type DraftState,
  type Media,
  type MediaKind,
} from "./lib/draft";
import { generatedTextForIndex, initialDraftState, photoForIndex } from "./mockData";

// Screen mock for LT Share on X. Camera, device storage, ChatGPT and X are
// simulated with timers; see docs/DESIGN.md for what is real and what is not.

type AiMode = "ok" | "failed" | "quota";

type MockSettings = {
  failNextSave: boolean;
  nextAi: AiMode;
};

type App = {
  state: DraftState;
  dispatch: Dispatch<DraftAction>;
  captureKind: MediaKind;
  setCaptureKind: (kind: MediaKind) => void;
  openCamera: () => void;
  openHandoff: (draftId: string) => void;
  goNext: () => void;
  retrySave: () => void;
  retryGenerate: (draftId: string) => void;
  showToast: (message: string) => void;
  mock: MockSettings;
  setMock: (next: MockSettings) => void;
};

const AppContext = createContext<App | null>(null);

function useApp() {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp must be used inside Prototype");
  return app;
}

function findDraft(state: DraftState, draftId: string | null): Draft | null {
  if (!draftId) return null;
  if (state.current.id === draftId) return state.current;
  return state.history.find((draft) => draft.id === draftId) ?? null;
}

function postTextOf(draft: Draft) {
  return composePost({ body: draft.body, tags: draft.tags, includeDeveloper: draft.includeDeveloper });
}

export default function Prototype() {
  const [state, dispatch] = useReducer(draftReducer, initialDraftState);
  const [captureKind, setCaptureKind] = useState<MediaKind>("photo");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [mock, setMockState] = useState<MockSettings>({ failNextSave: false, nextAi: "ok" });
  const mockRef = useRef(mock);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setMock = useCallback((next: MockSettings) => {
    mockRef.current = next;
    setMockState(next);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast({ id: Date.now(), message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const startGeneration = useCallback((draftId: string, index: number) => {
    dispatch({ type: "generateStart", draftId });
    window.setTimeout(() => {
      const mode = mockRef.current.nextAi;
      if (mode !== "ok") setMock({ ...mockRef.current, nextAi: "ok" });
      if (mode === "ok") {
        dispatch({ type: "generateDone", draftId, text: generatedTextForIndex(index) });
      } else {
        dispatch({ type: "generateFailed", draftId, reason: mode });
      }
    }, 1800);
  }, [setMock]);

  const saveMedia = useCallback(
    (kind: MediaKind, durationSec?: number) => {
      const { id, index } = stateRef.current.current;
      const media: Media = { kind, src: photoForIndex(index), saveStatus: "saving", durationSec };
      dispatch({ type: "mediaCaptured", media });
      window.setTimeout(() => {
        const ok = !mockRef.current.failNextSave;
        if (!ok) setMock({ ...mockRef.current, failNextSave: false });
        dispatch({ type: "mediaSaveResult", ok });
        if (!ok) return;
        // Keep text the user wrote; only summarize when the body is empty or AI-written.
        if (stateRef.current.current.bodySource === "user") {
          showToast("入力済みの本文はそのまま残しています");
          return;
        }
        startGeneration(id, index);
      }, 900);
    },
    [setMock, showToast, startGeneration],
  );

  const app: App = {
    state,
    dispatch,
    captureKind,
    setCaptureKind,
    openCamera: () => {
      setToast(null);
      setCameraOpen(true);
    },
    openHandoff: (draftId) => setHandoffId(draftId),
    goNext: () => {
      const current = stateRef.current.current;
      if (isEmptyDraft(current)) {
        showToast("まだ記録がありません。記録してから次へ進めます");
        return;
      }
      if (!canMoveToNextDraft(current)) {
        showToast(
          current.media?.saveStatus === "saving"
            ? "端末に保存中です。保存が終わるまでお待ちください"
            : "記録が端末に保存されていません。再試行してください",
        );
        return;
      }
      dispatch({ type: "nextDraft" });
      showToast(`${current.index}本目を保存しました。タグは引き継ぎます`);
    },
    retrySave: () => {
      const media = stateRef.current.current.media;
      if (media) saveMedia(media.kind, media.durationSec);
    },
    retryGenerate: (draftId) => {
      const draft = findDraft(stateRef.current, draftId);
      if (draft) startGeneration(draft.id, draft.index);
    },
    showToast,
    mock,
    setMock,
  };

  return (
    <AppContext.Provider value={app}>
      <FlowStack initial={composerScreen} />
      <HandoffSheet draftId={handoffId} onClose={() => setHandoffId(null)} />
      {cameraOpen ? (
        <CameraOverlay
          kind={captureKind}
          viewfinder={photoForIndex(state.current.index)}
          onKindChange={setCaptureKind}
          onCancel={() => setCameraOpen(false)}
          onCapture={(kind, durationSec) => {
            setCameraOpen(false);
            saveMedia(kind, durationSec);
          }}
        />
      ) : null}
      {toast ? (
        <div key={toast.id} className="toast" role="status">
          {toast.message}
        </div>
      ) : null}
    </AppContext.Provider>
  );
}

/* ---------- Screens ---------- */

const composerScreen: FlowScreen = {
  id: "composer",
  headerHeight: 56,
  header: () => <ComposerHeader />,
  footerHeight: 70,
  footer: () => <ComposerFooter />,
  render: () => <ComposerBody />,
};

const historyScreen: FlowScreen = {
  id: "history",
  headerHeight: 56,
  header: (flow) => <BackHeader title="保存した投稿案" onBack={flow.pop} />,
  render: () => <HistoryBody />,
};

function draftDetailScreen(draftId: string): FlowScreen {
  return {
    id: `draft-${draftId}`,
    headerHeight: 56,
    header: (flow) => <DraftDetailHeader draftId={draftId} onBack={flow.pop} />,
    footerHeight: 70,
    footer: () => <DraftDetailFooter draftId={draftId} />,
    render: () => <DraftDetailBody draftId={draftId} />,
  };
}

const welcomeScreen: FlowScreen = {
  id: "welcome",
  footerHeight: 70,
  footer: (flow) => <WelcomeFooter onDone={flow.pop} />,
  render: () => <WelcomeBody />,
};

function ComposerHeader() {
  const { goNext } = useApp();
  return (
    <div className="app-header">
      <h1 className="app-title">LT Share on X</h1>
      <button type="button" className="header-action" onClick={goNext}>
        次の投稿へ
        <CaretRightIcon size={18} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

function ComposerFooter() {
  const { state, openHandoff } = useApp();
  const { current } = state;
  const ready =
    current.body.trim().length > 0 &&
    current.generation !== "generating" &&
    current.media?.saveStatus !== "saving";
  return (
    <div className="app-footer">
      <button
        type="button"
        className="primary-button"
        disabled={!ready}
        onClick={() => openHandoff(current.id)}
      >
        ポスト確認
      </button>
    </div>
  );
}

function ComposerBody() {
  const { state } = useApp();
  const flow = useFlow();
  const keyboard = useKeyboard();
  const contentRef = useRef<HTMLElement>(null);
  const { current, history } = state;

  useLayoutEffect(() => {
    const field = keyboard.focusedElement;
    const scroll = contentRef.current?.closest<HTMLElement>(".mobile-scroll");
    if (!keyboard.visible || !field || !scroll || !contentRef.current?.contains(field)) return;

    const keepVisible = () => {
      const viewport = scroll.getBoundingClientRect();
      const scale = viewport.height / scroll.clientHeight;
      if (!scale) return;
      const footerHeight =
        Number.parseFloat(getComputedStyle(scroll).getPropertyValue("--flow-footer-height")) || 0;
      const top = viewport.top + 12 * scale;
      const bottom = viewport.bottom - (footerHeight + 12) * scale;
      const bounds = field.getBoundingClientRect();
      const delta =
        bounds.height > bottom - top || bounds.top < top
          ? bounds.top - top
          : Math.max(0, bounds.bottom - bottom);
      scroll.scrollTop += delta / scale;
    };

    const observer = new ResizeObserver(keepVisible);
    observer.observe(scroll);
    observer.observe(field);
    keepVisible();
    return () => observer.disconnect();
  }, [keyboard.visible, keyboard.focusedElement, current.id]);

  return (
    <MobileScroll key={current.id} className="app-screen">
      <main ref={contentRef} className="screen composer">
        <div className="draft-meta">
          <span>{current.index}本目の投稿案</span>
          <button type="button" className="meta-link" onClick={() => flow.push(historyScreen)}>
            保存した投稿案 {history.length}
            <CaretRightIcon size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <Step number={1} title="ハッシュタグ" aside="複数可・次の投稿に引き継ぎ">
          <TagField />
        </Step>

        <Step number={2} title="記録" action={<RecordControls />}>
          <MediaBlock />
        </Step>

        <Step number={3} title="投稿文" aside={<GenerationLabel />}>
          <BodyField />
        </Step>

        <Step
          number={4}
          title="開発者をポストに含める"
          helper="ONで本文末尾に「開発者：」を追加"
          action={<DeveloperToggle />}
        />
      </main>
    </MobileScroll>
  );
}

function Step({
  number,
  title,
  aside,
  helper,
  action,
  children,
}: {
  number: number;
  title: string;
  aside?: ReactNode;
  helper?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const titleId = `step-${number}-title`;
  return (
    <section className="step" aria-labelledby={titleId}>
      <div className="step-head">
        <span className="step-number" aria-hidden="true">
          {number}
        </span>
        <div className="step-heading">
          <h2 id={titleId} className="step-title">
            {title}
          </h2>
          {helper ? <p className="step-helper">{helper}</p> : null}
        </div>
        {aside ? <span className="step-aside">{aside}</span> : null}
        {action}
      </div>
      {children}
    </section>
  );
}

function TagField() {
  const { state, dispatch } = useApp();
  const keyboard = useKeyboard();
  const [input, setInput] = useState("");
  const tags = state.current.tags;

  const commit = () => {
    if (input.trim()) dispatch({ type: "addTags", input });
    setInput("");
  };

  return (
    <div className="tag-field">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button
            type="button"
            className="tag-remove"
            aria-label={`${tag}を外す`}
            onClick={() => dispatch({ type: "removeTag", tag })}
          >
            <XIcon size={12} weight="bold" aria-hidden="true" />
          </button>
        </span>
      ))}
      <label className="tag-input">
        <PlusIcon size={16} aria-hidden="true" />
        <KeyboardInput
          value={input}
          placeholder="タグを追加"
          aria-label="ハッシュタグを追加"
          enterKeyHint="done"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              commit();
            }
          }}
          onBlur={() => {
            commit();
            keyboard.hide();
          }}
        />
      </label>
      {tags.length === 0 ? <p className="field-note">イベントのハッシュタグを入力してください</p> : null}
    </div>
  );
}

function RecordControls() {
  const { state, captureKind, setCaptureKind, openCamera } = useApp();
  // NFR-01: no second recording while the previous one is still saving or being summarized.
  const busy = state.current.media?.saveStatus === "saving" || state.current.generation === "generating";
  return (
    <div className="record-controls">
      <button type="button" className="outline-button" onClick={openCamera} disabled={busy}>
        <CameraIcon size={20} aria-hidden="true" />
        記録する
      </button>
      <div className="segmented" role="radiogroup" aria-label="記録の種類">
        {(["photo", "video"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={captureKind === kind}
            className="segment"
            onClick={() => setCaptureKind(kind)}
          >
            {kind === "photo" ? "写真" : "動画"}
          </button>
        ))}
      </div>
    </div>
  );
}

function MediaBlock() {
  const { state, openCamera, retrySave } = useApp();
  const media = state.current.media;

  if (!media) {
    return (
      <button type="button" className="media-empty" onClick={openCamera}>
        <CameraIcon size={28} aria-hidden="true" />
        <span className="media-empty-title">LTのスライドや様子を記録</span>
        <span className="media-empty-note">撮影した写真・動画は端末に保存されます</span>
      </button>
    );
  }

  return (
    <div className="media">
      <figure className="media-frame">
        <img src={media.src} alt={mediaAlt(media)} draggable={false} />
        <VideoBadge media={media} />
      </figure>
      <SaveStatusLine status={media.saveStatus} onRetry={retrySave} />
    </div>
  );
}

function mediaAlt(media: Media) {
  return media.kind === "photo" ? "記録した写真" : "記録した動画";
}

function formatDuration(seconds = 0) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function VideoBadge({ media }: { media: Media }) {
  if (media.kind !== "video") return null;
  return (
    <span className="video-badge">
      <PlayIcon size={12} weight="fill" aria-hidden="true" />
      {formatDuration(media.durationSec)}
    </span>
  );
}

function SaveStatusLine({ status, onRetry }: { status: "saving" | "saved" | "failed"; onRetry?: () => void }) {
  if (status === "saving") {
    return (
      <p className="status-line">
        <ArrowsClockwiseIcon size={18} className="spin" aria-hidden="true" />
        端末に保存中…
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p className="status-line is-error">
        <WarningCircleIcon size={18} weight="fill" aria-hidden="true" />
        端末に保存できませんでした
        {onRetry ? (
          <button type="button" className="inline-action" onClick={onRetry}>
            再試行
          </button>
        ) : null}
      </p>
    );
  }
  return (
    <p className="status-line">
      <CheckCircleIcon size={18} weight="fill" className="status-ok" aria-hidden="true" />
      端末に保存済み
    </p>
  );
}

function GenerationLabel() {
  const { state } = useApp();
  const { generation, bodySource } = state.current;
  if (generation === "generating") return <>ChatGPTで生成中…</>;
  if (bodySource === "user") return <>編集済み</>;
  if (bodySource === "ai" && generation === "done") return <>ChatGPTで生成</>;
  return null;
}

function BodyField() {
  const { state, dispatch, retryGenerate } = useApp();
  const keyboard = useKeyboard();
  const draft = state.current;
  const count = xWeightedLength(postTextOf(draft));

  return (
    <div className="body-field">
      {draft.generation === "failed" || draft.generation === "quota" ? (
        <div className="notice is-error" role="alert">
          <WarningCircleIcon size={18} weight="fill" aria-hidden="true" />
          <div>
            <p>
              {draft.generation === "quota"
                ? "ChatGPTの利用上限に達しました。時間をおいて再試行するか、手入力してください。"
                : "投稿文を作成できませんでした。記録はそのまま残っています。"}
            </p>
            <button type="button" className="inline-action" onClick={() => retryGenerate(draft.id)}>
              再試行
            </button>
          </div>
        </div>
      ) : null}
      {draft.generation === "generating" ? (
        <div className="text-box is-loading" aria-busy="true" aria-label="投稿文を生成中">
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton short" />
        </div>
      ) : (
        <KeyboardTextarea
          className="text-box"
          rows={3}
          value={draft.body}
          aria-label="投稿文"
          placeholder={draft.media ? "投稿文を入力" : "記録すると、ここに投稿文が作成されます。手入力もできます"}
          onChange={(event) => dispatch({ type: "setBody", body: event.target.value })}
          onBlur={() => keyboard.hide()}
        />
      )}
      <PostCounter count={count} />
    </div>
  );
}

function PostCounter({ count }: { count: number }) {
  const over = count > X_POST_LIMIT;
  return (
    <>
      <p className={`counter${over ? " is-over" : ""}`}>
        X換算 {count} / {X_POST_LIMIT}
      </p>
      {over ? (
        <p className="over-note" role="alert">
          Xの上限を超えています。本文を短くするか、タグを減らしてください。
        </p>
      ) : null}
    </>
  );
}

function DeveloperToggle() {
  const { state, dispatch } = useApp();
  const on = state.current.includeDeveloper;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby="step-4-title"
      className="switch"
      onClick={() => dispatch({ type: "setIncludeDeveloper", value: !on })}
    >
      <span className="switch-thumb" />
    </button>
  );
}

/* ---------- Saved drafts ---------- */

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="app-header is-sub">
      <button type="button" className="back-button" onClick={onBack} aria-label="戻る">
        <CaretLeftIcon size={22} weight="bold" aria-hidden="true" />
      </button>
      <h1 className="sub-title">{title}</h1>
      <span />
    </div>
  );
}

function DraftStatus({ draft }: { draft: Draft }) {
  return (
    <>
      {draft.openedInX ? <span className="badge">Xで開いた</span> : <span className="badge is-muted">未確認</span>}
      {draft.generation === "generating" ? <span className="badge is-muted">生成中</span> : null}
      {draft.generation === "failed" || draft.generation === "quota" ? (
        <span className="badge is-error">投稿文なし</span>
      ) : null}
    </>
  );
}

function draftExcerpt(draft: Draft) {
  if (draft.body.trim()) return draft.body;
  if (draft.generation === "generating") return "投稿文を生成しています…";
  if (draft.generation === "failed" || draft.generation === "quota") return "投稿文を作成できませんでした";
  return "（本文なし）";
}

function HistoryBody() {
  const { state, mock, setMock } = useApp();
  const flow = useFlow();
  const drafts = [...state.history].reverse();

  return (
    <MobileScroll className="app-screen">
      <main className="screen history">
        <p className="screen-lead">
          この端末に保存した投稿案です。X上で修正した本文や、投稿したかどうかはここに反映されません。
        </p>
        {drafts.length === 0 ? (
          <p className="empty-note">保存した投稿案はまだありません。</p>
        ) : (
          <ul className="draft-list">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <button type="button" className="draft-row" onClick={() => flow.push(draftDetailScreen(draft.id))}>
                  {draft.media ? (
                    <span className="draft-thumb-wrap">
                      <img className="draft-thumb" src={draft.media.src} alt="" draggable={false} />
                      {draft.media.kind === "video" ? (
                        <PlayIcon size={14} weight="fill" className="thumb-play" aria-label="動画" />
                      ) : null}
                    </span>
                  ) : (
                    <span className="draft-thumb is-empty" />
                  )}
                  <span className="draft-row-text">
                    <span className="draft-row-head">
                      <strong>{draft.index}本目</strong>
                      <DraftStatus draft={draft} />
                    </span>
                    <span className="draft-row-body">{draftExcerpt(draft)}</span>
                    <span className="draft-row-tags">{draft.tags.join(" ")}</span>
                  </span>
                  <CaretRightIcon size={16} weight="bold" className="row-caret" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <section className="mock-panel" aria-labelledby="mock-panel-title">
          <h2 id="mock-panel-title">モック操作</h2>
          <p>画面確認用です。実際のアプリには含まれません。</p>
          <div className="mock-row">
            <span>次の端末保存を失敗させる</span>
            <button
              type="button"
              role="switch"
              aria-checked={mock.failNextSave}
              aria-label="次の端末保存を失敗させる"
              className="switch"
              onClick={() => setMock({ ...mock, failNextSave: !mock.failNextSave })}
            >
              <span className="switch-thumb" />
            </button>
          </div>
          <div className="mock-row is-stacked">
            <span>次の投稿文生成</span>
            <div className="segmented" role="radiogroup" aria-label="次の投稿文生成">
              {(
                [
                  ["ok", "成功"],
                  ["failed", "失敗"],
                  ["quota", "利用上限"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mock.nextAi === value}
                  className="segment"
                  onClick={() => setMock({ ...mock, nextAi: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="outline-button is-wide" onClick={() => flow.push(welcomeScreen)}>
            初回の案内画面を見る
          </button>
        </section>
      </main>
    </MobileScroll>
  );
}

function DraftDetailHeader({ draftId, onBack }: { draftId: string; onBack: () => void }) {
  const { state } = useApp();
  const draft = findDraft(state, draftId);
  return <BackHeader title={draft ? `${draft.index}本目の投稿案` : "投稿案"} onBack={onBack} />;
}

function DraftDetailBody({ draftId }: { draftId: string }) {
  const { state, retryGenerate } = useApp();
  const draft = findDraft(state, draftId);
  if (!draft) return null;

  return (
    <MobileScroll className="app-screen">
      <main className="screen detail">
        {draft.media ? (
          <div className="media">
            <figure className="media-frame">
              <img src={draft.media.src} alt={mediaAlt(draft.media)} draggable={false} />
              <VideoBadge media={draft.media} />
            </figure>
            <SaveStatusLine status={draft.media.saveStatus} />
          </div>
        ) : null}
        <div className="detail-status">
          <DraftStatus draft={draft} />
          <span className="muted">
            {draft.openedInX ? "Xの投稿画面を開きました。投稿したかどうかは記録しません。" : "まだXで確認していません。"}
          </span>
        </div>
        {draft.generation === "generating" ? (
          <p className="notice">投稿文を生成しています。完了するとこの投稿案に入ります。</p>
        ) : null}
        {draft.generation === "failed" || draft.generation === "quota" ? (
          <div className="notice is-error" role="alert">
            <WarningCircleIcon size={18} weight="fill" aria-hidden="true" />
            <div>
              <p>
                {draft.generation === "quota"
                  ? "ChatGPTの利用上限に達したため、投稿文を作成できませんでした。"
                  : "投稿文を作成できませんでした。記録はそのまま残っています。"}
              </p>
              <button type="button" className="inline-action" onClick={() => retryGenerate(draft.id)}>
                再試行
              </button>
            </div>
          </div>
        ) : null}
        <pre className="post-preview">{postTextOf(draft)}</pre>
        <PostCounter count={xWeightedLength(postTextOf(draft))} />
      </main>
    </MobileScroll>
  );
}

function DraftDetailFooter({ draftId }: { draftId: string }) {
  const { state, openHandoff } = useApp();
  const draft = findDraft(state, draftId);
  const ready = draft !== null && draft.body.trim().length > 0 && draft.generation !== "generating";
  return (
    <div className="app-footer">
      <button type="button" className="primary-button" disabled={!ready} onClick={() => openHandoff(draftId)}>
        もう一度ポスト確認
      </button>
    </div>
  );
}

/* ---------- First run ---------- */

function WelcomeBody() {
  return (
    <MobileScroll className="app-screen">
      <main className="screen welcome">
        <h1 className="welcome-title">LT Share on X</h1>
        <p className="welcome-lead">LTを聞きながら、記録からXへの共有までを少ない操作で。</p>
        <ol className="welcome-steps">
          <li>
            <span className="step-number">1</span>
            イベントのハッシュタグを設定
          </li>
          <li>
            <span className="step-number">2</span>
            記録すると、投稿文をChatGPTで作成
          </li>
          <li>
            <span className="step-number">3</span>
            Xで確認して、あなたが投稿
          </li>
        </ol>
        <section className="welcome-notes" aria-label="データの扱い">
          <h2>データの扱い</h2>
          <ul>
            <li>写真・動画と投稿案は、この端末に保存します。</li>
            <li>投稿文の作成には、あなたのChatGPTの利用枠を使います。記録の一部をOpenAIに送ります。</li>
            <li>LT Share on X は、独自のサーバーやデータベースを持たない設計です。</li>
          </ul>
        </section>
      </main>
    </MobileScroll>
  );
}

function WelcomeFooter({ onDone }: { onDone: () => void }) {
  const { showToast } = useApp();
  return (
    <div className="app-footer">
      <button
        type="button"
        className="primary-button"
        onClick={() => {
          onDone();
          showToast("ChatGPTの利用許可は実アプリで行います（モック）");
        }}
      >
        ChatGPTで続ける
      </button>
    </div>
  );
}

/* ---------- Overlays ---------- */

function HandoffSheet({ draftId, onClose }: { draftId: string | null; onClose: () => void }) {
  const { state, dispatch, showToast } = useApp();
  const [lastId, setLastId] = useState<string | null>(draftId);
  if (draftId && draftId !== lastId) setLastId(draftId);
  // Keep rendering the last draft while the sheet animates out.
  const draft = findDraft(state, draftId ?? lastId);
  const text = draft ? postTextOf(draft) : "";
  const count = xWeightedLength(text);
  const mediaLabel = draft?.media?.kind === "video" ? "動画" : "写真";

  return (
    <BottomSheet
      open={draftId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="ポスト確認"
      description="この内容でXの投稿画面を開きます。投稿はXで行います。"
      snap={0.8}
    >
      {draft ? (
        <div className="handoff">
          <pre className="post-preview">{text}</pre>
          {draft.includeDeveloper ? (
            <p className="hint">「開発者：」の後は、Xで @ を入力して追加できます。</p>
          ) : null}
          <PostCounter count={count} />
          {draft.media ? (
            <div className={`attach-note${draft.media.saveStatus === "saved" ? "" : " is-error"}`}>
              <img src={draft.media.src} alt="" draggable={false} />
              <p>
                {draft.media.saveStatus === "saved"
                  ? `${mediaLabel}は端末に保存済みです。Xで自動添付されない場合は、写真アプリから選んで添付してください。`
                  : `${mediaLabel}は端末に保存できていません。Xには本文だけが渡ります。`}
              </p>
            </div>
          ) : null}
          <div className="sheet-actions">
            <button
              type="button"
              className="primary-button"
              disabled={count > X_POST_LIMIT}
              onClick={() => {
                dispatch({ type: "openedInX", draftId: draft.id });
                onClose();
                showToast("Xの投稿画面を開きました（モック）");
              }}
            >
              Xで開く
              <ArrowSquareOutIcon size={18} weight="bold" aria-hidden="true" />
            </button>
            <button type="button" className="text-button" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

function CameraOverlay({
  kind,
  viewfinder,
  onKindChange,
  onCancel,
  onCapture,
}: {
  kind: MediaKind;
  viewfinder: string;
  onKindChange: (kind: MediaKind) => void;
  onCancel: () => void;
  onCapture: (kind: MediaKind, durationSec?: number) => void;
}) {
  const { device } = useMobileDevice();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // The status bar sits on top of the dark camera UI; switch it to light content.
  useEffect(() => {
    document.documentElement.dataset.statusBar = "light";
    return () => {
      delete document.documentElement.dataset.statusBar;
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const onShutter = () => {
    if (kind === "photo") {
      onCapture("photo");
      return;
    }
    if (!recording) {
      setSeconds(0);
      setRecording(true);
      return;
    }
    setRecording(false);
    onCapture("video", Math.max(1, seconds));
  };

  return (
    <div className="camera" role="dialog" aria-label="カメラ">
      <div className="camera-top" style={{ marginTop: device.geometry.safeArea.top }}>
        <button type="button" className="camera-cancel" onClick={onCancel} disabled={recording}>
          キャンセル
        </button>
        {recording ? (
          <span className="camera-timer">
            <span className="rec-dot" />
            {formatDuration(seconds)}
          </span>
        ) : (
          <span className="camera-label">端末のカメラ（イメージ）</span>
        )}
        <span />
      </div>
      <div className="camera-viewfinder">
        <img src={viewfinder} alt="カメラのプレビュー" draggable={false} />
      </div>
      <div className="camera-bottom">
        <div className="camera-modes" role="radiogroup" aria-label="撮影モード">
          {(["video", "photo"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={kind === mode}
              className="camera-mode"
              disabled={recording}
              onClick={() => onKindChange(mode)}
            >
              {mode === "photo" ? "写真" : "動画"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`shutter is-${kind}${recording ? " is-recording" : ""}`}
          aria-label={kind === "photo" ? "撮影" : recording ? "録画を停止" : "録画を開始"}
          onClick={onShutter}
        >
          <span className="shutter-core" />
        </button>
      </div>
    </div>
  );
}
