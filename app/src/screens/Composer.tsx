import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowsClockwiseIcon,
  CameraIcon,
  CaretRightIcon,
  PlusIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useApp } from "../app/context.ts";
import { useMedia } from "../app/useMedia.ts";
import { Footer, PostCounter, Sheet, Step, ComposerHeader } from "../components/chrome.tsx";
import { DeviceSaveStatus, MediaFrame, mediaNoun } from "../components/media.tsx";
import { composeDraftPost, xWeightedLength, type MediaKind } from "../lib/draft.ts";

export function Composer() {
  const { state, nav } = useApp();
  const { current, history } = state;
  const picker = useRecordPicker();

  return (
    <>
      <ComposerHeader />
      <main className="screen composer" key={current.id}>
        <div className="draft-meta">
          <span>{current.index}本目の投稿案</span>
          <button type="button" className="meta-link" onClick={() => nav.push({ view: "history" })}>
            保存した投稿案 {history.length}
            <CaretRightIcon size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <Step number={1} title="ハッシュタグ" titleId="step-tags-title" aside="複数可・次の投稿に引き継ぎ">
          <TagField />
        </Step>

        <Step
          id="step-record"
          number={2}
          title="記録"
          titleId="step-record-title"
          action={<RecordControls openPicker={picker.open} />}
        >
          <MediaBlock openPicker={picker.open} />
          <AutoSummarySetting />
        </Step>

        <Step number={3} title="投稿文" titleId="step-body-title" aside={<GenerationLabel />}>
          <BodyField />
        </Step>

        <Step
          number={4}
          title="開発者をポストに含める"
          titleId="step-developer-title"
          helper="ONで本文末尾に「開発者：」を追加"
          action={<DeveloperToggle />}
        />
      </main>
      {picker.inputs}
      {picker.confirmDialog}
      <ComposerFooter />
    </>
  );
}

function ComposerFooter() {
  const { state, saveBusy, captureBusy, openPostSheet } = useApp();
  const { current } = state;
  const ready =
    current.body.trim().length > 0 && current.generation !== "generating" && !saveBusy && captureBusy === null;
  return (
    <Footer>
      <button type="button" className="primary-button" disabled={!ready} onClick={() => openPostSheet(current.id)}>
        ポスト確認
      </button>
    </Footer>
  );
}

/* ---------- ① hashtags (FR-01) ---------- */

function TagField() {
  const { state, dispatch } = useApp();
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
            <XIcon size={14} weight="bold" aria-hidden="true" />
          </button>
        </span>
      ))}
      <label className="tag-input">
        <PlusIcon size={16} aria-hidden="true" />
        <input
          value={input}
          placeholder="タグを追加"
          aria-label="ハッシュタグを追加"
          enterKeyHint="done"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Space/Enter commit the tag; skip while an IME composition is active.
            if ((event.key === "Enter" || event.key === " ") && !event.nativeEvent.isComposing) {
              event.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
        />
      </label>
      {tags.length === 0 ? <p className="field-note">イベントのハッシュタグを入力してください</p> : null}
    </div>
  );
}

/* ---------- ② record (FR-02, FR-03) ---------- */

const PICKER_ACCEPT = { photo: "image/*", video: "video/*" } as const;

// Two hidden pickers, one per kind, so the OS opens the matching camera UI (FR-02).
// Choosing nothing (cancel) never fires onChange, so the draft stays untouched.
function useRecordPicker() {
  const { state, captureKind, captureFile } = useApp();
  const inputs = { photo: useRef<HTMLInputElement>(null), video: useRef<HTMLInputElement>(null) };
  const media = state.current.media;
  const [confirming, setConfirming] = useState(false);

  // The picker has to be opened straight from a tap (user activation), so both the
  // direct path and the confirmation button call this synchronously.
  const openFilePicker = () => inputs[captureKind].current?.click();

  const open = () => {
    // Re-recording replaces what the draft holds. If the old file never reached the
    // device, make sure the user means it (NFR-02). This is an in-app dialog, not
    // window.confirm: in-app browsers (such as the X app's WebView) may suppress that.
    if (media && media.saveStatus !== "saved") {
      setConfirming(true);
      return;
    }
    openFilePicker();
  };

  const confirmDialog = (
    <Sheet
      open={confirming}
      onClose={() => setConfirming(false)}
      title="撮り直しますか？"
      description={`いまの${media ? mediaNoun(media.kind) : "記録"}はまだ端末に保存されていません。撮り直すと、アプリ内のこの記録は置き換わります（端末の写真アプリに保存済みのものは消えません）。`}
    >
      <div className="sheet-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setConfirming(false);
            openFilePicker();
          }}
        >
          撮り直す
        </button>
        <button type="button" className="text-button" onClick={() => setConfirming(false)}>
          やめる
        </button>
      </div>
    </Sheet>
  );

  const onPicked = (kind: MediaKind) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same file again still fires
    if (file) void captureFile(file, kind);
  };

  const hidden = (["photo", "video"] as const).map((kind) => (
    <input
      key={kind}
      ref={inputs[kind]}
      className="visually-hidden"
      type="file"
      accept={PICKER_ACCEPT[kind]}
      capture="environment"
      tabIndex={-1}
      aria-hidden="true"
      data-testid={`pick-${kind}`}
      onChange={onPicked(kind)}
    />
  ));

  return { open, inputs: hidden, confirmDialog };
}

