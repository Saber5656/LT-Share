import { AiQuotaError, type AiProvider } from "./ai.ts";
import type { DraftAction } from "./draft.ts";

// Runs one generation and reports it to the reducer by draft id, so a result that
// arrives after "次の投稿へ" still lands on the draft it was started for (FR-04).
// Never retries on its own (NFR-03).
export async function runGeneration({
  provider,
  draftId,
  image,
  tags,
  dispatch,
  mediaId,
  replaceUserText = false,
  alreadyStarted = false,
}: {
  provider: AiProvider;
  draftId: string;
  image: Blob;
  tags: string[];
  dispatch: (action: DraftAction) => void;
  mediaId?: string;
  replaceUserText?: boolean;
  alreadyStarted?: boolean;
}): Promise<void> {
  const target = mediaId ? { draftId, mediaId } : { draftId };
  if (!alreadyStarted) dispatch({ type: "generateStart", ...target, ...(replaceUserText ? { replaceUserText: true } : {}) });
  try {
    const text = (await provider.generate({ image, tags })).trim();
    if (!text) {
      dispatch({ type: "generateFailed", ...target, reason: "failed" });
      return;
    }
    dispatch({ type: "generateDone", ...target, text });
  } catch (error) {
    dispatch({ type: "generateFailed", ...target, reason: error instanceof AiQuotaError ? "quota" : "failed" });
  }
}
