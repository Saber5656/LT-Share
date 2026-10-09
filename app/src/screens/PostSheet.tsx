import { useMemo, useRef } from "react";
import { ArrowSquareOutIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import { useApp } from "../app/context.ts";
import { useMedia } from "../app/useMedia.ts";
import { PostCounter, Sheet } from "../components/chrome.tsx";
import { mediaNoun } from "../components/media.tsx";
import { canSharePostWithMedia, mediaToFile } from "../lib/deviceShare.ts";
import { X_POST_LIMIT, composeDraftPost, xWeightedLength, type Draft } from "../lib/draft.ts";
import { buildXIntentUrl } from "../lib/xIntent.ts";

// "ポスト確認" (FR-08, FR-09): shows exactly what is handed to X.
export function PostSheet() {
  const { nav, findDraft } = useApp();
  const draftId = nav.entry.sheetDraftId;
  // Keep the last draft while the sheet is closing so its content does not blink out.
  const lastDraft = useRef<Draft | null>(null);
  const live = findDraft(draftId);
  if (live) lastDraft.current = live;
  const draft = live ?? lastDraft.current;

  return (
    <Sheet
      open={draftId !== null}
      onClose={nav.closeSheet}
      title="ポスト確認"
      description="この内容でXの投稿画面を開きます。投稿はXで行います。"
    >
      {draft ? <PostSheetBody draft={draft} /> : null}
    </Sheet>
  );
}

function PostSheetBody({ draft }: { draft: Draft }) {
  const { persistence, nav, markOpenedInX, shareWithMedia, showToast } = useApp();
  const text = composeDraftPost(draft);
  const count = xWeightedLength(text);
  const over = count > X_POST_LIMIT;
  const media = draft.media;
  const view = useMedia(persistence, media?.id, { remember: false });

  const file = useMemo(
    () => (media && view?.status === "ready" ? mediaToFile(view.blob, media) : null),
    [media, view],
  );
  // Offered only when the browser can share this file together with the text.
  const canShareFile = file !== null && canSharePostWithMedia(file, text);
  const noun = media ? mediaNoun(media.kind) : "";

  return (
    <div className="handoff">
      <pre className="post-preview" aria-label="Xに渡す本文">
        {text}
      </pre>
      {draft.includeDeveloper ? (
        <p className="hint">「開発者：」の後は、Xで @ を入力して追加できます。</p>
      ) : null}
      <PostCounter count={count} />

      {media ? (
        <div className={`attach-note${media.saveStatus === "saved" ? "" : " is-warn"}`}>
          {view?.status === "ready" ? (
            media.kind === "video" ? (
              <video src={`${view.url}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" />
            ) : (
              <img src={view.url} alt="" draggable={false} />
            )
          ) : (
            <span className="attach-thumb-empty" aria-hidden="true" />
          )}
          <p>
            {media.saveStatus === "saved"
              ? `${noun}は端末に保存済みです。リンクで渡せるのは本文だけなので、Xで写真アプリから添付してください。`
              : `${noun}はまだ端末に保存されていません。Xには本文だけが渡ります。${
                  canShareFile
                    ? `下の「${noun}付きで共有」を使うか、先に「端末に保存」してください。`
                    : "先に「端末に保存」すると、Xで写真アプリから添付できます。"
                }`}
          </p>
        </div>
      ) : null}

      <div className="sheet-actions">
        {over ? (
          <button type="button" className="primary-button" disabled>
            Xで開く
            <ArrowSquareOutIcon size={18} weight="bold" aria-hidden="true" />
          </button>
        ) : (
          <a
            className="primary-button"
            href={buildXIntentUrl(text)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              markOpenedInX(draft.id);
              showToast("Xの投稿画面を開きます。投稿はXで行ってください");
            }}
          >
            Xで開く
            <ArrowSquareOutIcon size={18} weight="bold" aria-hidden="true" />
          </a>
        )}
        {file && media && canShareFile ? (
          <button
            type="button"
            className="secondary-button"
            disabled={over}
            onClick={() => void shareWithMedia(draft, file)}
          >
            <ShareNetworkIcon size={18} weight="bold" aria-hidden="true" />
            {noun}付きで共有
          </button>
        ) : null}
        <button type="button" className="text-button" onClick={nav.closeSheet}>
          閉じる
        </button>
      </div>

      {draft.openedInX ? (
        <p className="hint is-center">Xの投稿画面を開きました。投稿したかどうかは、このアプリでは分かりません。</p>
      ) : null}
    </div>
  );
}
