import type { Draft } from "../lib/draft.ts";

// FR-11: the app cannot know whether the user posted, so it never says "投稿済み".
export function DraftStatus({ draft, aiEnabled }: { draft: Draft; aiEnabled: boolean }) {
  return (
    <>
      {draft.openedInX ? <span className="badge">Xで開いた</span> : <span className="badge is-muted">未確認</span>}
      {aiEnabled && draft.generation === "generating" ? <span className="badge is-muted">生成中</span> : null}
      {aiEnabled && (draft.generation === "failed" || draft.generation === "quota") ? (
        <span className="badge is-error">投稿文なし</span>
      ) : null}
    </>
  );
}

export function draftExcerpt(draft: Draft, aiEnabled: boolean): string {
  if (draft.body.trim()) return draft.body;
  if (aiEnabled && draft.generation === "generating") return "投稿文を生成しています…";
  if (aiEnabled && (draft.generation === "failed" || draft.generation === "quota")) return "投稿文を作成できませんでした";
  return "（本文なし）";
}
