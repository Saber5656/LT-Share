import { useEffect, useId, useRef, type ReactNode } from "react";
import { CaretLeftIcon, CaretRightIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useApp } from "../app/context.ts";
import { X_POST_LIMIT } from "../lib/draft.ts";

export function ComposerHeader() {
  const { goNext, captureBusy } = useApp();
  return (
    <header className="app-header">
      <h1 className="app-title">LT Share on X</h1>
      <button type="button" className="header-action" disabled={captureBusy !== null} onClick={() => void goNext()}>
        次の投稿へ
        <CaretRightIcon size={18} weight="bold" aria-hidden="true" />
      </button>
    </header>
  );
}

export function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="app-header is-sub">
      <button type="button" className="back-button" onClick={onBack} aria-label="戻る">
        <CaretLeftIcon size={22} weight="bold" aria-hidden="true" />
      </button>
      <h1 className="sub-title">{title}</h1>
      <span />
    </header>
  );
}

export function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="app-footer">
      <div className="app-footer-inner">{children}</div>
    </div>
  );
}

export function Step({
  id,
  number,
  title,
  titleId,
  aside,
  helper,
  action,
  children,
}: {
  id?: string;
  number: number;
  title: string;
  titleId: string;
  aside?: ReactNode;
  helper?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} className="step" aria-labelledby={titleId}>
      <div className="step-head">
        <span className="step-number" aria-hidden="true">
          {number}
        </span>
        <div className="step-heading">
          <h2 id={titleId} className="step-title">
            {title}
          </h2>
          {helper ? <p className="step-helper">{helper}</p> : null}
        </div>
        {aside ? <span className="step-aside">{aside}</span> : null}
        {action}
      </div>
      {children}
    </section>
  );
}

// FR-06 / S-07: the weighted count is shown as X counts it, not as "100 characters".
export function PostCounter({ count }: { count: number }) {
  const over = count > X_POST_LIMIT;
  return (
    <>
      <p className={`counter${over ? " is-over" : ""}`}>
        X換算 {count} / {X_POST_LIMIT}
      </p>
      {over ? (
        <p className="over-note" role="alert">
          Xの上限を超えています。本文を短くするか、タグを減らしてください。
        </p>
      ) : null}
    </>
  );
}

export function StorageBanner() {
  const { storageProblem, retryStorage } = useApp();
  if (!storageProblem) return null;

  return (
    <div className={`app-banner${storageProblem.kind === "readonly" ? " is-sticky" : ""}`}>
      <div className="notice is-error" role="alert">
        <WarningCircleIcon size={20} weight="fill" aria-hidden="true" />
        <div>
          {storageProblem.kind === "unavailable" ? (
            <p>
              このブラウザでは端末内への保存を使えません（プライベートブラウズなど）。入力した内容と写真・動画は、このページを閉じると失われます。
            </p>
          ) : storageProblem.kind === "readonly" ? (
            <>
              <p>別のタブで開いています。このタブでは編集できません。</p>
              <button type="button" className="inline-action" onClick={() => window.location.reload()}>
                再読込
              </button>
            </>
          ) : (
            <>
              <p>
                端末内（ブラウザ）に保存できませんでした。容量不足などが考えられます。操作は続けられますが、このページを閉じると失われる可能性があります。
              </p>
              <button type="button" className="inline-action" onClick={() => void retryStorage()}>
                再試行
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div key={toast.id} className="toast" role="status">
      <span>{toast.message}</span>
      {toast.action ? (
        <button type="button" className="toast-action" onClick={toast.action.run}>
          {toast.action.label}
        </button>
      ) : null}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="sheet-root">
      <div className="sheet-backdrop" onClick={() => onClose()} />
      <div ref={panelRef} className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sheet-grabber" aria-hidden="true" />
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
        {description ? <p className="sheet-description">{description}</p> : null}
        {children}
      </div>
    </div>
  );
}
