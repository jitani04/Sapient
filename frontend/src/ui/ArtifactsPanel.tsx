import { useState } from "react";
import { deleteKeyIdea, generateSummary } from "../api";
import type { KeyIdea, SessionSummary } from "../types";

interface Props {
  conversationId: number;
  keyIdeas: KeyIdea[];
  onClose: () => void;
  onIdeaDeleted: (id: number) => void;
}

export function ArtifactsPanel({ conversationId, keyIdeas, onClose, onIdeaDeleted }: Props) {
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  async function handleGenerateSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const s = await generateSummary(conversationId);
      setSummary(s);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Failed to generate summary.");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteKeyIdea(id);
      onIdeaDeleted(id);
    } catch {
      // ignore silently — item stays visible
    }
  }

  return (
    <div className="artifacts-panel">
      <div className="artifacts-header">
        <span className="artifacts-title">Session Notes</span>
        <button className="sources-close" onClick={onClose} type="button">×</button>
      </div>
      <div className="artifacts-body">
        <div className="artifacts-section">
          <div className="artifacts-section-label">Key Ideas</div>
          {keyIdeas.length === 0 ? (
            <p className="artifacts-empty">Key ideas will appear here as you learn.</p>
          ) : (
            keyIdeas.map((idea) => (
              <div key={idea.id} className="key-idea-item">
                <div className="key-idea-top">
                  <span className="key-idea-concept">{idea.concept}</span>
                  <button
                    className="key-idea-delete"
                    onClick={() => void handleDelete(idea.id)}
                    title="Remove note"
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <p className="key-idea-summary">{idea.summary}</p>
              </div>
            ))
          )}
        </div>

        <div className="artifacts-section">
          <div className="artifacts-section-label">Session Summary</div>
          {summary ? (
            <div className="summary-content">
              <div className="summary-group">
                <div className="summary-group-label">Covered</div>
                <ul>{summary.covered.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
              {summary.struggled_with.length > 0 && (
                <div className="summary-group">
                  <div className="summary-group-label">Struggled With</div>
                  <ul>{summary.struggled_with.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
              )}
              <div className="summary-group">
                <div className="summary-group-label">Key Concepts</div>
                <ul>{summary.key_concepts.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
              <div className="summary-group">
                <div className="summary-group-label">Review Next</div>
                <ul>{summary.next_review.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
              <button
                className="artifacts-btn artifacts-btn-secondary"
                onClick={() => setSummary(null)}
                type="button"
              >
                Regenerate
              </button>
            </div>
          ) : (
            <>
              {summaryError && <p className="artifacts-error">{summaryError}</p>}
              <button
                className="artifacts-btn"
                disabled={summaryLoading}
                onClick={() => void handleGenerateSummary()}
                type="button"
              >
                {summaryLoading ? "Generating…" : "Generate Summary"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
