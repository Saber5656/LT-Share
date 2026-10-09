import { useEffect, useState } from "react";
import type { Persistence } from "../lib/persistence.ts";

export type MediaView =
  | { status: "loading" }
  // The blob is not in this browser's storage (cleared data, or a write that failed).
  // The user is asked to pick the file again; no other recording is ever linked (6.3).
  | { status: "missing" }
  | { status: "ready"; blob: Blob; url: string };

type Loaded = { id: string; blob: Blob | null };

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
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const inMemory = mediaId ? persistence.peekMedia(mediaId) : undefined;
    return mediaId && inMemory ? { id: mediaId, blob: inMemory } : null;
  });

  useEffect(() => {
    if (!mediaId) return;
    const inMemory = persistence.peekMedia(mediaId);
    if (inMemory) {
      setLoaded((prev) => (prev?.id === mediaId && prev.blob === inMemory ? prev : { id: mediaId, blob: inMemory }));
      return;
    }
    let cancelled = false;
    void persistence.getMedia(mediaId, { remember }).then((blob) => {
      if (!cancelled) setLoaded({ id: mediaId, blob });
    });
    return () => {
      cancelled = true;
    };
  }, [persistence, mediaId, remember]);

  const blob = loaded && loaded.id === mediaId ? loaded.blob : undefined;
  const [url, setUrl] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    if (!blob) return;
    const created = URL.createObjectURL(blob);
    setUrl({ blob, url: created });
    return () => URL.revokeObjectURL(created);
  }, [blob]);

  if (!mediaId) return null;
  if (blob === null) return { status: "missing" };
  if (blob === undefined || url === null || url.blob !== blob) return { status: "loading" };
  return { status: "ready", blob, url: url.url };
}
