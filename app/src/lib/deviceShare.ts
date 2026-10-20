// Getting a recorded file out of the browser (FR-03) and handing a post to the
// OS share sheet (FR-09).
//
// Browsers cannot write to the photo library silently. The best a web page can
// do is open the share sheet (iOS offers "画像を保存" / "ビデオを保存") or start a
// download. Neither proves that the file reached Photos; do not claim it did.

import type { Media } from "./draft.ts";

export type ShareEnv = {
  navigator: {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  triggerDownload: (blob: Blob, filename: string) => void;
};

export type SaveResult = "shared" | "downloaded" | "cancelled";
export type ShareResult = "shared" | "cancelled";

export function browserShareEnv(): ShareEnv {
  return {
    navigator,
    triggerDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  };
}

// The user dismissing the share sheet is not an error.
function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

function canShareFiles(data: ShareData, env: ShareEnv): boolean {
  const nav = env.navigator;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare(data);
  } catch {
    return false;
  }
}

/**
 * "端末に保存": share sheet when the browser can share files, otherwise a download.
 * Resolves "cancelled" when the user dismisses the sheet; rejects on real errors.
 * It never reports "saved": photo-library receipt cannot be observed here.
 */
export async function saveToDevice(
  file: File,
  options: { mode?: "auto" | "download" } = {},
  env: ShareEnv = browserShareEnv(),
): Promise<SaveResult> {
  if (options.mode !== "download" && canShareFiles({ files: [file] }, env)) {
    try {
      await env.navigator.share!({ files: [file] });
      return "shared";
    } catch (error) {
      if (isAbortError(error)) return "cancelled";
      throw error;
    }
  }

  env.triggerDownload(file, file.name);
  return "downloaded";
}

export function canSharePostWithMedia(file: File, text: string, env: ShareEnv = browserShareEnv()): boolean {
  return canShareFiles({ files: [file], text }, env);
}

/** Share text and file together; the user picks X in the share sheet. */
export async function sharePostWithMedia(
  file: File,
  text: string,
  env: ShareEnv = browserShareEnv(),
): Promise<ShareResult> {
  try {
    await env.navigator.share!({ files: [file], text });
    return "shared";
  } catch (error) {
    if (isAbortError(error)) return "cancelled";
    throw error;
  }
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/3gpp": "3gp",
};

const FALLBACK_MIME = { photo: "image/jpeg", video: "video/mp4" } as const;

/** Rebuild a shareable File (with a proper name and type) from the stored Blob. */
export function mediaToFile(blob: Blob, media: Pick<Media, "kind" | "mime" | "name">): File {
  const mime = media.mime || blob.type || FALLBACK_MIME[media.kind];
  const extension = EXTENSIONS[mime.toLowerCase()] ?? (media.kind === "photo" ? "jpg" : "mp4");
  const hasExtension = /\.[A-Za-z0-9]{2,5}$/.test(media.name);
  const name = media.name
    ? hasExtension
      ? media.name
      : `${media.name}.${extension}`
    : `lt-${media.kind}.${extension}`;
  return new File([blob], name, { type: mime });
}
