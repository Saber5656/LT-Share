import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppContext } from "./app/context.ts";
import { useController, type StorageProblem } from "./app/controller.ts";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { StorageBanner, Toast } from "./components/chrome.tsx";
import { createInitialState, type DraftState } from "./lib/draft.ts";
import { Persistence } from "./lib/persistence.ts";
import { createIndexedDbRepository } from "./lib/repository.ts";
import { restoreState } from "./lib/restore.ts";
import { hasSeenWelcome } from "./lib/welcome.ts";
import { acquireWriterLock, type WriterLockResult } from "./lib/writerLock.ts";
import { Composer } from "./screens/Composer.tsx";
import { DraftDetail, History } from "./screens/History.tsx";
import { PostSheet } from "./screens/PostSheet.tsx";
import { Welcome } from "./screens/Welcome.tsx";

// How long to wait for the on-device storage before offering a way out.
const BOOT_TIMEOUT_MS = 5000;

type Boot = {
  initial: DraftState;
  persistence: Persistence;
  problem: StorageProblem | null;
};

// The writer lock is held for the page's lifetime, so it is taken once per page; a
// second attempt (React StrictMode, or booting again after an error) would be denied.
let writerLock: Promise<WriterLockResult> | null = null;
function writerLockOnce(): Promise<WriterLockResult> {
  writerLock ??= acquireWriterLock();
  return writerLock;
}

// Opens the on-device storage and restores the saved state (C-03, AT-15).
// If the browser refuses (private mode, blocked storage) the app still works in
// memory and says so; nothing is deleted. Only one tab may write: a tab that does
// not get the writer lock runs read-only (see lib/writerLock.ts).
async function boot(): Promise<Boot> {
  const readOnly = (await writerLockOnce()) === "denied";
  try {
    const persistence = new Persistence(createIndexedDbRepository(), Date.now, { readOnly });
    const snapshot = await persistence.load();
    // Blobs left behind by an interrupted capture are removed; one that a draft references never is.
    await persistence.collectGarbage(snapshot);
    const restored = restoreState(snapshot);
    return {
      initial: restored ?? createInitialState(),
      persistence,
      problem: readOnly ? { kind: "readonly" } : null,
    };
  } catch {
    return { initial: createInitialState(), persistence: new Persistence(null), problem: { kind: "unavailable" } };
  }
}

type Phase = { name: "loading" } | { name: "slow" } | { name: "ready"; boot: Boot };

export function App() {
  // Bumped to boot again from storage after a screen error, so the app never resumes
  // from a stale in-memory copy that could overwrite newer saved data.
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const skipped = useRef(false);

  useEffect(() => {
    let cancelled = false;
    skipped.current = false;
    setPhase((current) => (current.name === "loading" ? current : { name: "loading" }));
    const timer = window.setTimeout(() => {
      setPhase((current) => (current.name === "loading" ? { name: "slow" } : current));
    }, BOOT_TIMEOUT_MS);
    void boot().then((result) => {
      // A late result is still welcome unless the user chose to continue without saving.
      if (cancelled || skipped.current) return;
      window.clearTimeout(timer);
      setPhase({ name: "ready", boot: result });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [generation]);

  if (phase.name === "ready") {
    return (
      <ErrorBoundary
        onReset={() => {
          // Same batch as the boundary's reset: the stale screen is never rendered again.
          setPhase({ name: "loading" });
          setGeneration((value) => value + 1);
        }}
      >
        <Loaded boot={phase.boot} />
      </ErrorBoundary>
    );
  }

  return (
    <div className="app" aria-busy={phase.name === "loading"}>
      {phase.name === "slow" ? (
        <main className="screen crash">
          <div className="notice is-error" role="alert">
            <div>
              <p>
                <strong>端末内の保存データの読み込みに時間がかかっています。</strong>
              </p>
              <p>
                もう少し待つか、再読込してください。保存済みの投稿案や写真・動画は削除されていません。
              </p>
            </div>
          </div>
          <div className="sheet-actions">
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>
              再読込
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                // Work in memory only: nothing is read from or written to storage meanwhile.
                skipped.current = true;
                setPhase({
                  name: "ready",
                  boot: { initial: createInitialState(), persistence: new Persistence(null), problem: { kind: "skipped" } },
                });
              }}
            >
              保存せずに続ける
            </button>
          </div>
        </main>
      ) : null}
    </div>
  );
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

  // Another tab holds the writer lock: show everything, change nothing.
  const readOnly = app.storageProblem?.kind === "readonly";

  return (
    <AppContext.Provider value={app}>
      <div className="app">
        <StorageBanner />
        <div className="app-body" inert={readOnly}>
          {route.view === "composer" ? <Composer /> : null}
          {route.view === "history" ? <History /> : null}
          {route.view === "detail" ? <DraftDetail draftId={route.draftId} /> : null}
          {route.view === "welcome" ? <Welcome /> : null}
          <PostSheet />
        </div>
        <Toast />
      </div>
    </AppContext.Provider>
  );
}
