import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { FormEvent, useMemo, useState } from "react";

import {
  createAssignment,
  createCalendarFeed,
  deleteAssignment,
  deleteCalendarFeed,
  listAssignments,
  listCalendarFeeds,
  listProjectProfiles,
  listSmartReminders,
  syncCalendarFeed,
  updateAssignment,
} from "../api";
import { formatSubjectName } from "../subjects";
import type { Assignment, AssignmentInput, CalendarFeed, SmartReminder } from "../types";

const WEEK_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABEL = (year: number, month: number) =>
  new Date(year, month, 1).toLocaleString([], { month: "long", year: "numeric" });

function localDateTimeValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoFromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function formatDueShort(value: string): string {
  return new Date(value).toLocaleString([], { hour: "numeric", minute: "2-digit" });
}

function formatDueLong(value: string): string {
  return new Date(value).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dueDateKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function reminderTone(reminder: SmartReminder): string {
  if (reminder.severity === "overdue" || reminder.severity === "urgent") return "urgent";
  if (reminder.severity === "soon") return "soon";
  return "review";
}

function assignmentTone(assignment: Assignment, now: Date): "overdue" | "today" | "soon" | "later" {
  const due = new Date(assignment.due_at);
  if (due.getTime() < now.getTime() && !sameDay(due, now)) return "overdue";
  if (sameDay(due, now)) return "today";
  const days = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days <= 7) return "soon";
  return "later";
}

function sourceLabel(source: string): string {
  return source === "canvas" ? "Canvas" : "Sapient";
}

function buildMonthCells(year: number, month: number): Date[] {
  // First Monday on or before the 1st of the visible month.
  const firstOfMonth = new Date(year, month, 1);
  const dayOfWeek = (firstOfMonth.getDay() + 6) % 7; // Mon = 0
  const gridStart = new Date(year, month, 1 - dayOfWeek);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    cells.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return cells;
}

