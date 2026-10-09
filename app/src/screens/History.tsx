import { CaretRightIcon, InfoIcon } from "@phosphor-icons/react";
import { useApp } from "../app/context.ts";
import { useMedia } from "../app/useMedia.ts";
import { BackHeader, Footer, PostCounter } from "../components/chrome.tsx";
import { DraftStatus, draftExcerpt } from "../components/draftBits.tsx";
import { DeviceSaveStatus, MediaFrame, MediaThumb } from "../components/media.tsx";
import { composeDraftPost, xWeightedLength, type Draft } from "../lib/draft.ts";

const DISCLAIMER = "X上で修正した内容や、投稿したかどうかは、ここには反映されません。";

export function History() {
  const { state, nav } = useApp();
  // Newest first.
  const drafts = [...state.history].sort((a, b) => b.index - a.index);

  return (
    <>
      <BackHeader title="保存した投稿案" onBack={nav.back} />
      <main className="screen history">
        <p className="screen-lead">この端末のブラウザに保存した投稿案です。{DISCLAIMER}</p>
        {drafts.length === 0 ? (
          <p className="empty-note">保存した投稿案はまだありません。「次の投稿へ」を押すと、ここに保存されます。</p>
        ) : (
          <ul className="draft-list">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <DraftRow draft={draft} />
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="about-button" onClick={() => nav.push({ view: "welcome" })}>
          <InfoIcon size={20} aria-hidden="true" />
          使い方とデータの扱い
        </button>
      </main>
    </>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  const { persistence, nav, aiEnabled } = useApp();
  const view = useMedia(persistence, draft.media?.id);

  return (
    <button
      type="button"
      className="draft-row"
      onClick={() => nav.push({ view: "detail", draftId: draft.id })}
      data-testid="draft-row"
    >
      <MediaThumb media={draft.media} view={view} />
      <span className="draft-row-text">
        <span className="draft-row-head">
          <strong>{draft.index}本目</strong>
          <DraftStatus draft={draft} aiEnabled={aiEnabled} />
        </span>
        <span className="draft-row-body">{draftExcerpt(draft, aiEnabled)}</span>
        <span className="draft-row-tags">{draft.tags.join(" ")}</span>
      </span>
      <CaretRightIcon size={16} weight="bold" className="row-caret" aria-hidden="true" />
    </button>
  );
}

export function DraftDetail({ draftId }: { draftId: string }) {
  const { findDraft, nav, persistence, aiEnabled, openPostSheet, retryGenerate } = useApp();
  const draft = findDraft(draftId);
  const media = draft?.media ?? null;
  const view = useMedia(persistence, media?.id);
  if (!draft) return null;

  const text = composeDraftPost(draft);
  const ready = draft.body.trim().length > 0 && draft.generation !== "generating";

  return (
    <>
      <BackHeader title={`${draft.index}本目の投稿案`} onBack={nav.back} />
      <main className="screen detail">
        {media ? (
          <div className="media">
            <MediaFrame
              media={media}
              view={view}
              missingHint="Xで共有するときは、端末の写真アプリから選んで添付してください。"
            />
            <DeviceSaveStatus media={media} busy={false} />
          </div>
        ) : null}
        <div className="detail-status">
          <DraftStatus draft={draft} aiEnabled={aiEnabled} />
          <span className="muted">
            {draft.openedInX ? "Xの投稿画面を開きました。投稿したかどうかは記録しません。" : "まだXで確認していません。"}
          </span>
        </div>
        {aiEnabled && draft.generation === "generating" ? (
          <p className="notice">投稿文を生成しています。完了するとこの投稿案に入ります。</p>
        ) : null}
        {aiEnabled && (draft.generation === "failed" || draft.generation === "quota") ? (
          <div className="notice is-error" role="alert">
            <div>
              <p>投稿文を作成できませんでした。記録はそのまま残っています。</p>
              <button type="button" className="inline-action" onClick={() => void retryGenerate(draft.id)}>
                再試行
              </button>
            </div>
          </div>
        ) : null}
        <pre className="post-preview" aria-label="保存した投稿案の本文">
          {text}
        </pre>
        <PostCounter count={xWeightedLength(text)} />
        <p className="detail-note">この端末に保存した投稿案です。{DISCLAIMER}</p>
      </main>
      <Footer>
        <button type="button" className="primary-button" disabled={!ready} onClick={() => openPostSheet(draft.id)}>
          もう一度ポスト確認
        </button>
      </Footer>
    </>
  );
}
