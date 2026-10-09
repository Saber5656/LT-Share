import { mediaToFile, saveToDevice, type ShareEnv } from "./deviceShare.ts";
import type { Media } from "./draft.ts";
import { STUCK, browserEscapeEnv, settleOrEscape, type EscapeEnv } from "./settle.ts";

// What happened to a "端末に保存" tap:
//   handed-off  the share sheet closed normally or a download started: ask the user to confirm
//   cancelled   the user dismissed the share sheet: nothing changes
//   stuck       the share call never settled: ask the user instead of staying busy
export type SaveOutcome = "handed-off" | "cancelled" | "stuck";

export type StartedSave = { status: "started"; outcome: Promise<SaveOutcome> };
export type NotReady = { status: "not-ready" };

/**
 * Starts the save for one tap. It must be called directly from the click handler:
 * everything up to navigator.share() runs synchronously, because iOS only opens the
 * share sheet while the tap's user activation is still valid. That is also why the
 * blob has to be passed in already loaded (the UI keeps the button disabled until it
 * is) rather than being read from storage here.
 */
export function startDeviceSave({
  blob,
  media,
  mode,
  shareEnv,
  escapeEnv,
}: {
  blob: Blob | undefined;
  media: Pick<Media, "kind" | "mime" | "name">;
  mode: "auto" | "download";
  shareEnv?: ShareEnv;
  escapeEnv?: EscapeEnv;
}): StartedSave | NotReady {
  if (!blob) return { status: "not-ready" };

  const saving = saveToDevice(mediaToFile(blob, media), { mode }, shareEnv); // share() is called in here, synchronously
  const outcome = settleOrEscape(saving, escapeEnv ?? browserEscapeEnv()).then((result): SaveOutcome => {
    if (result === STUCK) return "stuck";
    return result === "cancelled" ? "cancelled" : "handed-off";
  });
  return { status: "started", outcome };
}
