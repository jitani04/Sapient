import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  createAssignment,
  createCalendarFeed,
  deleteAssignment,
  deleteCalendarFeed,
  listAssignments,
  listCalendarFeeds,
  listProjectProfiles,
  syncCalendarFeed,
  updateAssignment,
  updateCalendarFeed,
} from "../api";
import { useConfirm } from "../ConfirmDialog";
import { formatSubjectName } from "../subjects";
import type { Assignment, AssignmentInput, CalendarFeed } from "../types";
import { buttonClass } from "./buttonClass";
import Loading from "./Loading";
import ErrorMessage from "./ErrorMessage";

const WEEK_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

function formatDueFull(value: string): string {
  return new Date(value).toLocaleString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
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

const COURSE_SUFFIX_RE = /\[([^\]]+)\]\s*$/;
const SECTION_RE = /^\d+[A-Z]+-(.+?)-(\d+)-[A-Z]+-\d+/;

function extractCourseKey(title: string): string | null {
  const m = COURSE_SUFFIX_RE.exec(title);
  if (!m) return null;
  const first = m[1].split("/")[0].trim();
  const m2 = SECTION_RE.exec(first);
  if (!m2) return null;
  return `${m2[1].trim()} ${m2[2].trim()}`;
}

function buildMonthCells(year: number, month: number): Date[] {
  // First Sunday on or before the 1st of the visible month.
  const firstOfMonth = new Date(year, month, 1);
  const dayOfWeek = firstOfMonth.getDay(); // Sun = 0
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
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null);

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
  const confirm = useConfirm();
  const [feedError, setFeedError] = useState<string | null>(null);
  const [mappingFeedId, setMappingFeedId] = useState<number | null>(null);
  const [courseMappingDraft, setCourseMappingDraft] = useState<Record<string, string>>({});

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", "upcoming"],
    queryFn: () => listAssignments(),
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

  const mappingFeed = useMemo(
    () => (feedsQuery.data ?? []).find((f) => f.id === mappingFeedId) ?? null,
    [feedsQuery.data, mappingFeedId],
  );

  const mappingCourses = useMemo(() => {
    if (!mappingFeedId) return [];
    const keys = new Set<string>();
    for (const a of assignmentsQuery.data ?? []) {
      if (a.feed_id !== mappingFeedId) continue;
      const key = extractCourseKey(a.title);
      if (key) keys.add(key);
    }
    return [...keys].sort();
  }, [mappingFeedId, assignmentsQuery.data]);

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
      const now = Date.now();
      const weekAhead = now + 7 * 24 * 60 * 60 * 1000;
      return all
        .filter((a) => {
          const due = new Date(a.due_at).getTime();
          return due >= now && due <= weekAhead;
        })
        .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
    }
    const key = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}`;
    return assignmentsByDay.get(key) ?? [];
  }, [assignmentsQuery.data, assignmentsByDay, selectedDate]);

  const selectedAssignment = useMemo(
    () => (assignmentsQuery.data ?? []).find((assignment) => assignment.id === selectedAssignmentId) ?? null,
    [assignmentsQuery.data, selectedAssignmentId],
  );

  useEffect(() => {
    if (!selectedAssignment) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedAssignmentId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedAssignment]);

  function selectDate(date: Date) {
    setSelectedDate((current) => current && sameDay(current, date) ? null : date);
    setSelectedAssignmentId(null);
  }

  function selectAssignment(assignment: Assignment) {
    const due = new Date(assignment.due_at);
    setSelectedDate(startOfDay(due));
    setVisibleMonth({ year: due.getFullYear(), month: due.getMonth() });
    setSelectedAssignmentId(assignment.id);
  }

  const invalidateCalendar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["assignments"] }),
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

  const updateFeedMutation = useMutation({
    mutationFn: async ({ feedId, mappings }: { feedId: number; mappings: Record<string, string> }) => {
      await updateCalendarFeed(feedId, { course_mappings: mappings });
      return syncCalendarFeed(feedId);
    },
    onSuccess: async () => {
      setMappingFeedId(null);
      await invalidateCalendar();
    },
  });

  function openCourseMapping(feed: CalendarFeed) {
    setCourseMappingDraft(feed.course_mappings ?? {});
    setMappingFeedId(feed.id);
  }

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

  async function handleDeleteAssignment(assignment: Assignment) {
    const ok = await confirm({
      title: "Delete assignment",
      message: `Delete "${assignment.title}"?`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    if (selectedAssignmentId === assignment.id) {
      setSelectedAssignmentId(null);
    }
    deleteAssignmentMutation.mutate(assignment.id);
  }

  async function handleDeleteFeed(feed: CalendarFeed) {
    const ok = await confirm({
      title: "Remove calendar feed",
      message: `Remove "${feed.name}"? Imported assignments will stay on your calendar.`,
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    deleteFeedMutation.mutate(feed.id);
  }

  const now = new Date();

  return (
    <div className="page-shell calendar-page">
      <header className="calendar-hero">
        <div>
          <h1>Calendar</h1>
          <p>Track assignments and Canvas deadlines in one place.</p>
        </div>
        <div className="calendar-hero-actions">
          <button className={buttonClass("secondary")} onClick={() => setShowCanvasForm((open) => !open)} type="button">
            <LinkIcon size={15} strokeWidth={2} />
            Connect Canvas
          </button>
          <button className={buttonClass("primary")} onClick={() => setShowAssignmentForm((open) => !open)} type="button">
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
              {formError ? <ErrorMessage message={formError} /> : null}
              <div className="calendar-form-actions">
                <button className={buttonClass("secondary")} onClick={() => setShowAssignmentForm(false)} type="button">Cancel</button>
                <button className={buttonClass("primary")} disabled={createAssignmentMutation.isPending} type="submit">
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
              {feedError ? <ErrorMessage message={feedError} /> : null}
              <div className="calendar-form-actions">
                <button className={buttonClass("secondary")} onClick={() => setShowCanvasForm(false)} type="button">Cancel</button>
                <button className={buttonClass("primary")} disabled={createFeedMutation.isPending} type="submit">
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
          <button className={buttonClass("ghost", "month-today-btn")} onClick={jumpToToday} type="button">
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
              <div
                className={[
                  "month-cell",
                  isThisMonth ? "" : "month-cell-outside",
                  isToday ? "month-cell-today" : "",
                  isSelected ? "month-cell-selected" : "",
                  hasOverdue ? "month-cell-has-overdue" : "",
                ].filter(Boolean).join(" ")}
                key={cell.toISOString()}
                onClick={() => selectDate(cell)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectDate(cell);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="month-cell-date">{cell.getDate()}</span>
                {visible.length > 0 && (
                  <div className="month-cell-chips">
                    {visible.map((assignment) => (
                      <button
                        className={`month-cell-chip month-cell-chip-button month-cell-chip-${assignmentTone(assignment, now)}`}
                        key={assignment.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectAssignment(assignment);
                        }}
                        title={`${assignment.title} · ${formatDueShort(assignment.due_at)}`}
                        type="button"
                      >
                        {assignment.title}
                      </button>
                    ))}
                    {extra > 0 && <span className="month-cell-chip month-cell-chip-more">+{extra} more</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="calendar-layout">
        <main className="calendar-main">
          <section className="calendar-section">
            <div className="calendar-section-header">
              <div>
                <h2>{selectedDate ? selectedDate.toLocaleString([], { weekday: "long", month: "long", day: "numeric" }) : "This week"}</h2>
                <p>
                  {selectedDate
                    ? `${upcomingList.length} deadline${upcomingList.length === 1 ? "" : "s"} on this day`
                    : `${upcomingList.length} deadline${upcomingList.length === 1 ? "" : "s"} in the next 7 days`}
                </p>
              </div>
              {selectedDate && (
                <button
                  className={buttonClass("ghost")}
                  onClick={() => {
                    setSelectedDate(null);
                    setSelectedAssignmentId(null);
                  }}
                  type="button"
                >
                  Clear
                </button>
              )}
            </div>

            {assignmentsQuery.isLoading ? <Loading title="Loading assignments…" /> : null}

            {!assignmentsQuery.isLoading && upcomingList.length === 0 ? (
              <div className="calendar-empty">
                <CalendarDays size={28} strokeWidth={1.6} />
                <h3>{selectedDate ? "Nothing due that day" : "Nothing due this week"}</h3>
                <p>
                  {selectedDate
                    ? "Pick another day or clear the filter to see everything."
                    : "Pick a date on the calendar to see deadlines further out, or add a new assignment below."}
                </p>
                {!selectedDate ? (
                  <div className="empty-state-actions">
                    <button className={buttonClass("primary")} onClick={() => setShowAssignmentForm(true)} type="button">
                      Add assignment
                    </button>
                    <button className={buttonClass("secondary")} onClick={() => setShowCanvasForm(true)} type="button">
                      Connect Canvas
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="calendar-assignment-list">
                {upcomingList.map((assignment) => {
                  const tone = assignmentTone(assignment, now);
                  return (
                    <article
                      className={`calendar-assignment calendar-assignment-${tone} ${selectedAssignmentId === assignment.id ? "calendar-assignment-selected" : ""}`}
                      key={assignment.id}
                      onClick={() => selectAssignment(assignment)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectAssignment(assignment);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <button
                        className="calendar-complete-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          completeMutation.mutate({ id: assignment.id, completed: !assignment.completed });
                        }}
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
                              <Link to={`/projects/${encodeURIComponent(assignment.subject)}`} onClick={(event) => event.stopPropagation()}>
                                {formatSubjectName(assignment.subject)}
                              </Link>
                            </>
                          ) : null}
                        </div>
                        {assignment.description ? <p>{assignment.description}</p> : null}
                      </div>
                      <div className="calendar-assignment-actions">
                        {assignment.source_url ? (
                          <a href={assignment.source_url} target="_blank" rel="noreferrer" title="Open source" onClick={(event) => event.stopPropagation()}>
                            <ExternalLink size={15} strokeWidth={2} />
                          </a>
                        ) : null}
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteAssignment(assignment);
                          }}
                          title="Delete assignment"
                          type="button"
                        >
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
          <section className="calendar-section calendar-feeds">
            <div className="calendar-section-header">
              <div>
                <h2>Canvas feeds</h2>
                <p>Sync imported course calendars.</p>
              </div>
            </div>
            {(feedsQuery.data ?? []).length === 0 ? (
              <div className="calendar-side-empty">
                <strong>No Canvas feeds connected</strong>
                <span>Paste an iCal/webcal link once, then sync course deadlines from here.</span>
                <button className={buttonClass("secondary")} onClick={() => setShowCanvasForm(true)} type="button">
                  Connect feed
                </button>
              </div>
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
                      <button onClick={() => openCourseMapping(feed)} title="Map courses to subjects" type="button">
                        <BookOpen size={14} strokeWidth={2} />
                      </button>
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

      {selectedAssignment ? (
        <div
          className="modal-backdrop calendar-detail-backdrop"
          onClick={() => setSelectedAssignmentId(null)}
          role="presentation"
        >
          <section
            className="modal-box calendar-detail-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-detail-title"
          >
            <div className="calendar-detail-head">
              <div>
                <span className={`source-pill source-pill-${selectedAssignment.source === "canvas" ? "canvas" : "sapient"}`}>
                  {sourceLabel(selectedAssignment.source)}
                </span>
                <h2 id="calendar-detail-title">{selectedAssignment.title}</h2>
              </div>
              <button
                className="calendar-detail-close"
                onClick={() => setSelectedAssignmentId(null)}
                type="button"
                aria-label="Close assignment details"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>

            <dl className="calendar-detail-list">
              <div>
                <dt>Due</dt>
                <dd>{formatDueFull(selectedAssignment.due_at)}</dd>
              </div>
              {selectedAssignment.subject ? (
                <div>
                  <dt>Subject</dt>
                  <dd>
                    <Link to={`/projects/${encodeURIComponent(selectedAssignment.subject)}`}>
                      {formatSubjectName(selectedAssignment.subject)}
                    </Link>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Status</dt>
                <dd>{selectedAssignment.completed ? "Completed" : "Not completed"}</dd>
              </div>
            </dl>

            {selectedAssignment.description ? (
              <p className="calendar-detail-description">{selectedAssignment.description}</p>
            ) : null}

            <div className="calendar-detail-actions">
              <button
                className={buttonClass("secondary")}
                onClick={() => completeMutation.mutate({ id: selectedAssignment.id, completed: !selectedAssignment.completed })}
                type="button"
              >
                <CheckCircle2 size={15} strokeWidth={2} />
                {selectedAssignment.completed ? "Mark incomplete" : "Mark complete"}
              </button>
              {selectedAssignment.source_url ? (
                <a className={buttonClass("secondary")} href={selectedAssignment.source_url} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} strokeWidth={2} />
                  Open source
                </a>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {mappingFeed ? (
        <div
          className="modal-backdrop calendar-detail-backdrop"
          onClick={() => setMappingFeedId(null)}
          role="presentation"
        >
          <section
            className="modal-box calendar-detail-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-mapping-title"
          >
            <div className="calendar-detail-head">
              <div>
                <h2 id="course-mapping-title">Map courses — {mappingFeed.name}</h2>
                <p>Assign each Canvas course code to a Sapient subject.</p>
              </div>
              <button
                className="calendar-detail-close"
                onClick={() => setMappingFeedId(null)}
                type="button"
                aria-label="Close"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>

            {mappingCourses.length === 0 ? (
              <p className="calendar-detail-description">No assignments found for this feed yet. Try syncing first.</p>
            ) : (
              <div className="course-mapping-list">
                {mappingCourses.map((courseKey) => (
                  <div className="course-mapping-row" key={courseKey}>
                    <span className="course-mapping-key">{courseKey}</span>
                    <select
                      value={courseMappingDraft[courseKey] ?? ""}
                      onChange={(e) => setCourseMappingDraft((draft) => ({ ...draft, [courseKey]: e.target.value }))}
                    >
                      <option value="">No subject</option>
                      {subjectOptions.map((subject) => (
                        <option key={subject} value={subject}>{formatSubjectName(subject)}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div className="calendar-detail-actions">
              <button
                className={buttonClass("secondary")}
                onClick={() => setMappingFeedId(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className={buttonClass("primary")}
                disabled={updateFeedMutation.isPending || mappingCourses.length === 0}
                onClick={() => {
                  const clean: Record<string, string> = {};
                  for (const [k, v] of Object.entries(courseMappingDraft)) {
                    if (v) clean[k] = v;
                  }
                  updateFeedMutation.mutate({ feedId: mappingFeed.id, mappings: clean });
                }}
                type="button"
              >
                {updateFeedMutation.isPending ? "Saving…" : "Save & sync"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