export function CalendarPage() {
  const queryClient = useQueryClient();
  const today = useMemo(() => startOfDay(new Date()), []);
  const [visibleMonth, setVisibleMonth] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [showCanvasForm, setShowCanvasForm] = useState(false);
  const [assignmentDraft, setAssignmentDraft] = useState<AssignmentInput>({
    title: "",
    subject: "",
    due_at: localDateTimeValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    description: "",
    source_url: "",
  });
  const [feedDraft, setFeedDraft] = useState({ name: "Canvas calendar", url: "", subject: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", "upcoming"],
    queryFn: () => listAssignments(),
    staleTime: 30_000,
  });
  const remindersQuery = useQuery({
    queryKey: ["smart-reminders"],
    queryFn: listSmartReminders,
    staleTime: 30_000,
  });
  const feedsQuery = useQuery({
    queryKey: ["calendar-feeds"],
    queryFn: listCalendarFeeds,
    staleTime: 30_000,
  });
  const projectsQuery = useQuery({
    queryKey: ["project-profiles"],
    queryFn: listProjectProfiles,
    staleTime: 30_000,
  });

  const subjectOptions = useMemo(() => (
    [...new Set((projectsQuery.data ?? []).map((profile) => profile.subject))]
      .sort((a, b) => a.localeCompare(b))
  ), [projectsQuery.data]);

  const assignmentsByDay = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const assignment of assignmentsQuery.data ?? []) {
      const key = dueDateKey(assignment.due_at);
      const list = map.get(key) ?? [];
      list.push(assignment);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
    }
    return map;
  }, [assignmentsQuery.data]);

  const monthCells = useMemo(
    () => buildMonthCells(visibleMonth.year, visibleMonth.month),
    [visibleMonth],
  );

  const upcomingList = useMemo(() => {
    const all = assignmentsQuery.data ?? [];
    if (!selectedDate) {
      const todayStart = today.getTime();
      return all
        .filter((a) => new Date(a.due_at).getTime() >= todayStart)
        .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
    }
    const key = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}`;
    return assignmentsByDay.get(key) ?? [];
  }, [assignmentsQuery.data, assignmentsByDay, selectedDate, today]);

  const invalidateCalendar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["assignments"] }),
      queryClient.invalidateQueries({ queryKey: ["smart-reminders"] }),
      queryClient.invalidateQueries({ queryKey: ["calendar-feeds"] }),
    ]);
  };

  const createAssignmentMutation = useMutation({
    mutationFn: createAssignment,
    onSuccess: async () => {
      setAssignmentDraft({
        title: "",
        subject: "",
        due_at: localDateTimeValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
        description: "",
        source_url: "",
      });
      setShowAssignmentForm(false);
      setFormError(null);
      await invalidateCalendar();
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : "Could not save assignment."),
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, completed }: { id: number; completed: boolean }) => updateAssignment(id, { completed }),
    onSuccess: invalidateCalendar,
  });

  const deleteAssignmentMutation = useMutation({
    mutationFn: deleteAssignment,
    onSuccess: invalidateCalendar,
  });

  const createFeedMutation = useMutation({
    mutationFn: createCalendarFeed,
    onSuccess: async () => {
      setFeedDraft({ name: "Canvas calendar", url: "", subject: "" });
      setShowCanvasForm(false);
      setFeedError(null);
      await invalidateCalendar();
    },
    onError: (err) => setFeedError(err instanceof Error ? err.message : "Could not connect calendar."),
  });

  const syncFeedMutation = useMutation({
    mutationFn: syncCalendarFeed,
    onSuccess: invalidateCalendar,
  });

  const deleteFeedMutation = useMutation({
    mutationFn: deleteCalendarFeed,
    onSuccess: invalidateCalendar,
  });

  function shiftMonth(delta: number) {
    setVisibleMonth(({ year, month }) => {
      const next = new Date(year, month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  function jumpToToday() {
    const now = new Date();
    setVisibleMonth({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDate(startOfDay(now));
  }

  function handleAssignmentSubmit(event: FormEvent) {
    event.preventDefault();
    const title = assignmentDraft.title.trim();
    if (!title) {
      setFormError("Add an assignment title.");
      return;
    }
    createAssignmentMutation.mutate({
      ...assignmentDraft,
      title,
      subject: assignmentDraft.subject?.trim() || null,
      description: assignmentDraft.description?.trim() || null,
      source_url: assignmentDraft.source_url?.trim() || null,
      due_at: isoFromLocalInput(assignmentDraft.due_at),
    });
  }

  function handleFeedSubmit(event: FormEvent) {
    event.preventDefault();
    if (!feedDraft.url.trim()) {
      setFeedError("Paste your Canvas calendar feed URL.");
      return;
    }
    createFeedMutation.mutate({
      name: feedDraft.name.trim() || "Canvas calendar",
      url: feedDraft.url.trim(),
      subject: feedDraft.subject.trim() || null,
    });
  }

  function handleDeleteAssignment(assignment: Assignment) {
    if (!window.confirm(`Delete "${assignment.title}"?`)) return;
    deleteAssignmentMutation.mutate(assignment.id);
  }

  function handleDeleteFeed(feed: CalendarFeed) {
    if (!window.confirm(`Remove "${feed.name}"? Imported assignments will stay on your calendar.`)) return;
    deleteFeedMutation.mutate(feed.id);
  }

  const now = new Date();

  return (
    <div className="page-shell calendar-page">
      <header className="calendar-hero">
        <div>
          <span className="calendar-eyebrow">Planning</span>
          <h1>Calendar</h1>
          <p>Track assignments, Canvas deadlines, and study reminders in one place.</p>
        </div>
        <div className="calendar-hero-actions">
          <button className="button button-secondary" onClick={() => setShowCanvasForm((open) => !open)} type="button">
            <LinkIcon size={15} strokeWidth={2} />
            Connect Canvas
          </button>
          <button className="button button-primary" onClick={() => setShowAssignmentForm((open) => !open)} type="button">
            <Plus size={15} strokeWidth={2} />
            Add assignment
          </button>
        </div>
      </header>

      {(showAssignmentForm || showCanvasForm) && (
        <div className="calendar-setup-grid">
          {showAssignmentForm && (
            <form className="calendar-form-card" onSubmit={handleAssignmentSubmit}>
              <div>
                <h2>Add assignment</h2>
                <p>Create a deadline manually. Canvas assignments will appear here too.</p>
              </div>
              <label>
                Title
                <input
                  value={assignmentDraft.title}
                  onChange={(event) => setAssignmentDraft((draft) => ({ ...draft, title: event.target.value }))}
                  placeholder="Fine Art exam"
                />
              </label>
              <div className="calendar-form-row">
                <label>
                  Subject
                  <select
                    value={assignmentDraft.subject ?? ""}
                    onChange={(event) => setAssignmentDraft((draft) => ({ ...draft, subject: event.target.value }))}
                  >
                    <option value="">No subject</option>
                    {subjectOptions.map((subject) => (
                      <option key={subject} value={subject}>{formatSubjectName(subject)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Due
                  <input
                    type="datetime-local"
                    value={assignmentDraft.due_at}
                    onChange={(event) => setAssignmentDraft((draft) => ({ ...draft, due_at: event.target.value }))}
                  />
                </label>
              </div>
              <label>
                Notes
                <textarea
                  rows={3}
                  value={assignmentDraft.description ?? ""}
                  onChange={(event) => setAssignmentDraft((draft) => ({ ...draft, description: event.target.value }))}
                  placeholder="What should Sapient help you prepare?"
                />
              </label>
              {formError ? <p className="error-text">{formError}</p> : null}
              <div className="calendar-form-actions">
                <button className="button button-secondary" onClick={() => setShowAssignmentForm(false)} type="button">Cancel</button>
                <button className="button button-primary" disabled={createAssignmentMutation.isPending} type="submit">
                  {createAssignmentMutation.isPending ? "Saving..." : "Save assignment"}
                </button>
              </div>
            </form>
          )}

          {showCanvasForm && (
            <form className="calendar-form-card" onSubmit={handleFeedSubmit}>
              <div>
                <h2>Connect Canvas</h2>
                <p>Paste your Canvas calendar feed URL. Sapient imports the deadlines and keeps this feed for future syncs.</p>
              </div>
              <label>
                Feed name
                <input
                  value={feedDraft.name}
                  onChange={(event) => setFeedDraft((draft) => ({ ...draft, name: event.target.value }))}
                />
              </label>
              <label>
                Canvas calendar URL
                <input
                  value={feedDraft.url}
                  onChange={(event) => setFeedDraft((draft) => ({ ...draft, url: event.target.value }))}
                  placeholder="webcal://canvas... or https://canvas..."
                />
              </label>
              <label>
                Default subject
                <select
                  value={feedDraft.subject}
                  onChange={(event) => setFeedDraft((draft) => ({ ...draft, subject: event.target.value }))}
                >
                  <option value="">Auto / no subject</option>
                  {subjectOptions.map((subject) => (
                    <option key={subject} value={subject}>{formatSubjectName(subject)}</option>
                  ))}
                </select>
              </label>
              {feedError ? <p className="error-text">{feedError}</p> : null}
              <div className="calendar-form-actions">
                <button className="button button-secondary" onClick={() => setShowCanvasForm(false)} type="button">Cancel</button>
                <button className="button button-primary" disabled={createFeedMutation.isPending} type="submit">
                  {createFeedMutation.isPending ? "Importing..." : "Import Canvas"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <section className="month-grid-card">
        <header className="month-grid-head">
          <div className="month-grid-nav">
            <button className="month-nav-btn" onClick={() => shiftMonth(-1)} type="button" aria-label="Previous month">
              <ChevronLeft size={16} strokeWidth={2} />
            </button>
            <h2>{MONTH_LABEL(visibleMonth.year, visibleMonth.month)}</h2>
            <button className="month-nav-btn" onClick={() => shiftMonth(1)} type="button" aria-label="Next month">
              <ChevronRight size={16} strokeWidth={2} />
            </button>
          </div>
          <button className="button button-ghost month-today-btn" onClick={jumpToToday} type="button">
            Today
          </button>
        </header>

        <div className="month-grid-weekdays">
          {WEEK_DAY_LABELS.map((label) => (
            <div key={label} className="month-grid-weekday">{label}</div>
          ))}
        </div>

        <div className="month-grid">
          {monthCells.map((cell) => {
            const isThisMonth = cell.getMonth() === visibleMonth.month;
            const isToday = sameDay(cell, today);
            const isSelected = selectedDate ? sameDay(cell, selectedDate) : false;
            const key = `${cell.getFullYear()}-${cell.getMonth()}-${cell.getDate()}`;
            const dayAssignments = assignmentsByDay.get(key) ?? [];
            const visible = dayAssignments.slice(0, 3);
            const extra = dayAssignments.length - visible.length;
            const hasOverdue = dayAssignments.some((a) => assignmentTone(a, now) === "overdue");

            return (
              <button
                className={[
                  "month-cell",
                  isThisMonth ? "" : "month-cell-outside",
                  isToday ? "month-cell-today" : "",
                  isSelected ? "month-cell-selected" : "",
                  hasOverdue ? "month-cell-has-overdue" : "",
                ].filter(Boolean).join(" ")}
                key={cell.toISOString()}
                onClick={() => setSelectedDate(isSelected ? null : cell)}
                type="button"
              >
                <span className="month-cell-date">{cell.getDate()}</span>
                {visible.length > 0 && (
                  <div className="month-cell-chips">
                    {visible.map((assignment) => (
                      <span
                        className={`month-cell-chip month-cell-chip-${assignmentTone(assignment, now)}`}
                        key={assignment.id}
                        title={`${assignment.title} · ${formatDueShort(assignment.due_at)}`}
                      >
                        {assignment.title}
                      </span>
                    ))}
                    {extra > 0 && <span className="month-cell-chip month-cell-chip-more">+{extra} more</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <div className="calendar-layout">
        <main className="calendar-main">
          <section className="calendar-section">
            <div className="calendar-section-header">
              <div>
                <h2>{selectedDate ? selectedDate.toLocaleString([], { weekday: "long", month: "long", day: "numeric" }) : "Upcoming"}</h2>
                <p>
                  {selectedDate
                    ? `${upcomingList.length} deadline${upcomingList.length === 1 ? "" : "s"} on this day`
                    : `${upcomingList.length} active assignment${upcomingList.length === 1 ? "" : "s"}`}
                </p>
              </div>
              {selectedDate && (
                <button className="button button-ghost" onClick={() => setSelectedDate(null)} type="button">
                  Clear
                </button>
              )}
            </div>

            {assignmentsQuery.isLoading ? <p className="muted">Loading assignments...</p> : null}

            {!assignmentsQuery.isLoading && upcomingList.length === 0 ? (
              <div className="calendar-empty">
                <CalendarDays size={28} strokeWidth={1.6} />
                <h3>{selectedDate ? "Nothing due that day" : "No assignments yet"}</h3>
                <p>
                  {selectedDate
                    ? "Pick another day or clear the filter to see everything."
                    : "Add a deadline or connect Canvas to start planning around your coursework."}
                </p>
              </div>
            ) : (
              <div className="calendar-assignment-list">
                {upcomingList.map((assignment) => {
                  const tone = assignmentTone(assignment, now);
                  return (
                    <article className={`calendar-assignment calendar-assignment-${tone}`} key={assignment.id}>
                      <button
                        className="calendar-complete-btn"
                        onClick={() => completeMutation.mutate({ id: assignment.id, completed: !assignment.completed })}
                        title="Mark complete"
                        type="button"
                      >
                        <CheckCircle2 size={18} strokeWidth={2} />
                      </button>
                      <div className="calendar-assignment-body">
                        <div className="calendar-assignment-title-row">
                          <h4>{assignment.title}</h4>
                          <span className={`source-pill source-pill-${assignment.source === "canvas" ? "canvas" : "sapient"}`}>
                            {sourceLabel(assignment.source)}
                          </span>
                        </div>
                        <div className="calendar-assignment-meta">
                          <strong>{formatDueLong(assignment.due_at)}</strong>
                          {assignment.subject ? (
                            <>
                              <span>·</span>
                              <Link to={`/projects/${encodeURIComponent(assignment.subject)}`}>
                                {formatSubjectName(assignment.subject)}
                              </Link>
                            </>
                          ) : null}
                        </div>
                        {assignment.description ? <p>{assignment.description}</p> : null}
                      </div>
                      <div className="calendar-assignment-actions">
                        {assignment.source_url ? (
                          <a href={assignment.source_url} target="_blank" rel="noreferrer" title="Open source">
                            <ExternalLink size={15} strokeWidth={2} />
                          </a>
                        ) : null}
                        <button onClick={() => handleDeleteAssignment(assignment)} title="Delete assignment" type="button">
                          <Trash2 size={15} strokeWidth={2} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>

        <aside className="calendar-side">
          <section className="calendar-section calendar-reminders">
            <div className="calendar-section-header">
              <div>
                <h2>Smart reminders</h2>
                <p>Based on deadlines, BKT mastery, and learning map status.</p>
              </div>
            </div>
            {remindersQuery.isLoading ? <p className="muted">Checking reminders...</p> : null}
            {!remindersQuery.isLoading && (remindersQuery.data ?? []).length === 0 ? (
              <p className="calendar-side-empty">No reminders right now.</p>
            ) : (
              <div className="calendar-reminder-list">
                {(remindersQuery.data ?? []).map((reminder) => (
                  <article className={`calendar-reminder calendar-reminder-${reminderTone(reminder)}`} key={reminder.id}>
                    <span className="calendar-reminder-severity">{reminder.severity}</span>
                    <h3>{reminder.title}</h3>
                    <p>{reminder.body}</p>
                    {reminder.subject ? (
                      <Link className="calendar-reminder-link" to={`/projects/${encodeURIComponent(reminder.subject)}`}>
                        Open {formatSubjectName(reminder.subject)}
                      </Link>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="calendar-section calendar-feeds">
            <div className="calendar-section-header">
              <div>
                <h2>Canvas feeds</h2>
                <p>Sync imported course calendars.</p>
              </div>
            </div>
            {(feedsQuery.data ?? []).length === 0 ? (
              <p className="calendar-side-empty">No Canvas feeds connected.</p>
            ) : (
              <div className="calendar-feed-list">
                {(feedsQuery.data ?? []).map((feed) => (
                  <article className="calendar-feed" key={feed.id}>
                    <div>
                      <h3>{feed.name}</h3>
                      <p>
                        {feed.subject ? formatSubjectName(feed.subject) : "All subjects"}
                        {feed.last_synced_at ? ` · synced ${new Date(feed.last_synced_at).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <div className="calendar-feed-actions">
                      <button
                        onClick={() => syncFeedMutation.mutate(feed.id)}
                        title="Sync feed"
                        type="button"
                      >
                        <RefreshCw size={14} strokeWidth={2} />
                      </button>
                      <button onClick={() => handleDeleteFeed(feed)} title="Remove feed" type="button">
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
