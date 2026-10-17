import { Component, type ErrorInfo, type ReactNode } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";

// The saved screen to return to after an error is the composer: a reload or retry
// must not reopen the screen that just crashed (it is remembered in history.state).
function forgetSavedScreen() {
  try {
    window.history.replaceState(null, "", window.location.href);
  } catch {
    // ignore
  }
}

/**
 * Last line of defence: a rendering error shows a recoverable message instead of a
 * white screen. Nothing is deleted here; drafts and media stay in on-device storage.
 */
export class ErrorBoundary extends Component<
  // onReset runs when the user asks to try again (the app uses it to boot from storage again).
  { children: ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("LT Share: rendering error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app">
        <main className="screen crash">
          <div className="notice is-error" role="alert">
            <WarningCircleIcon size={20} weight="fill" aria-hidden="true" />
            <div>
              <p>
                <strong>問題が発生しました。</strong>
              </p>
              <p>
                画面の表示中にエラーが起きました。このエラーで、保存済みの投稿案や写真・動画が削除されることはありません。
              </p>
            </div>
          </div>
          <div className="sheet-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                forgetSavedScreen();
                window.location.reload();
              }}
            >
              再読込
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                forgetSavedScreen();
                this.setState({ error: null });
                this.props.onReset?.();
              }}
            >
              もう一度表示
            </button>
          </div>
        </main>
      </div>
    );
  }
}
