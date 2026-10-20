// Some WebViews never settle navigator.share(). Without an escape the "saving"
// state would stick forever and "保存できた" / "もう一度" would stay unreachable.

export const STUCK: unique symbol = Symbol("stuck");

export type EscapeEnv = {
  // Give up this long after the call started.
  timeoutMs: number;
  // Give up this long after the page becomes visible again (the share UI is gone by then).
  visibleGraceMs: number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  // Subscribes to "the page became visible"; returns the unsubscribe function.
  onVisible: (listener: () => void) => () => void;
};

export function browserEscapeEnv(): EscapeEnv {
  return {
    timeoutMs: 60_000,
    visibleGraceMs: 1_500,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    onVisible(listener) {
      const onChange = () => {
        if (document.visibilityState === "visible") listener();
      };
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
  };
}

/**
 * Resolves with the promise's result (or rejects with its error) if it settles in
 * time, otherwise with STUCK. The original promise is left alone; a late result is ignored.
 */
export function settleOrEscape<T>(promise: Promise<T>, env: EscapeEnv): Promise<T | typeof STUCK> {
  return new Promise((resolve, reject) => {
    let done = false;
    let graceTimer: unknown = null;
    const cleanup = () => {
      done = true;
      env.clearTimeout(timeout);
      if (graceTimer !== null) env.clearTimeout(graceTimer);
      unsubscribe();
    };
    const giveUp = () => {
      if (done) return;
      cleanup();
      resolve(STUCK);
    };

    const timeout = env.setTimeout(giveUp, env.timeoutMs);
    const unsubscribe = env.onVisible(() => {
      if (!done && graceTimer === null) graceTimer = env.setTimeout(giveUp, env.visibleGraceMs);
    });

    promise.then(
      (value) => {
        if (done) return;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (done) return;
        cleanup();
        reject(error);
      },
    );
  });
}
