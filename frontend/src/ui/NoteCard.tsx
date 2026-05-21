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
      <div className="flex min-h-6 items-center justify-between gap-2">
        {showSubject && note.subject && (
          <span className="text-[0.68rem] font-semibold tracking-[0.05em] text-[var(--accent)] opacity-85">
            {note.subject}
          </span>
        )}
        <button
          aria-label="Delete note"
          className="ml-auto cursor-pointer rounded border-none bg-transparent px-[0.3rem] py-[0.15rem] text-[0.75rem] text-[var(--text-soft)] opacity-45 transition-[opacity,background] hover:not-disabled:bg-[rgba(229,85,85,0.12)] hover:not-disabled:text-[#e55] hover:not-disabled:opacity-100"
          disabled={deleting}
          onClick={onDelete}
          title="Delete"
          type="button"
        >
          {deleting ? "…" : "✕"}
        </button>
      </div>

      <div className="text-[0.95rem] font-semibold leading-[1.4] text-[var(--text-main)]">{note.concept}</div>
      {note.artifact_type === "text" && note.artifact_data?.kind === "text" ? (
        <blockquote className="m-0 line-clamp-6 flex-1 overflow-hidden rounded-r-lg border-l-[3px] border-l-[var(--accent)] bg-[var(--accent-dim)] px-[0.8rem] py-[0.55rem] text-[0.82rem] italic leading-[1.55] text-[var(--text-soft)]">
          {note.artifact_data.text}
        </blockquote>
      ) : (
        <div className="line-clamp-4 flex-1 overflow-hidden text-[0.82rem] leading-[1.55] text-[var(--text-soft)]">
          {note.summary}
        </div>
      )}
      {note.artifact_type === "diagram" && note.artifact_data?.kind === "diagram" && (
        <div className="note-artifact-diagram mt-2 block overflow-hidden rounded-lg">
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
          className="mt-2 block overflow-hidden rounded-lg"
          href={note.artifact_data.image_url}
          rel="noreferrer"
          target="_blank"
        >
          <img
            alt={note.artifact_data.caption ?? note.concept}
            src={note.artifact_data.thumbnail_url ?? note.artifact_data.image_url}
            className="block h-auto w-full rounded-lg"
          />
        </a>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-t-[var(--border)] pt-[0.625rem]">
        <span className="text-[0.7rem] text-[var(--text-soft)] opacity-60">{formatNoteDate(note.created_at)}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              due
                ? "text-[0.7rem] font-semibold text-[var(--accent)]"
                : "text-[0.7rem] text-[var(--text-soft)] opacity-70"
            }
          >
            {label}
          </span>
          {!due && (
            <button
              className="cursor-pointer rounded-md border border-[var(--border)] bg-transparent px-[0.6rem] py-[0.2rem] font-[inherit] text-[0.7rem] text-[var(--text-soft)] transition-colors hover:not-disabled:border-[var(--accent)] hover:not-disabled:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] hover:not-disabled:text-[var(--accent)]"
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
