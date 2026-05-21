import { useState, type FormEvent } from "react";

import { skipQuizQuestion, submitQuizAttempt } from "../api";
import type { AttemptResult, QuizData } from "../types";
import { buttonClass } from "./buttonClass";

interface Props {
  quiz: QuizData;
  onAnswered?: (result: AttemptResult, answer: string) => void;
  onSkipped?: (result: AttemptResult) => void;
  hideSkip?: boolean;
}

type PendingAction = "submit" | "skip" | null;

export function QuizCard({ quiz, onAnswered, onSkipped, hideSkip = false }: Props) {
  const [selected, setSelected] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!selected.trim() || submitted) return;
    setPendingAction("submit");
    setError(null);
    try {
      const res = await submitQuizAttempt(quiz.quiz_id, selected);
      setResult(res);
      setSubmitted(true);
      onAnswered?.(res, selected);
    } catch {
      setError("Failed to submit. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSkip() {
    if (submitted) return;
    setPendingAction("skip");
    setError(null);
    try {
      const res = await skipQuizQuestion(quiz.quiz_id);
      setResult(res);
      setSkipped(true);
      setSubmitted(true);
      onSkipped?.(res);
    } catch {
      setError("Failed to skip. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  const isPending = pendingAction !== null;
  const resultHeader = result?.is_correct ? "✓ Correct!" : skipped ? "Skipped" : "✗ Not quite";

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSubmit();
  }

  const optionBase =
    "cursor-pointer rounded-lg border-[1.5px] bg-[var(--panel-bg)] px-[0.875rem] py-[0.55rem] text-left text-[0.875rem] text-[var(--text)] transition-colors";

  function optionClasses(opt: string): string {
    if (submitted && result) {
      if (opt === result.correct_answer)
        return `${optionBase} border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]`;
      if (opt === selected && !result.is_correct)
        return `${optionBase} border-[var(--error)] bg-[var(--error-bg)] text-[var(--error)]`;
      return `${optionBase} border-[var(--panel-border)]`;
    }
    if (opt === selected) {
      return `${optionBase} border-[var(--accent)] bg-[rgba(115,147,179,0.07)]`;
    }
    return `${optionBase} border-[var(--panel-border)] hover:not-disabled:border-[var(--accent)] hover:not-disabled:bg-[rgba(115,147,179,0.04)]`;
  }

  const resultClasses = (() => {
    const base =
      "relative mt-[0.85rem] overflow-hidden rounded-[10px] border border-l-4 px-4 pt-[0.95rem] pb-[0.9rem] text-[0.875rem] leading-[1.55]";
    if (!result) return base;
    if (result.is_correct)
      return `${base} border-[rgba(74,222,128,0.22)] border-l-[var(--success)] bg-[rgba(74,222,128,0.07)]`;
    if (skipped)
      return `${base} border-[rgba(115,147,179,0.22)] border-l-[var(--accent)] bg-[rgba(115,147,179,0.07)]`;
    return `${base} border-[rgba(248,113,113,0.20)] border-l-[var(--error)] bg-[rgba(248,113,113,0.06)]`;
  })();

  const resultHeaderColor = result?.is_correct
    ? "text-[var(--success)]"
    : skipped
    ? "text-[var(--accent)]"
    : "text-[var(--error)]";

  return (
    <form className="quiz-card" onSubmit={handleFormSubmit}>
      <div className="mb-1 flex flex-wrap items-center gap-[0.4rem]">
        <span className="rounded-[20px] bg-[rgba(115,147,179,0.08)] px-[0.55rem] py-[0.2rem] text-[0.68rem] font-bold tracking-[0.08em] text-[var(--accent)]">
          Knowledge Check
        </span>
        {quiz.concept && (
          <span className="max-w-full overflow-hidden text-ellipsis rounded-full bg-[rgba(115,147,179,0.06)] px-[0.55rem] py-[0.2rem] text-[0.68rem] font-bold text-[var(--text-muted)]">
            {quiz.concept}
          </span>
        )}
      </div>

      <p className="my-[0.875rem] mb-4 text-[0.925rem] font-medium leading-[1.55] text-[var(--text)]">
        {quiz.question}
      </p>

      {quiz.quiz_type === "multiple_choice" && quiz.options ? (
        <div className="mb-4 flex flex-col gap-[0.45rem]">
          {quiz.options.map((opt) => (
            <button
              key={opt}
              className={optionClasses(opt)}
              disabled={submitted || isPending}
              onClick={() => setSelected(opt)}
              type="button"
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <textarea
          className="quiz-input"
          disabled={submitted || isPending}
          onChange={(e) => setSelected(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Type your answer…"
          rows={3}
          value={selected}
        />
      )}

      {error && <p className="text-[0.84rem] font-medium text-[var(--error)]">{error}</p>}

      {!submitted && (
        <div className="flex flex-col gap-[0.55rem]">
          <button
            className={buttonClass("primary", "w-full")}
            disabled={!selected.trim() || isPending}
            type="submit"
          >
            {pendingAction === "submit" ? "Checking…" : "Submit answer"}
          </button>
          {!hideSkip && (
            <button
              className={buttonClass("secondary", "w-full justify-center")}
              disabled={isPending}
              onClick={() => void handleSkip()}
              type="button"
            >
              {pendingAction === "skip" ? "Skipping…" : "Skip question"}
            </button>
          )}
        </div>
      )}

      {result && (
        <div className={resultClasses}>
          <div className={`mb-[0.45rem] flex items-center gap-[0.4rem] text-[1rem] font-bold tracking-[-0.005em] ${resultHeaderColor}`}>
            {resultHeader}
          </div>
          {!result.is_correct && (
            <div className="mb-[0.45rem] text-[var(--text-soft)] [&_strong]:text-[var(--text-main)]">
              Correct answer: <strong>{result.correct_answer}</strong>
            </div>
          )}
          <div className="text-[var(--text-soft)]">{result.explanation}</div>
          {typeof result.mastery === "number" && result.concept && (
            <div className="mt-[0.6rem] border-t border-t-[var(--panel-border)] pt-[0.55rem] text-[0.76rem] font-[650] text-[var(--text-muted)]">
              BKT mastery for {result.concept}: {Math.round(result.mastery * 100)}%
            </div>
          )}
        </div>
      )}
    </form>
  );
}
