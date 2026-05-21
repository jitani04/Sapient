import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { createConversation, getDueFlashcards, reviewFlashcard } from "../api";
import type { Flashcard } from "../types";
import { buttonClass } from "./buttonClass";

const RATINGS: { label: string; quality: number; className: string; hint: string }[] = [
  { label: "Forgot",  quality: 1, className: "flash-btn-again", hint: "Show this again soon" },
  { label: "Sort of", quality: 3, className: "flash-btn-hard",  hint: "Review sooner" },
  { label: "Knew it", quality: 5, className: "flash-btn-easy",  hint: "Push it further out" },
];

function intervalLabel(days: number): string {
  if (days <= 0) return "later today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `in ${weeks} week${weeks !== 1 ? "s" : ""}`;
  }
  const months = Math.round(days / 30);
  return `in ${months} month${months !== 1 ? "s" : ""}`;
}

export function FlashcardsView({ subject }: { subject: string }) {
  const decodedSubject = subject;
  const encodedSubject = encodeURIComponent(decodedSubject);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sessionDone, setSessionDone] = useState<{ reviewed: number } | null>(null);
  const [reviewed, setReviewed] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["flashcards-due", decodedSubject],
    queryFn: () => getDueFlashcards(decodedSubject),
    enabled: Boolean(decodedSubject),
    staleTime: 0,
  });

  const newSessionMutation = useMutation({
    mutationFn: () => createConversation(decodedSubject),
    onSuccess: (conversation) => {
      navigate(`/sessions/${conversation.id}`);
    },
  });

  const cards: Flashcard[] = data?.cards ?? [];
  const total = cards.length;
  const current = cards[index] ?? null;

  async function handleRate(quality: number) {
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      await reviewFlashcard(current.id, quality);
      const nextReviewed = reviewed + 1;
      setReviewed(nextReviewed);

      if (index + 1 >= total) {
        setSessionDone({ reviewed: nextReviewed });
        void queryClient.invalidateQueries({ queryKey: ["flashcards-due", decodedSubject] });
      } else {
        setIndex((i) => i + 1);
        setFlipped(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleRestart() {
    setIndex(0);
    setFlipped(false);
    setReviewed(0);
    setSessionDone(null);
    void queryClient.invalidateQueries({ queryKey: ["flashcards-due", decodedSubject] });
  }

  if (isLoading) {
    return <p className="muted" style={{ marginTop: "1.5rem" }}>Loading your cards…</p>;
  }

  if (sessionDone || total === 0) {
    return (
      <div className="flash-done" style={{ marginTop: "1rem" }}>
        <div className="flash-done-icon"><CheckCircle2 size={28} strokeWidth={1.6} /></div>
        <h2>All caught up!</h2>
        {sessionDone && sessionDone.reviewed > 0 ? (
          <p>You reviewed {sessionDone.reviewed} card{sessionDone.reviewed !== 1 ? "s" : ""} this study session.</p>
        ) : (
          <p>No {decodedSubject} cards are due right now. Keep studying to build your deck.</p>
        )}
        <div className="flash-done-actions">
          {sessionDone && (
            <button className={buttonClass("secondary")} onClick={handleRestart} type="button">
              Check for more
            </button>
          )}
          <Link className={buttonClass("secondary")} to={`/projects/${encodedSubject}`}>Open subject</Link>
          <button
            className={buttonClass("primary")}
            disabled={newSessionMutation.isPending}
            onClick={() => newSessionMutation.mutate()}
            type="button"
          >
            {newSessionMutation.isPending ? "Creating…" : "Start a study session"}
          </button>
        </div>
      </div>
    );
  }

  const progress = (index / total) * 100;

  return (
    <>
      <div className="flash-progress-bar">
        <div className="flash-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="flash-stage">
        <div
          className={`flash-card ${flipped ? "flipped" : ""}`}
          onClick={() => { if (!flipped) setFlipped(true); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setFlipped(true); }}
        >
          <div className="flash-card-inner">
            <div className="flash-card-front">
              {current.subject && <span className="flash-subject">{current.subject}</span>}
              <div className="flash-concept">{current.concept}</div>
              <span className="flash-hint">Click to reveal</span>
            </div>
            <div className="flash-card-back">
              {current.subject && <span className="flash-subject">{current.subject}</span>}
              <div className="flash-concept">{current.concept}</div>
              <div className="flash-summary">{current.summary}</div>
            </div>
          </div>
        </div>

        {flipped && (
          <div className="flash-ratings">
            <p className="flash-ratings-label">Did you remember it?</p>
            <div className="flash-ratings-row">
              {RATINGS.map(({ label, quality, className, hint }) => {
                const nextDays =
                  quality < 3
                    ? 0
                    : quality === 3
                      ? Math.max(1, current.sr_interval)
                      : current.sr_repetitions === 0
                        ? 1
                        : current.sr_repetitions === 1
                          ? 6
                          : Math.round(current.sr_interval * Math.min(2.5, current.sr_ease_factor + 0.1));
                return (
                  <button
                    key={label}
                    className={`flash-rate-btn ${className}`}
                    disabled={submitting}
                    onClick={() => void handleRate(quality)}
                    title={hint}
                    type="button"
                  >
                    <span className="flash-rate-label">{label}</span>
                    <span className="flash-rate-interval">{intervalLabel(nextDays)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flash-nav">
        <button
          aria-label="Previous card"
          className="flash-nav-btn"
          disabled={index === 0 || submitting}
          onClick={() => {
            setIndex((i) => Math.max(0, i - 1));
            setFlipped(false);
          }}
          type="button"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <div className="flash-counter">{index + 1} / {total}</div>
        <button
          aria-label="Next card"
          className="flash-nav-btn"
          disabled={index >= total - 1 || submitting}
          onClick={() => {
            setIndex((i) => Math.min(total - 1, i + 1));
            setFlipped(false);
          }}
          type="button"
        >
          <ChevronRight size={18} strokeWidth={2} />
        </button>
      </div>
    </>
  );
}

export function FlashcardsPage() {
  const { subject } = useParams<{ subject: string }>();
  const decodedSubject = decodeURIComponent(subject ?? "");
  if (!decodedSubject) {
    return <Navigate replace to="/dashboard" />;
  }
  return <Navigate replace to={`/projects/${encodeURIComponent(decodedSubject)}?tab=flashcards`} />;
}
