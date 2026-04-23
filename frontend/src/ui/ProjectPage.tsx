import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { createConversation, generateSummary, getProjectProfile, getProjectProgress, listConversations } from "../api";
import type { Conversation, SessionSummary } from "../types";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function duration(c: Conversation): string {
  const msgs = c.messages;
  if (msgs.length < 2) return "—";
  const mins = Math.max(1, Math.round(
    (new Date(msgs[msgs.length - 1].created_at).getTime() - new Date(msgs[0].created_at).getTime()) / 60000
  ));
  return `${mins} min`;
}

const LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  some: "Some experience",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

function buildSummaryText(subject: string, sessionNum: number, date: string, s: SessionSummary): string {
  const lines: string[] = [
    `Session ${sessionNum} Summary — ${subject}`,
    `Date: ${date}`,
    "",
    "COVERED",
    ...s.covered.map((t) => `• ${t}`),
    "",
  ];
  if (s.struggled_with.length > 0) {
    lines.push("STRUGGLED WITH", ...s.struggled_with.map((t) => `• ${t}`), "");
  }
  lines.push(
    "KEY CONCEPTS",
    ...s.key_concepts.map((t) => `• ${t}`),
    "",
    "REVIEW NEXT",
    ...s.next_review.map((t) => `• ${t}`),
  );
  return lines.join("\n");
}

