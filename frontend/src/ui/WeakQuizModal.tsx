import { useState } from "react";
import { createPortal } from "react-dom";

import type { AttemptResult, PracticeQuizItem, QuizData } from "../types";
import { QuizCard } from "./QuizCard";

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
    <div className="wq-results">
      <div className="wq-results-score">{correct} / {total}</div>
      <div className="wq-results-label">correct</div>
      <div className="wq-score-bar">
        <div className="wq-score-fill" style={{ width: `${(correct / total) * 100}%` }} />
      </div>
      <p className="wq-results-message">
        {correct === total
          ? "Perfect score! These areas are looking strong."
          : correct >= Math.ceil(total / 2)
          ? "Good progress! Keep reviewing the concepts you missed."
          : "These topics need more work. Try another session focused on these areas."}
      </p>
      <button className="button button-primary" onClick={onClose} type="button">
        Done
      </button>
    </div>
  ) : (
    <>
      <div className="wq-progress-row">
        <span className="wq-progress-text">Question {index + 1} of {total}</span>
      </div>
      <div className="wq-progress-bar">
        <div className="wq-progress-fill" style={{ width: `${(index / total) * 100}%` }} />
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
        <button className="button button-primary wq-next-btn" onClick={handleNext} type="button">
          {index + 1 < total ? "Next question" : "See results"}
        </button>
      )}
    </>
  );

  return createPortal(
    <div
      className="wq-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="wq-modal">
        <div className="wq-header">
          <span className="wq-title">Practice: Weak Areas</span>
          <button aria-label="Close" className="wq-close" onClick={onClose} type="button">
            ✕
          </button>
        </div>
        <div className="wq-body">{content}</div>
      </div>
    </div>,
    document.body,
  );
}
