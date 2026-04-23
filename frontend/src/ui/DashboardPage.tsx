import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getCurrentUser, listConversations } from "../api";
import type { Conversation } from "../types";

const SUBJECT_ICONS: Record<string, string> = {
  biology: "🧬", chemistry: "⚗️", physics: "⚛️", math: "∑",
  history: "📜", english: "📝", computer: "💻", economics: "📈",
  psychology: "🧠", default: "📖",
};

function subjectIcon(subject: string): string {
  const key = subject.toLowerCase();
  for (const [word, icon] of Object.entries(SUBJECT_ICONS)) {
    if (key.includes(word)) return icon;
  }
  return SUBJECT_ICONS.default;
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function deriveProgress(convs: Conversation[]): {
  progress: number;
  badge: string;
  tooltip: string;
  nextReview: string[];
} {
  const covered = new Set<string>();
  const struggled = new Set<string>();
  let nextReview: string[] = [];
  let latestSummaryAt = "";

  for (const c of convs) {
    if (!c.summary) continue;
    c.summary.covered.forEach((t) => covered.add(t));
    c.summary.struggled_with.forEach((t) => struggled.add(t));
    if (c.created_at > latestSummaryAt) {
      latestSummaryAt = c.created_at;
      nextReview = c.summary.next_review;
    }
  }

  const hasSummary = covered.size > 0 || struggled.size > 0;

  if (!hasSummary) {
    const n = convs.length;
    const progress = n === 0 ? 0 : n <= 2 ? 20 : n <= 5 ? 45 : n <= 10 ? 68 : 85;
    return { progress, badge: `${n} session${n !== 1 ? "s" : ""}`, tooltip: "Complete a session to see real progress", nextReview: [] };
  }

  const knownTotal = covered.size + nextReview.length;
  const progress = knownTotal > 0 ? Math.min(94, Math.round((covered.size / knownTotal) * 100)) : 30;
  const weakCount = struggled.size;
  const badge = `${covered.size} topic${covered.size !== 1 ? "s" : ""} covered`;
  const tooltip = [
    `${covered.size} topic${covered.size !== 1 ? "s" : ""} covered`,
    weakCount > 0 ? `${weakCount} area${weakCount !== 1 ? "s" : ""} to strengthen` : null,
    nextReview.length > 0 ? `${nextReview.length} topic${nextReview.length !== 1 ? "s" : ""} to review` : null,
  ].filter(Boolean).join(" · ");

  return { progress, badge, tooltip, nextReview };
}

export function DashboardPage() {
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
  });

  const projects = (() => {
    const map = new Map<string, { convs: Conversation[]; lastActive: string }>();
    for (const c of conversations) {
      const subject = c.subject ?? "General";
      const existing = map.get(subject) ?? { convs: [], lastActive: c.created_at };
      existing.convs.push(c);
      if (c.created_at > existing.lastActive) existing.lastActive = c.created_at;
      map.set(subject, existing);
    }
    return Array.from(map.entries()).map(([subject, { convs, lastActive }]) => {
      const { progress, badge, tooltip, nextReview } = deriveProgress(convs);
      return {
        subject,
        sessions: convs,
        lastActive,
        progress,
        badge,
        tooltip,
        nextReview,
        latestId: Math.max(...convs.map((c) => c.id)),
      };
    });
  })();

  const displayName = user?.name?.trim() || user?.email.split("@")[0] || "there";
  const firstName = displayName.split(/\s+/)[0];

  return (
    <div className="dashboard">
      <div className="dashboard-greeting">
        <h1>{timeOfDayGreeting()}, {firstName}</h1>
        <p>Your study projects and recent activity.</p>
      </div>

      <div>
        <div className="section-header" style={{ marginBottom: "0.875rem" }}>
          <span className="section-title">Your projects</span>
          <Link to="/start/topic" className="button button-primary" style={{ fontSize: "0.8rem", padding: "0.45rem 0.875rem" }}>
            + New project
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📚</div>
            <h3>No projects yet</h3>
            <p>Start your first tutoring session to create a project. The agent will track your progress over time.</p>
            <Link to="/start/topic" className="button button-primary">Start a session</Link>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map(({ subject, sessions, progress, badge, tooltip, nextReview, lastActive }) => (
              <Link key={subject} to={`/projects/${encodeURIComponent(subject)}`} className="project-card">
                <div className="project-card-header">
                  <div className="project-card-icon">{subjectIcon(subject)}</div>
                  <span className="project-card-badge" title={tooltip}>{badge}</span>
                </div>
                <div className="project-card-name">{subject}</div>
                {nextReview.length > 0 ? (
                  <div className="project-card-hint">
                    Next: {nextReview.slice(0, 2).join(", ")}{nextReview.length > 2 ? "…" : ""}
                  </div>
                ) : (
                  <div className="project-card-topic">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</div>
                )}
                <div className="progress-bar" title={tooltip}>
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="project-card-footer">
                  <span className="project-card-sessions">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</span>
                  <span className="project-card-mastery">{formatDate(lastActive)}</span>
                </div>
              </Link>
            ))}

            <Link to="/start/topic" className="project-card project-card-new">
              <div className="project-card-new-icon">+</div>
              <span>New project</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
