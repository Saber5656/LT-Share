import { useMemo, useRef, useState } from "react";
import { ArrowSquareOutIcon, CopyIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import { useApp } from "../app/context.ts";
import { useMedia } from "../app/useMedia.ts";
import { PostCounter, Sheet } from "../components/chrome.tsx";
import { mediaNoun } from "../components/media.tsx";
import { canSharePostWithMedia, mediaToFile } from "../lib/deviceShare.ts";
import { X_POST_LIMIT, composeDraftPost, xWeightedLength, type Draft } from "../lib/draft.ts";
import { buildXAppUrl, buildXIntentUrl, detectMobilePlatform } from "../lib/xIntent.ts";

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
  const appUrl = buildXAppUrl(text, detectMobilePlatform(navigator));
  const webUrl = buildXIntentUrl(text);
  const openLabel = appUrl ? "Xアプリで開く" : "Xで開く";
  const [copyBusy, setCopyBusy] = useState(false);
  const copyText = async () => {
    if (copyBusy) return;
    setCopyBusy(true);
    try {
      await navigator.clipboard.writeText(text);
      showToast("本文をコピーしました");
    } catch {
      showToast("コピーできませんでした。上の本文を長押ししてコピーしてください");
    } finally {
      setCopyBusy(false);
    }
  };
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
              : media.source === "library" && media.saveStatus === "unsaved"
                ? `${noun}の原本が端末にあるか確認してください。リンクで渡せるのは本文だけです。写真アプリに原本があれば、Xでそのまま添付できます。`
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
            {openLabel}
            <ArrowSquareOutIcon size={18} weight="bold" aria-hidden="true" />
          </button>
        ) : (
          <a
            className="primary-button"
            href={appUrl ?? webUrl}
            target={appUrl ? "_self" : "_blank"}
            rel="noopener noreferrer"
            onClick={() => {
              markOpenedInX(draft.id);
              showToast("Xへの移動を開始しました。投稿内容はXで確認してください");
            }}
          >
            {openLabel}
            <ArrowSquareOutIcon size={18} weight="bold" aria-hidden="true" />
          </a>
        )}
        {appUrl ? (
          <>
            <p className="hint is-center">アプリが開かない場合は、本文をコピーしてXに貼り付けるか、ブラウザ版をお使いください。</p>
            {over ? (
              <button type="button" className="secondary-button" disabled>ブラウザ版で開く</button>
            ) : (
              <a className="secondary-button" href={webUrl} target="_blank" rel="noopener noreferrer" onClick={() => markOpenedInX(draft.id)}>
                ブラウザ版で開く
              </a>
            )}
          </>
        ) : null}
        <button type="button" className="secondary-button" disabled={copyBusy} onClick={() => void copyText()}>
          <CopyIcon size={18} aria-hidden="true" />
          本文をコピー
        </button>
        {media && view?.status === "loading" && typeof navigator.share === "function" ? (
          // The file is still loading: the share button appears disabled so that tapping it
          // always calls navigator.share() synchronously (iOS user activation).
          <button type="button" className="secondary-button" disabled>
            <ShareNetworkIcon size={18} weight="bold" aria-hidden="true" />
            {noun}付きで共有
          </button>
        ) : null}
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
        <p className="hint is-center">Xへの移動を開始しました。実際に開けたか、投稿したかどうかは、このアプリでは分かりません。</p>
      ) : null}
    </div>
  );
}
