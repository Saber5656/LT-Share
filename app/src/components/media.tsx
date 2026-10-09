import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  PlayIcon,
  QuestionIcon,
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

/**
 * FR-03: the page cannot tell whether a file really reached the photo library, so
 * "saved" is only ever shown after the user confirmed it themselves.
 */
export function DeviceSaveStatus({
  media,
  busy,
  onSave,
  onSaveByDownload,
  onConfirm,
  onAgain,
  ready = true,
}: {
  media: Media;
  busy: boolean;
  // False until the file is loaded: the buttons that open the share sheet stay disabled,
  // so navigator.share() can always be called synchronously from the tap (iOS).
  ready?: boolean;
  onSave?: () => void;
  onSaveByDownload?: () => void;
  onConfirm?: () => void;
  onAgain?: () => void;
}) {
  const noun = mediaNoun(media.kind);

  if (media.saveStatus === "saved") {
    return (
      <div className="save-box" aria-live="polite">
        <p className="status-line">
          <CheckCircleIcon size={20} weight="fill" className="status-ok" aria-hidden="true" />
          端末に保存済み
        </p>
      </div>
    );
  }

  if (busy) {
    return (
      <div className="save-box" aria-live="polite">
        <p className="status-line">
          <ArrowsClockwiseIcon size={20} className="spin" aria-hidden="true" />
          共有画面を開いています…
        </p>
      </div>
    );
  }

  if (media.saveStatus === "confirming") {
    return (
      <div className="save-box is-ask" aria-live="polite">
        <p className="status-line is-strong">
          <QuestionIcon size={20} weight="fill" aria-hidden="true" />
          写真アプリ（ギャラリー）に保存できましたか？
        </p>
        {onConfirm && onAgain ? (
          <div className="save-actions">
            <button type="button" className="small-button is-primary" onClick={onConfirm}>
              保存できた
            </button>
            <button type="button" className="small-button" onClick={onAgain} disabled={!ready}>
              もう一度
            </button>
          </div>
        ) : null}
        <p className="save-hint">
          共有画面の「{media.kind === "video" ? "ビデオを保存" : "画像を保存"}」を選ぶと、写真アプリに保存されます。ダウンロードした場合は、ファイルを写真アプリ（ギャラリー）に追加してください。
        </p>
      </div>
    );
  }

  if (media.saveStatus === "failed") {
    return (
      <div className="save-box is-warn" aria-live="polite">
        <p className="status-line is-error">
          <WarningCircleIcon size={20} weight="fill" aria-hidden="true" />
          端末に保存できませんでした
        </p>
        {onSave ? (
          <div className="save-actions">
            <button type="button" className="small-button is-primary" onClick={onSave} disabled={!ready}>
              再試行
            </button>
            {onSaveByDownload ? (
              <button type="button" className="small-button" onClick={onSaveByDownload} disabled={!ready}>
                ダウンロードで保存
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="save-box is-warn" aria-live="polite">
      <div className="save-row">
        <p className="status-line is-warn">
          <WarningCircleIcon size={20} weight="fill" aria-hidden="true" />
          まだ端末に保存されていません
        </p>
        {onSave ? (
          <button type="button" className="small-button is-primary" onClick={onSave} disabled={!ready}>
            端末に保存
          </button>
        ) : null}
      </div>
      <p className="save-hint">
        ブラウザは{noun}を写真アプリへ自動では保存できません。「端末に保存」から保存してください。
      </p>
    </div>
  );
}
