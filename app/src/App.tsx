import { useEffect, useLayoutEffect, useState } from "react";
import { AppContext } from "./app/context.ts";
import { useController, type StorageProblem } from "./app/controller.ts";
import { Toast } from "./components/chrome.tsx";
import { createInitialState, type DraftState } from "./lib/draft.ts";
import { Persistence } from "./lib/persistence.ts";
import { createIndexedDbRepository } from "./lib/repository.ts";
import { restoreState } from "./lib/restore.ts";
import { hasSeenWelcome } from "./lib/welcome.ts";
import { Composer } from "./screens/Composer.tsx";
import { DraftDetail, History } from "./screens/History.tsx";
import { PostSheet } from "./screens/PostSheet.tsx";
import { Welcome } from "./screens/Welcome.tsx";

type Boot = {
  initial: DraftState;
  persistence: Persistence;
  problem: StorageProblem | null;
};

// Opens the on-device storage and restores the saved state (C-03, AT-15).
// If the browser refuses (private mode, blocked storage) the app still works in
// memory and says so; nothing is deleted.
async function boot(): Promise<Boot> {
  try {
    const persistence = new Persistence(createIndexedDbRepository());
    const restored = restoreState(await persistence.load());
    return { initial: restored ?? createInitialState(), persistence, problem: null };
  } catch {
    return { initial: createInitialState(), persistence: new Persistence(null), problem: { kind: "unavailable" } };
  }
}

export function App() {
  const [ready, setReady] = useState<Boot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void boot().then((result) => {
      if (!cancelled) setReady(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return <div className="app" aria-busy="true" />;
  return <Loaded boot={ready} />;
}

function Loaded({ boot: { initial, persistence, problem } }: { boot: Boot }) {
  const [firstRun] = useState(() => !hasSeenWelcome());
  const app = useController({ initial, persistence, initialProblem: problem, firstRun });
  const { route } = app.nav.entry;

  // A new screen starts at the top (the post sheet is an overlay and keeps the scroll).
  const screenKey = route.view === "detail" ? `detail:${route.draftId}` : route.view;
  useLayoutEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screenKey]);

  return (
    <AppContext.Provider value={app}>
      <div className="app">
        {route.view === "composer" ? <Composer /> : null}
        {route.view === "history" ? <History /> : null}
        {route.view === "detail" ? <DraftDetail draftId={route.draftId} /> : null}
        {route.view === "welcome" ? <Welcome /> : null}
        <PostSheet />
        <Toast />
      </div>
    </AppContext.Provider>
  );
}
