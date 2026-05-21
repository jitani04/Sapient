import { useState } from "react";
import { createPortal } from "react-dom";

import type { AttemptResult, PracticeQuizItem, QuizData } from "../types";
import { QuizCard } from "./QuizCard";
import { buttonClass } from "./buttonClass";

interface Props {
  quizzes: PracticeQuizItem[];
  onClose: () => void;
}

export function WeakQuizModal({ quizzes, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [answeredCurrent, setAnsweredCurrent] = useState(false);

  const total = quizzes.length;
  const done = index >= total;
  const correct = results.filter((r) => r.is_correct).length;

  function handleAnswered(result: AttemptResult) {
    setResults((r) => [...r, result]);
    setAnsweredCurrent(true);
  }

  function handleNext() {
    setIndex((i) => i + 1);
    setAnsweredCurrent(false);
  }

  const currentQuiz = quizzes[index];
  const currentAsQuizData: QuizData | null = currentQuiz
    ? {
        quiz_id: currentQuiz.id,
        question: currentQuiz.question,
        concept: currentQuiz.concept,
        quiz_type: currentQuiz.quiz_type,
        options: currentQuiz.options,
      }
    : null;

  const content = done ? (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <div className="text-5xl font-extrabold leading-none text-[var(--text-main)]">
        {correct} / {total}
      </div>
      <div className="-mt-1 text-[0.85rem] text-[var(--text-soft)]">correct</div>
      <div className="h-2 w-full max-w-[280px] overflow-hidden rounded bg-[var(--border)]">
        <div
          className="h-full rounded bg-[var(--accent)] transition-[width] duration-500"
          style={{ width: `${(correct / total) * 100}%` }}
        />
      </div>
      <p className="m-0 max-w-[340px] text-[0.88rem] text-[var(--text-soft)]">
        {correct === total
          ? "Perfect score! These areas are looking strong."
          : correct >= Math.ceil(total / 2)
          ? "Good progress! Keep reviewing the concepts you missed."
          : "These topics need more work. Try another session focused on these areas."}
      </p>
      <button className={buttonClass("primary")} onClick={onClose} type="button">
        Done
      </button>
    </div>
  ) : (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[0.78rem] text-[var(--text-soft)]">
          Question {index + 1} of {total}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-[2px] bg-[var(--border)]">
        <div
          className="h-full rounded-[2px] bg-[var(--accent)] transition-[width] duration-300"
          style={{ width: `${(index / total) * 100}%` }}
        />
      </div>
      {currentAsQuizData && (
        <QuizCard
          key={currentQuiz.id}
          quiz={currentAsQuizData}
          onAnswered={handleAnswered}
          hideSkip
        />
      )}
      {answeredCurrent && (
        <button
          className={buttonClass("primary", "mt-1 self-end")}
          onClick={handleNext}
          type="button"
        >
          {index + 1 < total ? "Next question" : "See results"}
        </button>
      )}
    </>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(0,0,0,0.6)] p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[580px] flex-col overflow-hidden rounded-2xl border border-[var(--border-dark)] bg-[var(--surface-dark)]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-b-[var(--border)] px-5 py-4">
          <span className="text-[0.9rem] font-semibold text-[var(--text-main)]">Practice: Weak Areas</span>
          <button
            aria-label="Close"
            className="cursor-pointer rounded border-none bg-transparent px-[0.4rem] py-1 text-base text-[var(--text-soft)] transition-colors hover:bg-[var(--sidebar-hover)]"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">{content}</div>
      </div>
    </div>,
    document.body,
  );
}
