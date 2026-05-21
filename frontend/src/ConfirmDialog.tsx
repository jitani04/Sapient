import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { buttonClass } from "./ui/buttonClass";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm must be used inside ConfirmProvider");
  return fn;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  useEffect(() => {
    if (!pending) return;
    confirmBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        pending?.resolve(false);
        setPending(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  function handleResolve(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending &&
        createPortal(
          <div
            className="fixed inset-0 z-[1300] flex items-center justify-center p-6 bg-[rgba(15,23,36,0.5)]"
            onClick={() => handleResolve(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="w-full max-w-[440px] rounded-[14px] px-[1.4rem] pt-5 pb-4 bg-[var(--panel-bg,#fff)] shadow-[0_18px_48px_rgba(0,0,0,0.25)]"
              onClick={(e) => e.stopPropagation()}
            >
              {pending.title && (
                <h2 className="mb-2 text-[1.05rem] font-semibold">{pending.title}</h2>
              )}
              <p className="mb-[1.1rem] leading-[1.5] text-[var(--text-soft,#4c6583)]">
                {pending.message}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  className={buttonClass("secondary")}
                  onClick={() => handleResolve(false)}
                  type="button"
                >
                  {pending.cancelLabel ?? "Cancel"}
                </button>
                <button
                  ref={confirmBtnRef}
                  className={buttonClass(pending.danger ? "danger" : "primary")}
                  onClick={() => handleResolve(true)}
                  type="button"
                >
                  {pending.confirmLabel ?? "Confirm"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </ConfirmContext.Provider>
  );
}
