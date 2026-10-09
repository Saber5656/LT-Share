import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Tiny in-app navigation on top of the History API, so the phone's back button /
// swipe-back moves between screens (and closes the post sheet) instead of leaving
// the app. The URL never changes, which keeps this working on any static host.

export type Route =
  | { view: "composer" }
  | { view: "history" }
  | { view: "detail"; draftId: string }
  | { view: "welcome" };

export type NavEntry = {
  route: Route;
  // Draft shown in the "ポスト確認" sheet, if it is open.
  sheetDraftId: string | null;
  // 0 for the first entry of this visit; > 0 means history.back() stays in the app.
  depth: number;
};

export type Navigation = {
  entry: NavEntry;
  push: (route: Route) => void;
  replace: (route: Route) => void;
  back: () => void;
  openSheet: (draftId: string) => void;
  closeSheet: () => void;
};

const MARKER = "lt-share";
const HOME: NavEntry = { route: { view: "composer" }, sheetDraftId: null, depth: 0 };

function toState(entry: NavEntry) {
  return { [MARKER]: true, ...entry };
}

function parse(state: unknown, isKnownDraft: (id: string) => boolean): NavEntry | null {
  if (typeof state !== "object" || state === null || !(MARKER in state)) return null;
  const { route, depth, sheetDraftId } = state as Partial<NavEntry>;
  if (!route || typeof route !== "object") return null;

  const safeDepth = typeof depth === "number" && depth >= 0 ? depth : 0;
  const sheet = typeof sheetDraftId === "string" && isKnownDraft(sheetDraftId) ? sheetDraftId : null;
  switch (route.view) {
    case "composer":
    case "history":
    case "welcome":
      return { route, sheetDraftId: sheet, depth: safeDepth };
    case "detail":
      return typeof route.draftId === "string" && isKnownDraft(route.draftId)
        ? { route, sheetDraftId: sheet, depth: safeDepth }
        : null;
    default:
      return null;
  }
}

export function useNavigation(initial: Route, isKnownDraft: (id: string) => boolean): Navigation {
  const isKnownRef = useRef(isKnownDraft);
  isKnownRef.current = isKnownDraft;

  const [entry, setEntry] = useState<NavEntry>(() => {
    // A reload restores the screen, but never an open sheet.
    const restored = parse(window.history.state, isKnownDraft);
    return restored ? { ...restored, sheetDraftId: null } : { route: initial, sheetDraftId: null, depth: 0 };
  });
  const entryRef = useRef(entry);

  useEffect(() => {
    window.history.replaceState(toState(entryRef.current), "");
    const onPop = (event: PopStateEvent) => {
      const next = parse(event.state, (id) => isKnownRef.current(id)) ?? HOME;
      entryRef.current = next;
      setEntry(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const commit = useCallback((next: NavEntry, mode: "push" | "replace") => {
    entryRef.current = next;
    if (mode === "push") window.history.pushState(toState(next), "");
    else window.history.replaceState(toState(next), "");
    setEntry(next);
  }, []);

  return useMemo<Navigation>(() => {
    const back = () => {
      if (entryRef.current.depth > 0) window.history.back();
      else commit(HOME, "replace");
    };
    return {
      entry,
      push: (route) => commit({ route, sheetDraftId: null, depth: entryRef.current.depth + 1 }, "push"),
      replace: (route) => commit({ route, sheetDraftId: null, depth: entryRef.current.depth }, "replace"),
      back,
      openSheet: (draftId) =>
        commit({ ...entryRef.current, sheetDraftId: draftId, depth: entryRef.current.depth + 1 }, "push"),
      closeSheet: () => {
        if (entryRef.current.sheetDraftId) back();
      },
    };
  }, [entry, commit]);
}