function RecordControls({ openPicker }: { openPicker: () => void }) {
  const { captureKind, setCaptureKind, saveBusy, captureBusy } = useApp();

  return (
    <div className="record-controls">
      <button type="button" className="outline-button" onClick={openPicker} disabled={saveBusy || captureBusy !== null}>
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

function MediaBlock({ openPicker }: { openPicker: () => void }) {
  const { state, persistence, captureKind, saveBusy, captureBusy, saveMedia, confirmSaved, saveAgain } = useApp();
  const draft = state.current;
  const media = draft.media;
  const view = useMedia(persistence, media?.id, { remember: true });
  const importing =
    captureBusy !== null ? (
      <div className="save-box" aria-live="polite" role="status">
        <p className="status-line">
          <ArrowsClockwiseIcon size={20} className="spin" aria-hidden="true" />
          {mediaNoun(captureBusy)}を取り込んでいます…
        </p>
      </div>
    ) : null;

  if (!media) {
    return (
      <>
        <button type="button" className="media-empty" onClick={openPicker} disabled={saveBusy || captureBusy !== null}>
          <CameraIcon size={28} aria-hidden="true" />
          <span className="media-empty-title">LTのスライドや様子を記録</span>
          <span className="media-empty-note">
            {captureKind === "video" ? "動画" : "写真"}を撮ったら、「端末に保存」で写真アプリへ保存します
          </span>
        </button>
        {importing}
      </>
    );
  }

  return (
    <div className="media">
      <MediaFrame media={media} view={view} missingHint="「記録する」からもう一度選び直してください。" />
      {importing}
      <DeviceSaveStatus
        media={media}
        busy={saveBusy}
        ready={view?.status === "ready"}
        onSave={() => void saveMedia(draft.id)}
        onSaveByDownload={() => void saveMedia(draft.id, "download")}
        onConfirm={() => confirmSaved(draft.id, media.id)}
        onAgain={() => void saveAgain(draft.id, media.id)}
      />
    </div>
  );
}

/* ---------- ③ post text (FR-05, FR-06) ---------- */

function AutoSummarySetting() {
  const { aiStatus, autoSummary, setAutoSummary, state, retryGenerate } = useApp();
  return (
    <div className="auto-summary-setting">
      <label className="auto-summary-label">
        <input type="checkbox" checked={aiStatus.available && autoSummary} disabled={!aiStatus.available} onChange={event => setAutoSummary(event.target.checked)} />
        写真から自動で投稿文をつくる
      </label>
      <p className="field-note">
        {aiStatus.available
          ? "写真の縮小コピーをAIへ送信します。原本と投稿案は端末内に残ります。"
          : aiStatus.reason === "checking"
            ? "自動作成の接続を確認しています…"
            : "現在、自動作成を利用できません。写真と投稿案を残して、手入力で進められます。"}
      </p>
      {state.current.media?.kind === "video" ? <p className="field-note">動画は冒頭の静止画から文章を作ります。音声や発表全体の要約ではありません。</p> : null}
      {aiStatus.available && state.current.media && state.current.generation !== "generating" ? (
        <button className="outline-button" type="button" onClick={() => void retryGenerate(state.current.id)}>
          {state.current.body ? "投稿文を作り直す" : "投稿文をつくる"}
        </button>
      ) : null}
    </div>
  );
}

function GenerationLabel() {
  const { state, aiEnabled } = useApp();
  // No provider, no AI wording: the label only exists once a provider is plugged in.
  if (!aiEnabled) return null;
  const { generation, bodySource } = state.current;
  if (generation === "generating") return <>AIで生成中…</>;
  if (bodySource === "user") return <>編集済み</>;
  if (bodySource === "ai" && generation === "done") return <>AIで生成</>;
  return null;
}

function BodyField() {
  const { state, dispatch, aiEnabled, retryGenerate } = useApp();
  const draft = state.current;
  const count = xWeightedLength(composeDraftPost(draft));
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the text (field-sizing is not available in every mobile browser yet).
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft.body, draft.generation]);

  return (
    <div className="body-field">
      {aiEnabled && (draft.generation === "failed" || draft.generation === "quota") ? (
        <div className="notice is-error" role="alert">
          <WarningCircleIcon size={20} weight="fill" aria-hidden="true" />
          <div>
            <p>
              {draft.generation === "quota"
                ? "利用上限に達しました。時間をおいて再試行するか、手入力してください。"
                : "投稿文を作成できませんでした。記録はそのまま残っています。"}
            </p>
            <button type="button" className="inline-action" onClick={() => void retryGenerate(draft.id)}>
              再試行
            </button>
          </div>
        </div>
      ) : null}
      {aiEnabled && draft.generation === "generating" ? (
        <p className="field-note" role="status" aria-live="polite">投稿文を作成中です。先に編集することもできます。</p>
      ) : null}
      <textarea
        ref={textRef}
        className="text-box"
        rows={3}
        value={draft.body}
        aria-label="投稿文"
        placeholder={aiEnabled ? "写真を選ぶと投稿文が入ります。手入力もできます。" : "このLTの内容を入力（100文字程度が目安）"}
        onChange={(event) => dispatch({ type: "setBody", body: event.target.value })}
      />
      <PostCounter count={count} />
    </div>
  );
}

/* ---------- ④ developer (FR-07) ---------- */

function DeveloperToggle() {
  const { state, dispatch } = useApp();
  const on = state.current.includeDeveloper;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby="step-developer-title"
      className="switch"
      onClick={() => dispatch({ type: "setIncludeDeveloper", value: !on })}
    >
      <span className="switch-thumb" />
    </button>
  );
}
