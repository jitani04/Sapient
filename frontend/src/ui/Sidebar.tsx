import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MouseEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutGrid,
  CalendarDays,
  Search,
  User,
  Settings,
  LogOut,
  Plus,
  Trash2,
} from "lucide-react";

import { deleteConversation, listConversations } from "../api";
import { clearToken } from "../auth";
import { formatSubjectName } from "../subjects";
import { ThemeToggle } from "./ThemeToggle";

const SIDEBAR_WIDTH_KEY = "sapient-sidebar-width";
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

function recentChatLabel(conversation: { id: number; title: string | null; subject: string | null }): string {
  const title = conversation.title?.trim();
  if (title) return title.length > 34 ? `${title.slice(0, 34)}…` : title;
  return `Study session #${conversation.id}`;
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

  const deleteMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_data, conversationId) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.removeQueries({ queryKey: ["conversation", conversationId] });
      queryClient.removeQueries({ queryKey: ["conversation-quizzes", conversationId] });
      queryClient.removeQueries({ queryKey: ["key-ideas", conversationId] });
      if (location.pathname === `/sessions/${conversationId}`) {
        navigate("/dashboard");
      }
    },
  });

  function handleDeleteChat(event: MouseEvent<HTMLButtonElement>, conversationId: number) {
    event.preventDefault();
    event.stopPropagation();
    if (deleteMutation.isPending) return;
    if (!window.confirm("Delete this study session? This can't be undone.")) return;
    deleteMutation.mutate(conversationId);
  }

  const projects = (() => {
    const map = new Map<string, { lastId: number }>();
    for (const c of conversations) {
      const subject = c.subject ?? "General";
      const existing = map.get(subject);
      if (!existing || c.id > existing.lastId) {
        map.set(subject, { lastId: c.id });
      }
    }
    return Array.from(map.entries())
      .map(([subject, { lastId }]) => ({ subject, lastId }))
      .sort((a, b) => b.lastId - a.lastId);
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        navigate("/search");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

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
        <div className="sidebar-logo">S</div>
        <span className="sidebar-name">Sapient</span>
      </div>

      <Link to="/sessions/new" className="sidebar-new-btn">
        <Plus size={16} strokeWidth={2.2} />
        <span>New study session</span>
      </Link>

      <div className="sidebar-scroll">
        <Link
          to="/dashboard"
          className={`sidebar-item ${location.pathname === "/dashboard" ? "active" : ""}`}
        >
          <span className="sidebar-item-icon"><LayoutGrid size={16} strokeWidth={1.8} /></span>
          <span className="sidebar-item-label">Dashboard</span>
        </Link>

        <Link
          to="/search"
          className={`sidebar-item ${isActive("/search") ? "active" : ""}`}
        >
          <span className="sidebar-item-icon"><Search size={16} strokeWidth={1.8} /></span>
          <span className="sidebar-item-label">Search</span>
          <span className="sidebar-shortcut">⌘K</span>
        </Link>

        <Link
          to="/calendar"
          className={`sidebar-item ${isActive("/calendar") ? "active" : ""}`}
        >
          <span className="sidebar-item-icon"><CalendarDays size={16} strokeWidth={1.8} /></span>
          <span className="sidebar-item-label">Calendar</span>
        </Link>

        {projects.length > 0 && (
          <>
            <div className="sidebar-section">Subjects</div>
            {projects.map(({ subject }) => (
              <Link
                key={subject}
                to={`/projects/${encodeURIComponent(subject)}`}
                className={`sidebar-project ${isActive(`/projects/${encodeURIComponent(subject)}`) ? "active" : ""}`}
              >
                <span className="sidebar-project-name">{formatSubjectName(subject)}</span>
              </Link>
            ))}
          </>
        )}

        {recentConversations.length > 0 && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">Recent</div>
            {recentConversations.map((c) => {
              const project = formatSubjectName(c.subject ?? "General");
              return (
                <Link
                  key={c.id}
                  to={`/sessions/${c.id}`}
                  className={`sidebar-item sidebar-chat-item sidebar-item-deletable ${location.pathname === `/sessions/${c.id}` ? "active" : ""}`}
                  title={`${project} · Study session #${c.id}`}
                >
                  <span className="sidebar-item-label">
                    {recentChatLabel(c)}
                    <span className="sidebar-item-sub">{project}</span>
                  </span>
                  <button
                    aria-label={`Delete ${recentChatLabel(c)}`}
                    className="sidebar-item-delete"
                    disabled={deleteMutation.isPending}
                    onClick={(e) => handleDeleteChat(e, c.id)}
                    title="Delete chat"
                    type="button"
                  >
                    <Trash2 size={14} strokeWidth={1.8} />
                  </button>
                </Link>
              );
            })}
          </>
        )}

        <div className="sidebar-divider" />

      </div>

      <div className="sidebar-footer">
        <Link
          to="/profile"
          className={`sidebar-item ${isActive("/profile") ? "active" : ""}`}
        >
          <span className="sidebar-item-icon"><User size={16} strokeWidth={1.8} /></span>
          <span className="sidebar-item-label">Profile</span>
        </Link>

        <Link
          to="/settings"
          className={`sidebar-item ${isActive("/settings") ? "active" : ""}`}
        >
          <span className="sidebar-item-icon"><Settings size={16} strokeWidth={1.8} /></span>
          <span className="sidebar-item-label">Settings</span>
        </Link>

        <ThemeToggle />
        <button className="sidebar-item" onClick={handleSignOut} type="button" style={{ width: "100%" }}>
          <span className="sidebar-item-icon"><LogOut size={16} strokeWidth={1.8} /></span>
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
