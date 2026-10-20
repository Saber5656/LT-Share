import { useCallback, useEffect, useState } from "react";
import type { Persistence } from "../lib/persistence.ts";

export type MediaView =
  | { status: "loading" }
  // The blob does not exist in this browser's storage (cleared data, or a write that
  // failed earlier). The user is asked to pick the file again; no other recording is
  // ever linked to the draft (6.3).
  | { status: "missing" }
  // Reading the storage failed. This may be temporary, so the file is NOT declared
  // missing: offer a retry / reload instead of asking for a new recording.
  | { status: "error"; retry: () => void }
  | { status: "ready"; blob: Blob; url: string };

type Loaded = { id: string; blob: Blob | null } | { id: string; error: true };

/**
 * Loads a media blob by id and exposes it as an object URL for <img>/<video>.
 * The URL is revoked when the media changes or the component unmounts.
 */
export function useMedia(
  persistence: Persistence,
  mediaId: string | undefined,
  options: { remember?: boolean } = {},
): MediaView | null {
  const remember = options.remember ?? false;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const inMemory = mediaId ? persistence.peekMedia(mediaId) : undefined;
    return mediaId && inMemory ? { id: mediaId, blob: inMemory } : null;
  });

  useEffect(() => {
    if (!mediaId) return;
    const inMemory = persistence.peekMedia(mediaId);
    if (inMemory) {
      setLoaded((prev) =>
        prev && prev.id === mediaId && "blob" in prev && prev.blob === inMemory ? prev : { id: mediaId, blob: inMemory },
      );
      return;
    }
    let cancelled = false;
    persistence.getMedia(mediaId, { remember }).then(
      (blob) => {
        if (!cancelled) setLoaded({ id: mediaId, blob });
      },
      () => {
        if (!cancelled) setLoaded({ id: mediaId, error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [persistence, mediaId, remember, attempt]);

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((value) => value + 1);
  }, []);

  const current = loaded && loaded.id === mediaId ? loaded : null;
  const blob = current && "blob" in current ? current.blob : undefined;
  const [url, setUrl] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    if (!blob) return;
    const created = URL.createObjectURL(blob);
    setUrl({ blob, url: created });
    return () => URL.revokeObjectURL(created);
  }, [blob]);

  if (!mediaId) return null;
  if (current && "error" in current) return { status: "error", retry };
  if (blob === null) return { status: "missing" };
  if (blob === undefined || url === null || url.blob !== blob) return { status: "loading" };
  return { status: "ready", blob, url: url.url };
}
