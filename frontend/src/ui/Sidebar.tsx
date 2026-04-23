import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PointerEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { listConversations } from "../api";
import { clearToken } from "../auth";
import { ThemeToggle } from "./ThemeToggle";

const SIDEBAR_WIDTH_KEY = "kp-sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 236;
const MIN_SIDEBAR_WIDTH = 188;
const MAX_SIDEBAR_WIDTH = 360;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function getStoredSidebarWidth(): number {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
  const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(saved) ? clampSidebarWidth(saved) : DEFAULT_SIDEBAR_WIDTH;
}

function progressFromCount(n: number): number {
  if (n === 0) return 0;
  if (n <= 2) return 20;
  if (n <= 5) return 45;
  if (n <= 10) return 68;
  return 85;
}

function recentChatLabel(conversation: { id: number; subject: string | null; messages: { role: string; content: string }[] }): string {
  const firstUserMessage = conversation.messages.find((message) => message.role === "user")?.content.trim();
  if (firstUserMessage) {
    return firstUserMessage.length > 34 ? `${firstUserMessage.slice(0, 34)}…` : firstUserMessage;
  }
  return `Chat #${conversation.id}`;
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dragStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [isResizing, setIsResizing] = useState(false);

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
  });

  const projects = (() => {
    const map = new Map<string, { count: number; lastId: number }>();
    for (const c of conversations) {
      const subject = c.subject ?? "General";
      const existing = map.get(subject);
      if (!existing || c.id > existing.lastId) {
        map.set(subject, { count: (existing?.count ?? 0) + 1, lastId: c.id });
      } else {
        map.set(subject, { ...existing, count: existing.count + 1 });
      }
    }
    return Array.from(map.entries()).map(([subject, { count, lastId }]) => ({
      subject, count, lastId, progress: progressFromCount(count),
    }));
  })();

  const recentConversations = [...conversations]
    .sort((a, b) => b.id - a.id)
    .slice(0, 8);

  function handleSignOut() {
    clearToken();
    queryClient.clear();
    navigate("/");
  }

  const isActive = (path: string) => location.pathname.startsWith(path);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  function handleResizePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  }

  function handleResizePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const nextWidth = clampSidebarWidth(dragState.startWidth + event.clientX - dragState.startX);
    setSidebarWidth(nextWidth);
  }

  function stopResize(event: PointerEvent<HTMLButtonElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resetSidebarWidth() {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }

  return (
    <nav
      className={`sidebar ${isResizing ? "sidebar-resizing" : ""}`}
      style={{ width: `${sidebarWidth}px` }}
    >
      <div className="sidebar-brand">
        <div className="sidebar-logo">KP</div>
        <span className="sidebar-name">KnowledgePal</span>
      </div>

      <Link to="/sessions/new" className="sidebar-new-btn">
        <span>+</span>
        <span>New session</span>
      </Link>

      <div className="sidebar-scroll">
        <Link
          to="/dashboard"
          className={`sidebar-item ${location.pathname === "/dashboard" ? "active" : ""}`}
        >
          <em className="sidebar-item-icon">⊞</em>
          <span className="sidebar-item-label">Dashboard</span>
        </Link>

        {projects.length > 0 && (
          <>
            <div className="sidebar-section">Projects</div>
            {projects.map(({ subject, count, progress }) => (
              <Link
                key={subject}
                to={`/projects/${encodeURIComponent(subject)}`}
                className={`sidebar-project ${isActive(`/projects/${encodeURIComponent(subject)}`) ? "active" : ""}`}
              >
                <span className="sidebar-project-name">{subject}</span>
                <div className="sidebar-project-progress">
                  <div className="sidebar-project-fill" style={{ width: `${progress}%` }} />
                </div>
                <span className="sidebar-project-meta">{count} session{count !== 1 ? "s" : ""}</span>
              </Link>
            ))}
          </>
        )}

        {recentConversations.length > 0 && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">Recent</div>
            {recentConversations.map((c) => {
              const project = c.subject ?? "General";
              return (
                <Link
                  key={c.id}
                  to={`/sessions/${c.id}`}
                  className={`sidebar-item ${location.pathname === `/sessions/${c.id}` ? "active" : ""}`}
                  title={`${project} · Chat #${c.id}`}
                >
                  <em className="sidebar-item-icon">◎</em>
                  <span className="sidebar-item-label">
                    {recentChatLabel(c)}
                    <span className="sidebar-item-sub">{project}</span>
                  </span>
                </Link>
              );
            })}
          </>
        )}

        <div className="sidebar-divider" />

        <Link
          to="/materials"
          className={`sidebar-item ${isActive("/materials") ? "active" : ""}`}
        >
          <em className="sidebar-item-icon">📂</em>
          <span className="sidebar-item-label">Materials</span>
        </Link>

        <Link
          to="/history"
          className={`sidebar-item ${isActive("/history") ? "active" : ""}`}
        >
          <em className="sidebar-item-icon">◷</em>
          <span className="sidebar-item-label">History</span>
        </Link>
      </div>

      <div className="sidebar-footer">
        <Link
          to="/profile"
          className={`sidebar-item ${isActive("/profile") ? "active" : ""}`}
        >
          <em className="sidebar-item-icon">◉</em>
          <span className="sidebar-item-label">Profile</span>
        </Link>

        <Link
          to="/settings"
          className={`sidebar-item ${isActive("/settings") ? "active" : ""}`}
        >
          <em className="sidebar-item-icon">⚙</em>
          <span className="sidebar-item-label">Settings</span>
        </Link>

        <ThemeToggle />
        <button className="sidebar-item" onClick={handleSignOut} type="button" style={{ width: "100%" }}>
          <em className="sidebar-item-icon">↩</em>
          <span className="sidebar-item-label">Sign out</span>
        </button>
      </div>

      <button
        aria-label="Resize sidebar"
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        className="sidebar-resize-handle"
        onDoubleClick={resetSidebarWidth}
        onPointerCancel={stopResize}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={stopResize}
        title="Drag to resize. Double-click to reset."
        type="button"
      />
    </nav>
  );
}
