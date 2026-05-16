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
      <div className="diagram-error">
        <div className="diagram-error-title">Couldn't render diagram</div>
        <pre className="diagram-error-source">{source}</pre>
      </div>
    );
  }

  return <div ref={containerRef} className="mermaid-svg" />;
}

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

  return (
    <div className="diagram-card">
      <div className="diagram-card-header">
        {diagram.title && <span className="diagram-card-title">{diagram.title}</span>}
        <div className="diagram-card-actions">
          {onSave && (
            <button
              className={`diagram-action-btn${saved ? " saved" : ""}`}
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
            className="diagram-fullscreen-btn"
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
        <div className="diagram-overlay" onClick={() => setFullscreen(false)}>
          <div className="diagram-overlay-inner" onClick={(e) => e.stopPropagation()}>
            <div className="diagram-overlay-header">
              <span className="diagram-overlay-title">{diagram.title}</span>
              <button
                className="diagram-overlay-close"
                onClick={() => setFullscreen(false)}
                type="button"
              >
                ✕
              </button>
            </div>
            <div className="diagram-overlay-canvas">
              <MermaidSvg source={diagram.source} idPrefix={`diagram-fs-${diagram.id}`} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
