import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";

import type { LectureNote } from "../types";
import { DiagramCard } from "./DiagramCard";
import { ImageArtifactCard } from "./ImageArtifactCard";
import { buttonClass } from "./buttonClass";

interface Props {
  note: LectureNote;
  onClose: () => void;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LectureNoteViewer({ note, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleDownloadPdf() {
    window.print();
  }

  return createPortal(
    <div className="lecture-viewer-overlay" role="dialog" aria-modal="true">
      <div className="lecture-viewer-shell">
        <div className="lecture-viewer-header no-print">
          <div>
            <div className="lecture-viewer-eyebrow">
              {note.subject ?? "Lecture"} · {formatDate(note.created_at)}
            </div>
            <h2 className="lecture-viewer-title">{note.title}</h2>
          </div>
          <div className="lecture-viewer-actions">
            <button
              className={buttonClass("secondary", "lecture-viewer-download")}
              onClick={handleDownloadPdf}
              type="button"
            >
              <Download size={14} strokeWidth={2} />
              Download PDF
            </button>
            <button
              aria-label="Close"
              className="lecture-viewer-close"
              onClick={onClose}
              type="button"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="lecture-viewer-page" ref={printRef}>
          <div className="lecture-viewer-page-header print-only">
            <h1 className="lecture-viewer-print-title">{note.title}</h1>
            <div className="lecture-viewer-print-meta">
              {note.subject ? `${note.subject} · ` : ""}
              {formatDate(note.created_at)}
            </div>
          </div>

          <div className="lecture-viewer-stream">
            {note.timeline.map((entry, idx) => {
              if (entry.kind === "key_idea") {
                const idea = entry.idea;
                return (
                  <article
                    key={`idea-${idea.id}-${idx}`}
                    className="lecture-viewer-note"
                  >
                    <h3>{idea.concept}</h3>
                    <p>{idea.summary}</p>
                  </article>
                );
              }
              if (entry.kind === "diagram") {
                return (
                  <section key={`diagram-${entry.diagram.id}-${idx}`} className="lecture-viewer-sketch">
                    <div className="lecture-viewer-sketch-label">Diagram</div>
                    <DiagramCard diagram={entry.diagram} />
                  </section>
                );
              }
              return (
                <section key={`image-${entry.image.id}-${idx}`} className="lecture-viewer-sketch">
                  <div className="lecture-viewer-sketch-label">Image</div>
                  <ImageArtifactCard image={entry.image} />
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
