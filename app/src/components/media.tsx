import {
  ArrowsClockwiseIcon,
  PlayIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { MediaView } from "../app/useMedia.ts";
import type { Media, MediaKind } from "../lib/draft.ts";

export const mediaNoun = (kind: MediaKind) => (kind === "video" ? "動画" : "写真");

export function MediaFrame({
  media,
  view,
  missingHint,
}: {
  media: Media;
  view: MediaView | null;
  missingHint: string;
}) {
  const noun = mediaNoun(media.kind);

  if (!view || view.status === "loading") {
    return <div className="media-frame is-placeholder" aria-busy="true" aria-label={`${noun}を読み込み中`} />;
  }
  if (view.status === "error") {
    return (
      <div className="media-frame is-placeholder is-missing" role="alert">
        <WarningCircleIcon size={22} weight="fill" aria-hidden="true" />
        <p>{noun}を読み込めませんでした。一時的なエラーかもしれません。保存した{noun}は消えていません。</p>
        <div className="save-actions">
          <button type="button" className="small-button" onClick={view.retry}>
            再試行
          </button>
          <button type="button" className="small-button" onClick={() => window.location.reload()}>
            再読込
          </button>
        </div>
      </div>
    );
  }
  if (view.status === "missing") {
    return (
      <div className="media-frame is-placeholder is-missing" role="alert">
        <WarningCircleIcon size={22} weight="fill" aria-hidden="true" />
        <p>
          {noun}をこのブラウザの保存領域から読み込めませんでした。{missingHint}
        </p>
      </div>
    );
  }
  return (
    <figure className="media-frame">
      {media.kind === "video" ? (
        <video src={view.url} controls playsInline preload="metadata" aria-label="記録した動画" />
      ) : (
        <img src={view.url} alt="記録した写真" draggable={false} />
      )}
    </figure>
  );
}

// Thumbnail for lists. Videos show their first frame with a play badge.
export function MediaThumb({ media, view }: { media: Media | null; view: MediaView | null }) {
  if (!media) return <span className="draft-thumb is-empty" aria-hidden="true" />;
  if (!view || view.status !== "ready") {
    return <span className="draft-thumb is-empty" aria-hidden="true" />;
  }
  return (
    <span className="draft-thumb-wrap">
      {media.kind === "video" ? (
        <>
          <video className="draft-thumb" src={`${view.url}#t=0.1`} preload="metadata" muted playsInline />
          <PlayIcon size={14} weight="fill" className="thumb-play" aria-label="動画" />
        </>
      ) : (
        <img className="draft-thumb" src={view.url} alt="" draggable={false} />
      )}
    </span>
  );
}

/** Optional export; photo-library confirmation never gates draft progression. */
export function DeviceSaveStatus({ media, busy, onSave, onSaveByDownload, ready = true }: {
  media: Media; busy: boolean; ready?: boolean;
  onSave?: () => void; onSaveByDownload?: () => void;
  onConfirm?: () => void; onAgain?: () => void;
}) {
  return <div className="save-box" aria-live="polite">
    {busy ? <p className="status-line"><ArrowsClockwiseIcon size={20} className="spin" aria-hidden="true" />保存操作を開いています…<button type="button" className="small-button" disabled>端末に保存</button></p> : <>
      {media.saveStatus === "failed" ? <p className="status-line is-error"><WarningCircleIcon size={20} aria-hidden="true" />保存操作を開けませんでした。投稿の準備は続けられます。</p> : null}
      <div className="save-row">
        <p className="save-hint">写真アプリにも残す場合は、端末に保存できます。</p>
        {onSave ? <button type="button" className="small-button" onClick={onSave} disabled={!ready}>端末に保存</button> : null}
      </div>
      {media.saveStatus === "failed" && onSaveByDownload ? <button type="button" className="small-button" onClick={onSaveByDownload} disabled={!ready}>ダウンロードで保存</button> : null}
      {media.saveStatus === "confirming" ? <p className="save-hint">保存操作を開きました。そのまま投稿の準備を続けられます。</p> : null}
    </>}
  </div>;
}
