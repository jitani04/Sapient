import { useState } from "react";

import { skipQuizQuestion, submitQuizAttempt } from "../api";
import type { AttemptResult, QuizData } from "../types";

interface Props {
  quiz: QuizData;
  onAnswered?: (result: AttemptResult, answer: string) => void;
  onSkipped?: (result: AttemptResult) => void;
}

type PendingAction = "submit" | "skip" | null;

export function QuizCard({ quiz, onAnswered, onSkipped }: Props) {
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
  const resultClassName = result
    ? `quiz-result ${result.is_correct ? "quiz-result-correct" : skipped ? "quiz-result-skipped" : "quiz-result-wrong"}`
    : "quiz-result";
  const resultHeader = result?.is_correct ? "✓ Correct!" : skipped ? "Skipped" : "✗ Not quite";

  return (
    <div className="quiz-card">
      <div className="quiz-header">
        <span className="quiz-badge">Knowledge Check</span>
      </div>

      <p className="quiz-question">{quiz.question}</p>

      {quiz.quiz_type === "multiple_choice" && quiz.options ? (
        <div className="quiz-options">
          {quiz.options.map((opt) => {
            let cls = "quiz-option";
            if (submitted && result) {
              if (opt === result.correct_answer) cls += " quiz-option-correct";
              else if (opt === selected && !result.is_correct) cls += " quiz-option-wrong";
            } else if (opt === selected) {
              cls += " quiz-option-selected";
            }
            return (
              <button
                key={opt}
                className={cls}
                disabled={submitted || isPending}
                onClick={() => setSelected(opt)}
                type="button"
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : (
        <textarea
          className="quiz-input"
          disabled={submitted || isPending}
          onChange={(e) => setSelected(e.target.value)}
          placeholder="Type your answer…"
          rows={3}
          value={selected}
        />
      )}

      {error && <p className="error-text">{error}</p>}

      {!submitted && (
        <div className="quiz-actions">
          <button
            className="button button-primary quiz-submit"
            disabled={!selected.trim() || isPending}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {pendingAction === "submit" ? "Checking…" : "Submit answer"}
          </button>
          <button
            className="button button-secondary quiz-skip"
            disabled={isPending}
            onClick={() => void handleSkip()}
            type="button"
          >
            {pendingAction === "skip" ? "Skipping…" : "Skip question"}
          </button>
        </div>
      )}

      {result && (
        <div className={resultClassName}>
          <div className="quiz-result-header">
            {resultHeader}
          </div>
          {!result.is_correct && (
            <div className="quiz-result-answer">
              Correct answer: <strong>{result.correct_answer}</strong>
            </div>
          )}
          <div className="quiz-result-explanation">{result.explanation}</div>
        </div>
      )}
    </div>
  );
}
