import type { KeyIdea } from "../types";
import { DiagramCard } from "./DiagramCard";

export function isNoteDue(idea: KeyIdea): boolean {
  return new Date(idea.sr_due_date) <= new Date();
}

export function noteReviewLabel(idea: KeyIdea): string {
  if (idea.sr_repetitions === 0) return "Not yet reviewed";
  if (isNoteDue(idea)) return "Due for review";
  const d = new Date(idea.sr_due_date);
  return `Next: ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function formatNoteDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export interface NoteCardProps {
  note: KeyIdea;
  deleting: boolean;
  promoting: boolean;
  showSubject?: boolean;
  onDelete: () => void;
  onPromote: () => void;
}

export function NoteCard({ note, deleting, promoting, showSubject = true, onDelete, onPromote }: NoteCardProps) {
  const due = isNoteDue(note);
  const label = noteReviewLabel(note);

  return (
    <div className="note-card">
      <div className="note-card-header">
        {showSubject && note.subject && <span className="note-subject-tag">{note.subject}</span>}
        <button
          aria-label="Delete note"
          className="note-delete-btn"
          disabled={deleting}
          onClick={onDelete}
          title="Delete"
          type="button"
        >
          {deleting ? "…" : "✕"}
        </button>
      </div>

      <div className="note-concept">{note.concept}</div>
      {note.artifact_type === "text" && note.artifact_data?.kind === "text" ? (
        <blockquote className="note-snippet">{note.artifact_data.text}</blockquote>
      ) : (
        <div className="note-summary">{note.summary}</div>
      )}
      {note.artifact_type === "diagram" && note.artifact_data?.kind === "diagram" && (
        <div className="note-artifact note-artifact-diagram">
          <DiagramCard
            diagram={{
              id: `note-${note.id}`,
              source: note.artifact_data.source,
              title: note.artifact_data.title ?? undefined,
            }}
          />
        </div>
      )}
      {note.artifact_type === "image" && note.artifact_data?.kind === "image" && (
        <a
          className="note-artifact note-artifact-image"
          href={note.artifact_data.image_url}
          rel="noreferrer"
          target="_blank"
        >
          <img
            alt={note.artifact_data.caption ?? note.concept}
            src={note.artifact_data.thumbnail_url ?? note.artifact_data.image_url}
          />
        </a>
      )}

      <div className="note-card-footer">
        <span className="note-date">{formatNoteDate(note.created_at)}</span>
        <div className="note-review-status">
          <span className={`note-review-label ${due ? "note-review-label-due" : ""}`}>{label}</span>
          {!due && (
            <button
              className="note-promote-btn"
              disabled={promoting}
              onClick={onPromote}
              title="Schedule for review today"
              type="button"
            >
              {promoting ? "…" : "Review now"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
