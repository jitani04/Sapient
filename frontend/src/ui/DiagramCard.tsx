import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import mermaid from "mermaid";
import type { DiagramData } from "../types";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "default",
  fontFamily: "inherit",
});

interface Props {
  diagram: DiagramData;
  onSave?: (diagram: DiagramData) => void;
  saved?: boolean;
}

function MermaidSvg({ source, idPrefix }: { source: string; idPrefix: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const renderId = `${idPrefix}-${Math.random().toString(36).slice(2, 10)}`;

    mermaid
      .render(renderId, source)
      .then(({ svg }) => {
        if (cancelled) return;
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [source, idPrefix]);

  if (error) {
    return (
      <div>
        <div>Couldn't render diagram</div>
        <pre>{source}</pre>
      </div>
    );
  }

  return <div ref={containerRef} />;
}

const ACTION_BTN_BASE =
  "inline-flex cursor-pointer items-center gap-[0.3rem] whitespace-nowrap rounded-[5px] border px-2 py-[0.2rem] text-[0.72rem] font-semibold transition-colors";

export function DiagramCard({ diagram, onSave, saved }: Props) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const saveButtonClasses = [
    ACTION_BTN_BASE,
    saved
      ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
      : "border-[var(--panel-border)] bg-transparent text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
  ].join(" ");

  const fullscreenButtonClasses = [
    ACTION_BTN_BASE,
    "flex-shrink-0 border-[var(--panel-border)] bg-transparent text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
  ].join(" ");

  return (
    <div className="diagram-card">
      <div className="flex items-center justify-between gap-2 border-b border-b-[var(--panel-border)] px-[0.875rem] py-[0.45rem]">
        {diagram.title && (
          <span className="text-[0.8rem] font-bold text-[var(--text-main)]">{diagram.title}</span>
        )}
        <div className="inline-flex flex-shrink-0 items-center gap-[0.35rem]">
          {onSave && (
            <button
              className={saveButtonClasses}
              onClick={() => onSave(diagram)}
              title={saved ? "Saved to notes" : "Save to notes"}
              type="button"
            >
              <svg fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" height="14" viewBox="0 0 24 24" width="14" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              {saved ? "Saved" : "Save"}
            </button>
          )}
          <button
            className={fullscreenButtonClasses}
            onClick={() => setFullscreen(true)}
            title="Open full screen"
            type="button"
          >
            <svg fill="currentColor" height="14" viewBox="0 0 24 24" width="14">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
            Full screen
          </button>
        </div>
      </div>
      <div className="diagram-canvas">
        <MermaidSvg source={diagram.source} idPrefix={`diagram-${diagram.id}`} />
      </div>

      {fullscreen && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(0,0,0,0.6)] p-6"
          onClick={() => setFullscreen(false)}
        >
          <div
            className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-white shadow-[0_24px_80px_rgba(0,0,0,0.3)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b border-b-[var(--panel-border)] px-4 py-[0.7rem]">
              <span className="text-[0.875rem] font-bold text-[var(--text-main)]">{diagram.title}</span>
              <button
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--panel-border)] bg-transparent text-[0.85rem] text-[var(--text-muted)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-main)]"
                onClick={() => setFullscreen(false)}
                type="button"
              >
                ✕
              </button>
            </div>
            <div className="relative flex-1">
              <MermaidSvg source={diagram.source} idPrefix={`diagram-fs-${diagram.id}`} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