function downloadSummary(subject: string, sessionNum: number, c: Conversation) {
  const s = c.summary as SessionSummary;
  const text = buildSummaryText(subject, sessionNum, formatDate(c.created_at), s);
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${subject.replace(/\s+/g, "-").toLowerCase()}-session-${sessionNum}-summary.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ProjectPage() {
  const { subject } = useParams<{ subject: string }>();
  const decoded = decodeURIComponent(subject ?? "");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
  });

  const { data: profile } = useQuery({
    queryKey: ["project-profile", decoded],
    queryFn: () => getProjectProfile(decoded),
  });

  const { data: progress } = useQuery({
    queryKey: ["project-progress", decoded],
    queryFn: () => getProjectProgress(decoded),
  });

  const sessions = conversations
    .filter((c) => c.subject === decoded)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const newSessionMutation = useMutation({
    mutationFn: () => createConversation(decoded),
    onSuccess: async (c) => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`/sessions/${c.id}`);
    },
  });

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleGenerateSummary(conversationId: number) {
    setGeneratingId(conversationId);
    setGenerateError(null);
    try {
      await generateSummary(conversationId);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setExpandedIds((prev) => new Set([...prev, conversationId]));
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate summary.");
    } finally {
      setGeneratingId(null);
    }
  }

  const totalMessages = sessions.reduce((sum, c) => sum + c.messages.length, 0);
  const sessionsSorted = [...sessions].reverse();
  const maxMessages = Math.max(...sessionsSorted.map((c) => c.messages.length), 1);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">{decoded}</h1>
          <p className="page-subtitle">
            {profile?.level ? LEVEL_LABELS[profile.level] ?? profile.level : null}
            {profile?.level && " · "}
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} · {totalMessages} messages
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link
            to={`/projects/${encodeURIComponent(decoded)}/setup`}
            className="button button-secondary"
            style={{ fontSize: "0.8rem", padding: "0.45rem 0.875rem" }}
          >
            Edit profile
          </Link>
          <button
            className="button button-primary"
            disabled={newSessionMutation.isPending}
            onClick={() => newSessionMutation.mutate()}
            type="button"
          >
            {newSessionMutation.isPending ? "Creating…" : "+ New session"}
          </button>
        </div>
      </div>

      {profile?.goals && (
        <div className="project-goals">
          <span className="project-goals-label">Goals</span>
          <span className="project-goals-text">{profile.goals}</span>
        </div>
      )}

      {/* Progress section */}
      {progress && (progress.quizzes_attempted > 0 || progress.concepts_covered.length > 0) && (
        <div className="progress-section">
          <div className="progress-section-title">Progress</div>
          <div className="progress-section-grid">

            {/* Quiz accuracy */}
            {progress.quizzes_attempted > 0 && (
              <div className="progress-stat-card">
                <div className="progress-stat-label">Quiz accuracy</div>
                <div className="progress-stat-value">
                  {progress.pass_rate !== null ? `${progress.pass_rate}%` : "—"}
                </div>
                <div className="progress-stat-sub">
                  {progress.quizzes_passed} / {progress.quizzes_attempted} correct
                </div>
                <div className="progress-bar progress-bar-sm" style={{ marginTop: "0.5rem" }}>
                  <div
                    className="progress-fill"
                    style={{ width: `${progress.pass_rate ?? 0}%`, background: (progress.pass_rate ?? 0) >= 70 ? "var(--success, #22c55e)" : "var(--accent)" }}
                  />
                </div>
              </div>
            )}

            {/* Concepts covered */}
            {progress.concepts_covered.length > 0 && (
              <div className="progress-stat-card progress-stat-card-wide">
                <div className="progress-stat-label">Concepts covered</div>
                <div className="progress-topic-list">
                  {progress.concepts_covered.map((t) => (
                    <span key={t} className="progress-topic-chip progress-topic-chip-covered">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Weak areas */}
            {progress.weak_areas.length > 0 && (
              <div className="progress-stat-card progress-stat-card-wide">
                <div className="progress-stat-label">Areas to strengthen</div>
                <div className="progress-topic-list">
                  {progress.weak_areas.map((t) => (
                    <span key={t} className="progress-topic-chip progress-topic-chip-weak">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Next review */}
            {progress.next_review.length > 0 && (
              <div className="progress-stat-card progress-stat-card-wide">
                <div className="progress-stat-label">Review next session</div>
                <div className="progress-topic-list">
                  {progress.next_review.map((t) => (
                    <span key={t} className="progress-topic-chip progress-topic-chip-review">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="project-two-col">

        {/* Mind map */}
        <div className="content-card">
          <div className="content-card-title">
            Learning map
            {!profile?.mind_map && (
              <Link
                to={`/projects/${encodeURIComponent(decoded)}/setup`}
                className="content-card-action"
              >
                Generate
              </Link>
            )}
          </div>
          {profile?.mind_map ? (
            <div className="mindmap">
              <div className="mindmap-flow">
                <div className="mindmap-root">{profile.mind_map.subject}</div>
                {profile.mind_map.nodes.map((node, index) => (
                  <div key={node.topic} className="mindmap-node" style={{ "--node-index": index } as CSSProperties}>
                    <div className="mindmap-node-title">{node.topic}</div>
                    <div className="mindmap-subtopics">
                      {node.subtopics.map((sub, subIndex) => (
                        <span
                          key={sub}
                          className="mindmap-subtopic"
                          style={{ "--subtopic-index": subIndex } as CSSProperties}
                        >
                          {sub}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: "0.875rem" }}>
              Complete the project setup to generate a learning map.
            </p>
          )}
        </div>

        {/* Activity chart */}
        <div className="content-card">
          <div className="content-card-title">Activity</div>
          {sessionsSorted.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.875rem" }}>No sessions yet.</p>
          ) : (
            <div className="trend-chart">
              {sessionsSorted.map((c, i) => {
                const pct = Math.max(4, Math.round((c.messages.length / maxMessages) * 100));
                return (
                  <Link key={c.id} to={`/sessions/${c.id}`} className="trend-bar-wrap">
                    <div className="trend-bar" style={{ height: `${pct}%` }} />
                    <div className="trend-bar-label">S{i + 1}</div>
                    <div className="trend-bar-tooltip">
                      {formatDate(c.created_at)}<br />
                      {c.messages.length} messages
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sessions list */}
      <div className="content-card-title" style={{ marginBottom: "0.75rem" }}>Sessions</div>
      {generateError && (
        <p style={{ fontSize: "0.8rem", color: "var(--error, #e55)", marginBottom: "0.5rem" }}>{generateError}</p>
      )}
      {sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💬</div>
          <h3>No sessions yet</h3>
          <p>Start your first session for this project.</p>
          <button className="button button-primary" onClick={() => newSessionMutation.mutate()} type="button">
            Start session
          </button>
        </div>
      ) : (
        <div className="content-card" style={{ padding: 0, overflow: "hidden" }}>
          {sessions.map((c, i) => {
            const sessionNum = sessions.length - i;
            const isExpanded = expandedIds.has(c.id);
            const hasSummary = !!c.summary;
            return (
              <div key={c.id} className="project-session-wrap">
                <div className="project-session-row" style={{ borderTop: i === 0 ? "none" : undefined }}>
                  <div className="project-session-info">
                    <div className="project-session-num">Session {sessionNum}</div>
                    <div className="project-session-meta">
                      {formatDate(c.created_at)}
                      {c.messages.length > 0 && <> · {c.messages.length} messages · {duration(c)}</>}
                      {c.messages.length === 0 && <> · No messages yet</>}
                      {hasSummary && <span className="session-summary-badge">Summary</span>}
                    </div>
                  </div>
                  <div className="project-session-actions">
                    {hasSummary ? (
                      <>
                        <button
                          className={`button button-secondary session-summary-toggle ${isExpanded ? "active" : ""}`}
                          onClick={() => toggleExpanded(c.id)}
                          type="button"
                          style={{ fontSize: "0.78rem", padding: "0.4rem 0.8rem" }}
                        >
                          {isExpanded ? "Hide summary ↑" : "View summary ↓"}
                        </button>
                        <button
                          className="button button-secondary session-download-btn"
                          onClick={() => downloadSummary(decoded, sessionNum, c)}
                          title="Download summary as text file"
                          type="button"
                          style={{ fontSize: "0.8rem", padding: "0.4rem 0.65rem" }}
                        >
                          ↓
                        </button>
                      </>
                    ) : (
                      <button
                        className="button button-secondary"
                        disabled={generatingId === c.id || c.messages.length < 2}
                        onClick={() => void handleGenerateSummary(c.id)}
                        title={c.messages.length < 2 ? "Session is too short to summarize" : undefined}
                        type="button"
                        style={{ fontSize: "0.78rem", padding: "0.4rem 0.8rem" }}
                      >
                        {generatingId === c.id ? "Generating…" : "Summarize"}
                      </button>
                    )}
                    <Link
                      className="button button-secondary"
                      to={`/sessions/${c.id}`}
                      style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
                    >
                      {c.messages.length === 0 ? "Open" : "Resume"}
                    </Link>
                  </div>
                </div>

                {isExpanded && hasSummary && (
                  <div className="session-summary-panel">
                    <div className="session-summary-grid">
                      <div className="session-summary-group">
                        <div className="session-summary-label">Covered</div>
                        <ul>{(c.summary as SessionSummary).covered.map((t, j) => <li key={j}>{t}</li>)}</ul>
                      </div>
                      {(c.summary as SessionSummary).struggled_with.length > 0 && (
                        <div className="session-summary-group">
                          <div className="session-summary-label">Struggled With</div>
                          <ul>{(c.summary as SessionSummary).struggled_with.map((t, j) => <li key={j}>{t}</li>)}</ul>
                        </div>
                      )}
                      <div className="session-summary-group">
                        <div className="session-summary-label">Key Concepts</div>
                        <ul>{(c.summary as SessionSummary).key_concepts.map((t, j) => <li key={j}>{t}</li>)}</ul>
                      </div>
                      <div className="session-summary-group">
                        <div className="session-summary-label">Review Next</div>
                        <ul>{(c.summary as SessionSummary).next_review.map((t, j) => <li key={j}>{t}</li>)}</ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
