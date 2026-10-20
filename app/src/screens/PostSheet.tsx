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
      {draft ? <PostSheetBody key={`${draft.id}:${draft.media?.id ?? "text"}`} draft={draft} /> : null}
    </Sheet>
  );
}

function PostSheetBody({ draft }: { draft: Draft }) {
  const { state, persistence, nav, markOpenedInX, shareWithMedia, saveBusy, postShareBusy, postShareResult, showToast } = useApp();
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
  const isCurrent = draft.id === state.current.id;
  const shareResult = postShareResult?.draftId === draft.id && postShareResult?.mediaId === media?.id ? postShareResult.result : null;
  const startShare = () => {
    if (!file || !canShareFile || over || postShareBusy || saveBusy) return;
    void shareWithMedia(draft, file);
  };
  const mediaMessage = view?.status === "loading"
    ? `${noun}を準備しています…`
    : view?.status === "missing"
      ? `${noun}を読み込めません。${isCurrent ? `閉じて元の${noun}を選び直してください。` : `本文だけ渡して、Xで元の${noun}を添付してください。`}`
      : view?.status === "error"
        ? `${noun}の読み込みに失敗しました。もう一度読み込めます。`
        : !canShareFile
          ? `このブラウザでは${noun}と本文をまとめて共有できません。スマホのSafariやChromeで開くか、本文だけ渡してXで${noun}を添付してください。`
          : `${noun}と本文をまとめて渡します。`;
  const resultMessage = shareResult === "failed"
    ? "共有できませんでした。写真・動画と本文は残っています。もう一度お試しください。"
    : shareResult === "cancelled"
      ? "共有をキャンセルしました。写真・動画と本文はそのままです。"
      : shareResult === "stuck"
        ? "共有結果を確認できませんでした。Xで添付を確認するか、共有画面を閉じてからもう一度お試しください。"
        : shareResult === "shared"
          ? "共有先へ渡しました。Xで写真・動画と本文を確認してから投稿してください。"
          : null;

  const fallbackNeeded = view?.status === "missing" || view?.status === "error"
    || (view?.status === "ready" && !canShareFile)
    || shareResult === "failed" || shareResult === "stuck";
  const textActions = (
    <>
        {over ? (
          <button type="button" className={media ? "secondary-button" : "primary-button"} disabled>
            {media ? (appUrl ? "本文だけでXアプリを開く" : "本文だけでXを開く") : openLabel}
            <ArrowSquareOutIcon size={18} weight="bold" aria-hidden="true" />
          </button>
        ) : (
          <a
            className={media ? "secondary-button" : "primary-button"}
            href={appUrl ?? webUrl}
            target={appUrl ? "_self" : "_blank"}
            rel="noopener noreferrer"
            onClick={() => {
              markOpenedInX(draft.id);
              showToast("Xへの移動を開始しました。投稿内容はXで確認してください");
            }}
          >
            {media ? (appUrl ? "本文だけでXアプリを開く" : "本文だけでXを開く") : openLabel}
            <ArrowSquareOutIcon size={18} weight="bold" aria-hidden="true" />
          </a>
        )}
        {appUrl ? (
          <>
            <p className="hint is-center">{media ? `本文だけ開く場合は、${noun}をXで添付してください。` : "アプリが開かない場合は、本文をコピーしてXに貼り付けるか、ブラウザ版をお使いください。"}</p>
            {over ? (
              <button type="button" className="secondary-button" disabled>{media ? "本文だけでブラウザ版を開く" : "ブラウザ版で開く"}</button>
            ) : (
              <a className="secondary-button" href={webUrl} target="_blank" rel="noopener noreferrer" onClick={() => markOpenedInX(draft.id)}>
                {media ? "本文だけでブラウザ版を開く" : "ブラウザ版で開く"}
              </a>
            )}
          </>
        ) : null}
        <button type="button" className="secondary-button" disabled={copyBusy} onClick={() => void copyText()}>
          <CopyIcon size={18} aria-hidden="true" />
          本文をコピー
        </button>
    </>
  );

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
        <div className="attach-note">
          {view?.status === "ready" ? (
            media.kind === "video" ? (
              <video src={`${view.url}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" />
            ) : (
              <img src={view.url} alt="" draggable={false} />
            )
          ) : (
            <span className="attach-thumb-empty" aria-hidden="true" />
          )}
          <p>{mediaMessage}</p>
        </div>
      ) : null}

      <div className="sheet-actions">
        {media ? (
          <>
            <button type="button" className="primary-button" disabled={over || !canShareFile || postShareBusy || saveBusy} onClick={startShare}>
              <ShareNetworkIcon size={20} weight="bold" aria-hidden="true" />
              {postShareBusy ? "共有画面を開いています…" : `${noun}と本文をXへ`}
            </button>
            {canShareFile ? <p className="hint is-center">次の共有画面でXを選んでください。</p> : null}
            {resultMessage ? <p className="hint" role="status">{resultMessage}</p> : null}
            {view?.status === "error" ? (
              <button type="button" className="secondary-button" onClick={view.retry}>{noun}をもう一度読み込む</button>
            ) : null}
            {view?.status === "missing" && isCurrent ? (
              <button type="button" className="secondary-button" onClick={nav.closeSheet}>{noun}を選び直すために戻る</button>
            ) : null}
          </>
        ) : null}
        {media ? (
          <details className="share-alternatives" open={fallbackNeeded || undefined}>
            <summary>共有できない場合</summary>
            <div className="sheet-actions">{textActions}</div>
          </details>
        ) : textActions}
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
