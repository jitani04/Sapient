import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Circle, Download, ExternalLink, LockKeyhole, MessageCircle, MoreHorizontal, Pencil, Play, Plus, Trash2 } from "lucide-react";

import { RateLimitError, createConversation, createKeyIdea, createManualQuiz, deleteConversation, deleteKeyIdea, deleteProjectSubject, generateMindMap, generateSubjectFlashcards, generateSubjectQuiz, generateSummary, generateWeakQuiz, getCurrentUser, getDueFlashcards, getProjectProfile, getProjectProgress, listAllKeyIdeas, listAssignments, listConversations, listMaterials, updateConversationTitle, updateKeyIdea, updateLearningMapProgress, updateProjectMindMap } from "../api";
import { formatSubjectName, normalizeSubject } from "../subjects";
import type { Conversation, Flashcard, KeyIdea, KnowledgeStateEntry, LearningMapStatus, MindMap, MindMapNode, PracticeQuizItem, ProjectProgress, SessionSummary } from "../types";
import { FlashcardsView } from "./FlashcardsPage";
import { LectureModeOverlay } from "./LectureModeOverlay";
import { MaterialsView } from "./MaterialsPage";
import { WeakQuizModal } from "./WeakQuizModal";

type ProjectTab = "overview" | "notes" | "materials" | "flashcards";

interface LearningPathNode {
  id: string;
  topic: string;
  description: string;
  subtopics: string[];
  prerequisiteIds: string[];
  relatedIds: string[];
  parentId: string | null;
  order: number;
  linkedNoteIds: number[];
  linkedMaterialIds: number[];
  status: LearningMapStatus;
  mastery: number | null;
  attempts: number;
  locked: boolean;
}

interface EditableLearningNode {
  id: string;
  topic: string;
  description: string;
  subtopics: string[];
  prerequisiteIds: string[];
  relatedIds: string[];
  parentId: string | null;
  order: number;
  status: LearningMapStatus;
  linkedNoteIds: number[];
  linkedMaterialIds: number[];
}

type NoteEditorTarget = {
  id: number | "new";
  concept: string;
  summary: string;
};

function ManualQuizDialog({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (input: {
    question: string;
    quiz_type: "multiple_choice" | "short_answer";
    options: string[];
    correct_answer: string;
    explanation: string;
    concept: string;
  }) => void;
}) {
  const [question, setQuestion] = useState("");
  const [quizType, setQuizType] = useState<"multiple_choice" | "short_answer">("multiple_choice");
  const [options, setOptions] = useState<string[]>(["", "", "", ""]);
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [concept, setConcept] = useState("");
  const [error, setError] = useState<string | null>(null);

  function updateOption(index: number, value: string) {
    setOptions((current) => current.map((o, i) => (i === index ? value : o)));
  }

  function submit() {
    if (!question.trim()) { setError("Question is required."); return; }
    if (!correctAnswer.trim()) { setError("Correct answer is required."); return; }
    if (quizType === "multiple_choice") {
      const cleaned = options.map((o) => o.trim()).filter(Boolean);
      if (cleaned.length < 2) { setError("Add at least 2 options."); return; }
      if (!cleaned.includes(correctAnswer.trim())) { setError("Correct answer must match one of the options exactly."); return; }
    }
    onSave({
      question: question.trim(),
      quiz_type: quizType,
      options: options.map((o) => o.trim()).filter(Boolean),
      correct_answer: correctAnswer.trim(),
      explanation: explanation.trim(),
      concept: concept.trim(),
    });
  }

  return (
    <div className="practice-modal-overlay" onClick={onCancel}>
      <div className="practice-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="practice-modal-header">
          <h2>New quiz question</h2>
          <button onClick={onCancel} type="button" aria-label="Close">×</button>
        </div>
        <div className="practice-modal-body">
          <label className="practice-field">
            <span>Question</span>
            <textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
          </label>
          <div className="practice-pills">
            <button
              type="button"
              className={`prefs-pill ${quizType === "multiple_choice" ? "selected" : ""}`}
              onClick={() => setQuizType("multiple_choice")}
            >
              Multiple choice
            </button>
            <button
              type="button"
              className={`prefs-pill ${quizType === "short_answer" ? "selected" : ""}`}
              onClick={() => setQuizType("short_answer")}
            >
              Short answer
            </button>
          </div>
          {quizType === "multiple_choice" && (
            <div className="practice-options">
              {options.map((opt, idx) => (
                <label key={idx} className="practice-option-row">
                  <span>Option {idx + 1}</span>
                  <input type="text" value={opt} onChange={(e) => updateOption(idx, e.target.value)} />
                </label>
              ))}
              <button
                type="button"
                className="practice-add-option"
                onClick={() => setOptions((c) => [...c, ""])}
              >
                + Add option
              </button>
            </div>
          )}
          <label className="practice-field">
            <span>Correct answer{quizType === "multiple_choice" ? " (must match an option exactly)" : ""}</span>
            <input type="text" value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} />
          </label>
          <label className="practice-field">
            <span>Explanation (optional)</span>
            <textarea rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </label>
          <label className="practice-field">
            <span>Concept tag (optional)</span>
            <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)} />
          </label>
          {error && <p className="practice-modal-error">{error}</p>}
        </div>
        <div className="practice-modal-footer">
          <button className="button button-secondary" onClick={onCancel} type="button">Cancel</button>
          <button className="button button-primary" onClick={submit} type="button">Save question</button>
        </div>
      </div>
    </div>
  );
}

function ManualFlashcardDialog({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (input: { concept: string; summary: string }) => void;
}) {
  const [concept, setConcept] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!concept.trim()) { setError("Front (concept) is required."); return; }
    if (!summary.trim()) { setError("Back (answer) is required."); return; }
    onSave({ concept: concept.trim(), summary: summary.trim() });
  }

  return (
    <div className="practice-modal-overlay" onClick={onCancel}>
      <div className="practice-modal practice-modal-small" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="practice-modal-header">
          <h2>New flashcard</h2>
          <button onClick={onCancel} type="button" aria-label="Close">×</button>
        </div>
        <div className="practice-modal-body">
          <label className="practice-field">
            <span>Front (concept or question)</span>
            <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)} maxLength={255} />
          </label>
          <label className="practice-field">
            <span>Back (answer or definition)</span>
            <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </label>
          {error && <p className="practice-modal-error">{error}</p>}
        </div>
        <div className="practice-modal-footer">
          <button className="button button-secondary" onClick={onCancel} type="button">Cancel</button>
          <button className="button button-primary" onClick={submit} type="button">Save flashcard</button>
        </div>
      </div>
    </div>
  );
}

const PROJECT_TABS: ProjectTab[] = ["overview", "notes", "materials", "flashcards"];

function parseProjectTab(value: string | null): ProjectTab {
  if (value && (PROJECT_TABS as string[]).includes(value)) return value as ProjectTab;
  return "overview";
}

const TAB_LABEL: Record<ProjectTab, string> = {
  overview: "Overview",
  notes: "Notes",
  materials: "Materials",
  flashcards: "Flashcards",
};

function SectionToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${label}`}
      className="project-section-toggle"
      onClick={onClick}
      title={open ? "Hide" : "Show"}
      type="button"
    >
      {open ? <ChevronUp size={16} strokeWidth={2} /> : <ChevronDown size={16} strokeWidth={2} />}
    </button>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function lastAssistantMessageTimestamp(conversation: Conversation): string | null {
  const lastAssistantMessage = [...conversation.messages].reverse().find((message) => message.role === "assistant");
  return lastAssistantMessage?.created_at ?? null;
}

function truncateSessionTitle(value: string, maxLength = 92): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3).trimEnd()}...` : value;
}

function getSessionTitle(conversation: Conversation, subject: string): string {
  if (conversation.title?.trim()) return truncateSessionTitle(conversation.title.trim());

  const firstSummaryTopic = conversation.summary?.covered?.find((topic) => topic.trim())?.trim();
  if (firstSummaryTopic) {
    return truncateSessionTitle(firstSummaryTopic);
  }

  return `${subject} study session`;
}

function slugifyTopic(value: string, index: number): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "topic"}-${index}`;
}

function createTopicId(topic = "topic"): string {
  return `${slugifyTopic(topic, Date.now())}-${Math.random().toString(36).slice(2, 7)}`;
}

function learningMapProgressStorageKey(subject: string): string {
  return `its-learning-map-progress:${normalizeSubject(subject)}`;
}

function getStoredLearningProgress(subject: string): Record<string, LearningMapStatus> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(learningMapProgressStorageKey(subject));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, LearningMapStatus>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, LearningMapStatus] => STATUS_OPTIONS.includes(entry[1])),
    );
  } catch {
    return {};
  }
}

function topicMatches(value: string, candidates: string[]): boolean {
  const normalized = normalizeSubject(value);
  if (!normalized) return false;
  return candidates.some((candidate) => {
    const other = normalizeSubject(candidate);
    return normalized.includes(other) || other.includes(normalized);
  });
}

function inferLearningMapStatus(node: MindMapNode, notes: KeyIdea[], flashcards: Flashcard[], progress?: ProjectProgress): LearningMapStatus {
  const candidates = [node.topic, ...node.subtopics];
  if (progress?.weak_areas.some((topic) => topicMatches(topic, candidates)) || progress?.next_review.some((topic) => topicMatches(topic, candidates))) {
    return "needs_review";
  }
  if (progress?.concepts_covered.some((topic) => topicMatches(topic, candidates))) {
    return "mastered";
  }
  if (notes.some((note) => topicMatches(note.concept, candidates) || topicMatches(note.summary, candidates))) {
    return "in_progress";
  }
  if (flashcards.some((card) => topicMatches(card.concept, candidates) || topicMatches(card.summary, candidates))) {
    return "in_progress";
  }
  return "not_started";
}

function statusFromMastery(entry?: KnowledgeStateEntry): LearningMapStatus | null {
  if (!entry || entry.attempts <= 0) return null;
  if (entry.mastery >= 0.85) return "mastered";
  if (entry.mastery <= 0.45) return "needs_review";
  return "in_progress";
}

function masteryForNode(
  id: string,
  node: MindMapNode,
  knowledgeState: Record<string, KnowledgeStateEntry>,
): KnowledgeStateEntry | undefined {
  if (knowledgeState[id]) return knowledgeState[id];
  const candidates = [node.topic, ...node.subtopics];
  return Object.values(knowledgeState).find((entry) => topicMatches(entry.concept, candidates));
}

function buildLearningPathNodes(
  nodes: MindMapNode[],
  storedStatuses: Record<string, LearningMapStatus>,
  knowledgeState: Record<string, KnowledgeStateEntry>,
  notes: KeyIdea[],
  flashcards: Flashcard[],
  progress?: ProjectProgress,
): LearningPathNode[] {
  const normalizedNodes = [...nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const ids = normalizedNodes.map((node, index) => node.id || slugifyTopic(node.topic, index));
  return normalizedNodes.map((node, index) => {
    const id = ids[index];
    const prerequisiteIds = node.prerequisite_ids?.length ? node.prerequisite_ids : (index === 0 ? [] : [ids[index - 1]]);
    const masteryEntry = masteryForNode(id, node, knowledgeState);
    const status = storedStatuses[id] ?? statusFromMastery(masteryEntry) ?? node.status ?? inferLearningMapStatus(node, notes, flashcards, progress);
    const relatedIds = node.related_ids?.length
      ? node.related_ids
      : ids.filter((_, relatedIndex) => relatedIndex !== index && Math.abs(relatedIndex - index) <= 2);
    return {
      id,
      topic: node.topic,
      description: node.description ?? "",
      subtopics: node.subtopics,
      prerequisiteIds,
      relatedIds,
      parentId: node.parent_id ?? null,
      order: node.order ?? index,
      linkedNoteIds: node.linked_note_ids ?? [],
      linkedMaterialIds: node.linked_material_ids ?? [],
      status,
      mastery: masteryEntry?.mastery ?? null,
      attempts: masteryEntry?.attempts ?? 0,
      locked: false,
    };
  }).map((node, _index, allNodes) => ({
    ...node,
    locked: node.prerequisiteIds.some((id) => {
      const prerequisite = allNodes.find((candidate) => candidate.id === id);
      return prerequisite ? !["in_progress", "mastered"].includes(prerequisite.status) : false;
    }),
  }));
}

function editableNodesFromMindMap(nodes: MindMapNode[], progress: Record<string, LearningMapStatus>): EditableLearningNode[] {
  return [...nodes]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((node, index) => {
      const id = node.id || slugifyTopic(node.topic, index);
      return {
        id,
        topic: node.topic,
        description: node.description ?? "",
        subtopics: node.subtopics ?? [],
        prerequisiteIds: node.prerequisite_ids ?? [],
        relatedIds: node.related_ids ?? [],
        parentId: node.parent_id ?? null,
        order: node.order ?? index,
        status: progress[id] ?? node.status ?? "not_started",
        linkedNoteIds: node.linked_note_ids ?? [],
        linkedMaterialIds: node.linked_material_ids ?? [],
      };
    });
}

function mindMapFromEditableNodes(subject: string, nodes: EditableLearningNode[]): MindMap {
  return {
    subject,
    nodes: [...nodes]
      .sort((a, b) => a.order - b.order)
      .map((node, index) => ({
        id: node.id,
        topic: node.topic.trim(),
        description: node.description.trim() || null,
        subtopics: node.subtopics.filter((subtopic) => subtopic.trim()).map((subtopic) => subtopic.trim()),
        status: node.status,
        order: index,
        parent_id: node.parentId,
        prerequisite_ids: node.prerequisiteIds,
        related_ids: node.relatedIds,
        linked_note_ids: node.linkedNoteIds,
        linked_material_ids: node.linkedMaterialIds,
      })),
  };
}

function wouldCreatePrerequisiteCycle(nodes: EditableLearningNode[], nodeId: string, prerequisiteIds: string[]): boolean {
  const prerequisitesById = new Map(nodes.map((node) => [node.id, node.prerequisiteIds]));
  prerequisitesById.set(nodeId, prerequisiteIds);
  const visit = (currentId: string, seen: Set<string>): boolean => {
    for (const prerequisiteId of prerequisitesById.get(currentId) ?? []) {
      if (prerequisiteId === nodeId) return true;
      if (seen.has(prerequisiteId)) continue;
      seen.add(prerequisiteId);
      if (visit(prerequisiteId, seen)) return true;
    }
    return false;
  };
  return visit(nodeId, new Set());
}

function relatedItemsForNode<T extends { concept: string; summary: string }>(node: LearningPathNode, items: T[]): T[] {
  const candidates = [node.topic, ...node.subtopics];
  return items
    .filter((item) => topicMatches(item.concept, candidates) || topicMatches(item.summary, candidates))
    .slice(0, 3);
}

function getRecommendedNode(nodes: LearningPathNode[]): { node: LearningPathNode | null; reason: string } {
  const reviewNode = nodes.find((node) => node.status === "needs_review");
  if (reviewNode) {
    return { node: reviewNode, reason: "This topic is marked for review, so it is the best place to reinforce next." };
  }

  const unlockedNewNode = nodes.find((node) => node.status === "not_started" && !node.locked);
  if (unlockedNewNode) {
    const prerequisite = nodes.find((node) => node.id === unlockedNewNode.prerequisiteIds[0]);
    return {
      node: unlockedNewNode,
      reason: prerequisite
        ? `You have enough grounding from ${prerequisite.topic} to start this next topic.`
        : "This is the first open topic in the learning path.",
    };
  }

  const activeNode = nodes.find((node) => node.status === "in_progress");
  if (activeNode) {
    return { node: activeNode, reason: "You have started this topic but have not marked it mastered yet." };
  }

  return { node: null, reason: nodes.length > 0 ? "You have marked every topic mastered." : "Your learning map is still being built." };
}

function StatusIcon({ status, locked }: { status: LearningMapStatus; locked: boolean }) {
  if (locked) return <LockKeyhole size={13} strokeWidth={2} />;
  if (status === "mastered") return <CheckCircle2 size={13} strokeWidth={2} />;
  if (status === "needs_review") return <AlertTriangle size={13} strokeWidth={2} />;
  if (status === "in_progress") return <Circle size={13} strokeWidth={2.5} />;
  return <Circle size={13} strokeWidth={1.8} />;
}

const LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  some: "Some experience",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const STATUS_LABELS: Record<LearningMapStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_review: "Needs review",
  mastered: "Mastered",
};

const STATUS_OPTIONS: LearningMapStatus[] = ["not_started", "in_progress", "needs_review", "mastered"];

type ProjectSectionKey = "goals" | "cover" | "progress" | "map" | "sessions";
type ProjectSectionVisibility = Record<ProjectSectionKey, boolean>;

const DEFAULT_PROJECT_SECTION_VISIBILITY: ProjectSectionVisibility = {
  goals: true,
  cover: true,
  progress: true,
  map: true,
  sessions: true,
};

function projectSectionStorageKey(subject: string): string {
  return `its-project-sections:${normalizeSubject(subject)}`;
}

function getStoredProjectSectionVisibility(subject: string): ProjectSectionVisibility {
  if (typeof window === "undefined") {
    return DEFAULT_PROJECT_SECTION_VISIBILITY;
  }

  const rawValue = window.localStorage.getItem(projectSectionStorageKey(subject));
  if (!rawValue) {
    return DEFAULT_PROJECT_SECTION_VISIBILITY;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<ProjectSectionVisibility>;
    return {
      goals: parsed.goals ?? DEFAULT_PROJECT_SECTION_VISIBILITY.goals,
      cover: parsed.cover ?? DEFAULT_PROJECT_SECTION_VISIBILITY.cover,
      progress: parsed.progress ?? DEFAULT_PROJECT_SECTION_VISIBILITY.progress,
      map: parsed.map ?? DEFAULT_PROJECT_SECTION_VISIBILITY.map,
      sessions: parsed.sessions ?? DEFAULT_PROJECT_SECTION_VISIBILITY.sessions,
    };
  } catch {
    return DEFAULT_PROJECT_SECTION_VISIBILITY;
  }
}

function buildSummaryText(subject: string, sessionNum: number, date: string, s: SessionSummary): string {
  const lines: string[] = [
    `Study Session ${sessionNum} Summary — ${subject}`,
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
  a.download = `${subject.replace(/\s+/g, "-").toLowerCase()}-study-session-${sessionNum}-summary.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ProjectPage() {
  const { subject } = useParams<{ subject: string }>();
  const decoded = decodeURIComponent(subject ?? "");
  const normalizedSubject = normalizeSubject(decoded);
  const displaySubject = formatSubjectName(decoded);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [weakQuizzes, setWeakQuizzes] = useState<PracticeQuizItem[] | null>(null);
  const [generatingWeakQuiz, setGeneratingWeakQuiz] = useState(false);
  const [weakQuizError, setWeakQuizError] = useState<string | null>(null);
  const [lectureOpen, setLectureOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: ProjectTab = parseProjectTab(searchParams.get("tab"));
  const mindmapWarningParam = searchParams.get("warning") === "mindmap_unavailable";
  const [noteSearch, setNoteSearch] = useState("");
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null);
  const [noteEditor, setNoteEditor] = useState<NoteEditorTarget | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [noteEditError, setNoteEditError] = useState<string | null>(null);
  const [deleteSubjectError, setDeleteSubjectError] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null);
  const [editingTitleDraft, setEditingTitleDraft] = useState("");
  const [autoMindmapAttempted, setAutoMindmapAttempted] = useState(false);
  const [generatingMindmap, setGeneratingMindmap] = useState(false);
  const [mindmapGenerationError, setMindmapGenerationError] = useState<string | null>(null);
  const [practiceBusy, setPracticeBusy] = useState<"quiz" | "flashcards" | null>(null);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [practiceStatus, setPracticeStatus] = useState<string | null>(null);
  const [manualQuizOpen, setManualQuizOpen] = useState(false);
  const [manualFlashcardOpen, setManualFlashcardOpen] = useState(false);
  const [learningProgress, setLearningProgress] = useState<Record<string, LearningMapStatus>>(() => getStoredLearningProgress(decoded));
  const [selectedLearningNodeId, setSelectedLearningNodeId] = useState<string | null>(null);
  const [editingMap, setEditingMap] = useState(false);
  const [mapDraft, setMapDraft] = useState<EditableLearningNode[]>([]);
  const [draftSelectedId, setDraftSelectedId] = useState<string | null>(null);
  const [mapEditError, setMapEditError] = useState<string | null>(null);
  const [savingMap, setSavingMap] = useState(false);
  const mapScrollRef = useRef<HTMLDivElement>(null);

  function setActiveTab(next: ProjectTab) {
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  }
  const [sectionVisibility, setSectionVisibility] = useState<ProjectSectionVisibility>(() => (
    getStoredProjectSectionVisibility(decoded)
  ));

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
  });

  const { data: user } = useQuery({ queryKey: ["me"], queryFn: getCurrentUser });

  const { data: profile } = useQuery({
    queryKey: ["project-profile", decoded],
    queryFn: () => getProjectProfile(decoded),
  });

  const { data: progress } = useQuery({
    queryKey: ["project-progress", decoded],
    queryFn: () => getProjectProgress(decoded),
  });
  const showMindmapWarning = mindmapWarningParam && !profile?.mind_map;

  useEffect(() => {
    setAutoMindmapAttempted(false);
    setMindmapGenerationError(null);
  }, [normalizedSubject]);

  useEffect(() => {
    if (!profile || profile.mind_map || autoMindmapAttempted || generatingMindmap) return;

    let cancelled = false;
    setAutoMindmapAttempted(true);
    setGeneratingMindmap(true);
    setMindmapGenerationError(null);

    void (async () => {
      try {
        await generateMindMap(decoded);
        if (!cancelled) {
          await queryClient.invalidateQueries({ queryKey: ["project-profile", decoded] });
          await queryClient.invalidateQueries({ queryKey: ["project-profiles"] });
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof RateLimitError) {
            setMindmapGenerationError(`AI is rate-limited. Sapient will retry after setup is saved or the subject is reopened.`);
          } else {
            setMindmapGenerationError(err instanceof Error ? err.message : "Learning map generation failed.");
          }
        }
      } finally {
        if (!cancelled) {
          setGeneratingMindmap(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [autoMindmapAttempted, decoded, generatingMindmap, profile, queryClient]);

  const { data: subjectNotes = [], isLoading: notesLoading } = useQuery({
    queryKey: ["key-ideas-subject", decoded],
    queryFn: () => listAllKeyIdeas(decoded),
    enabled: Boolean(decoded),
    staleTime: 30_000,
  });

  const { data: subjectMaterials = [] } = useQuery({
    queryKey: ["materials", decoded],
    queryFn: () => listMaterials(decoded),
    enabled: Boolean(decoded),
    staleTime: 30_000,
  });

  const { data: subjectAssignments = [] } = useQuery({
    queryKey: ["assignments", decoded],
    queryFn: () => listAssignments({ subject: decoded }),
    enabled: Boolean(decoded),
    staleTime: 30_000,
  });

  const { data: dueFlashcards } = useQuery({
    queryKey: ["flashcards-due", decoded],
    queryFn: () => getDueFlashcards(decoded),
    enabled: Boolean(decoded),
    staleTime: 30_000,
  });
  const dueCount = dueFlashcards?.total_due ?? 0;

  const filteredNotes = useMemo(() => {
    const q = noteSearch.trim().toLowerCase();
    if (!q) return subjectNotes;
    return subjectNotes.filter(
      (n) =>
        n.concept.toLowerCase().includes(q) ||
        n.summary.toLowerCase().includes(q) ||
        (n.subject ?? "").toLowerCase().includes(q),
    );
  }, [subjectNotes, noteSearch]);

  async function handleDeleteNote(id: number) {
    if (!window.confirm("Delete this note?")) return;
    setDeletingNoteId(id);
    try {
      await deleteKeyIdea(id);
      await queryClient.invalidateQueries({ queryKey: ["key-ideas-subject", decoded] });
      await queryClient.invalidateQueries({ queryKey: ["key-ideas-all"] });
    } finally {
      setDeletingNoteId(null);
    }
  }

  function startNewNote() {
    setNoteEditError(null);
    setNoteEditor({ id: "new", concept: "", summary: "" });
  }

  function startEditingNote(note: KeyIdea) {
    setNoteEditError(null);
    setNoteEditor({ id: note.id, concept: note.concept, summary: note.summary });
  }

  function updateNoteEditor(patch: Partial<Pick<NoteEditorTarget, "concept" | "summary">>) {
    setNoteEditor((current) => current ? { ...current, ...patch } : current);
  }

  function cancelNoteEditing() {
    if (savingNote) return;
    setNoteEditor(null);
    setNoteEditError(null);
  }

  async function saveNoteEditor() {
    if (!noteEditor || savingNote) return;
    const concept = noteEditor.concept.trim();
    const summary = noteEditor.summary.trim();
    if (!concept || !summary) {
      setNoteEditError("Add a title and note body before saving.");
      return;
    }
    setSavingNote(true);
    setNoteEditError(null);
    try {
      if (noteEditor.id === "new") {
        await createKeyIdea({ concept, summary, subject: decoded });
      } else {
        await updateKeyIdea(noteEditor.id, { concept, summary });
      }
      setNoteEditor(null);
      await queryClient.invalidateQueries({ queryKey: ["key-ideas-subject", decoded] });
      await queryClient.invalidateQueries({ queryKey: ["key-ideas-all"] });
    } catch (err) {
      setNoteEditError(err instanceof Error ? err.message : "Could not save note.");
    } finally {
      setSavingNote(false);
    }
  }

  function renderNoteEditor() {
    if (!noteEditor) return null;
    return (
      <div className="notebook-note notebook-note-editor">
        <input
          autoFocus
          className="notebook-note-title-input"
          maxLength={255}
          onChange={(e) => updateNoteEditor({ concept: e.target.value })}
          placeholder="Key idea"
          type="text"
          value={noteEditor.concept}
        />
        <textarea
          className="notebook-note-body-input"
          onChange={(e) => updateNoteEditor({ summary: e.target.value })}
          placeholder="Write the idea in your own words..."
          rows={4}
          value={noteEditor.summary}
        />
        {noteEditError ? <p className="notebook-note-error">{noteEditError}</p> : null}
        <div className="notebook-editor-actions">
          <button
            className="button button-secondary"
            disabled={savingNote}
            onClick={cancelNoteEditing}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={savingNote}
            onClick={() => void saveNoteEditor()}
            type="button"
          >
            {savingNote ? "Saving..." : "Save note"}
          </button>
        </div>
      </div>
    );
  }

  const sessions = conversations
    .filter((c) => normalizeSubject(c.subject) === normalizedSubject)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const newSessionMutation = useMutation({
    mutationFn: () => createConversation(decoded),
    onSuccess: async (c) => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`/sessions/${c.id}`);
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_data, conversationId) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.removeQueries({ queryKey: ["conversation", conversationId] });
      queryClient.removeQueries({ queryKey: ["conversation-quizzes", conversationId] });
      queryClient.removeQueries({ queryKey: ["key-ideas", conversationId] });
    },
  });

  const updateTitleMutation = useMutation({
    mutationFn: ({ conversationId, title }: { conversationId: number; title: string }) =>
      updateConversationTitle(conversationId, title),
    onSuccess: (updated) => {
      queryClient.setQueryData<Conversation[]>(["conversations"], (current) =>
        current?.map((conversation) => conversation.id === updated.id ? updated : conversation),
      );
      queryClient.setQueryData<Conversation | undefined>(["conversation", updated.id], updated);
      setEditingTitleId(null);
      setEditingTitleDraft("");
    },
  });

  const deleteSubjectMutation = useMutation({
    mutationFn: () => deleteProjectSubject(decoded),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["project-profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["materials", decoded] }),
        queryClient.invalidateQueries({ queryKey: ["key-ideas-subject", decoded] }),
        queryClient.invalidateQueries({ queryKey: ["key-ideas-all"] }),
        queryClient.invalidateQueries({ queryKey: ["flashcards-due", decoded] }),
      ]);
      queryClient.removeQueries({ queryKey: ["project-profile", decoded] });
      queryClient.removeQueries({ queryKey: ["project-progress", decoded] });
      window.localStorage.removeItem(projectSectionStorageKey(decoded));
      navigate("/dashboard", { replace: true });
    },
    onError: (err) => {
      setDeleteSubjectError(err instanceof Error ? err.message : "Failed to delete subject.");
    },
  });

  function handleDeleteSession(conversationId: number) {
    if (deleteSessionMutation.isPending) return;
    if (!window.confirm("Delete this study session? This can't be undone.")) return;
    deleteSessionMutation.mutate(conversationId);
  }

  function openSession(conversationId: number) {
    navigate(`/sessions/${conversationId}`);
  }

  function handleSessionRowKeyDown(event: KeyboardEvent<HTMLDivElement>, conversationId: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSession(conversationId);
    }
  }

  function startEditingSessionTitle(conversation: Conversation, title: string) {
    setEditingTitleId(conversation.id);
    setEditingTitleDraft(title);
  }

  function submitSessionTitle(conversationId: number) {
    const title = editingTitleDraft.trim();
    if (!title || updateTitleMutation.isPending) return;
    updateTitleMutation.mutate({ conversationId, title });
  }

  function handleDeleteSubject() {
    if (deleteSubjectMutation.isPending) return;
    const confirmed = window.confirm(
      `Delete "${displaySubject}"? This will permanently delete its study sessions, notes, flashcards, and uploaded materials.`,
    );
    if (!confirmed) return;
    setDeleteSubjectError(null);
    deleteSubjectMutation.mutate();
  }

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
      if (err instanceof RateLimitError) {
        setGenerateError(`AI is rate-limited. Try again in ~${err.retryAfterSeconds}s.`);
      } else {
        setGenerateError(err instanceof Error ? err.message : "Failed to generate summary.");
      }
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleGenerateWeakQuiz() {
    setGeneratingWeakQuiz(true);
    setWeakQuizError(null);
    try {
      const data = await generateWeakQuiz(decoded);
      setWeakQuizzes(data.quizzes);
    } catch (err) {
      if (err instanceof RateLimitError) {
        setWeakQuizError(`AI is rate-limited. Try again in ~${err.retryAfterSeconds}s.`);
      } else {
        setWeakQuizError(err instanceof Error ? err.message : "Failed to generate quiz. Try again.");
      }
    } finally {
      setGeneratingWeakQuiz(false);
    }
  }

  async function handleGenerateSubjectQuiz() {
    setPracticeBusy("quiz");
    setPracticeError(null);
    setPracticeStatus(null);
    try {
      const data = await generateSubjectQuiz(decoded, { count: 5 });
      setWeakQuizzes(data.quizzes);
      setPracticeStatus(`Generated ${data.quizzes.length} new quiz question${data.quizzes.length === 1 ? "" : "s"}.`);
    } catch (err) {
      if (err instanceof RateLimitError) {
        setPracticeError(`AI is rate-limited. Try again in ~${err.retryAfterSeconds}s.`);
      } else {
        setPracticeError(err instanceof Error ? err.message : "Failed to generate quiz.");
      }
    } finally {
      setPracticeBusy(null);
    }
  }

  async function handleSaveManualQuiz(input: {
    question: string;
    quiz_type: "multiple_choice" | "short_answer";
    options: string[];
    correct_answer: string;
    explanation: string;
    concept: string;
  }) {
    setPracticeError(null);
    setPracticeStatus(null);
    try {
      await createManualQuiz({
        subject: decoded,
        question: input.question,
        concept: input.concept || null,
        quiz_type: input.quiz_type,
        options: input.quiz_type === "multiple_choice" ? input.options : null,
        correct_answer: input.correct_answer,
        explanation: input.explanation,
      });
      setManualQuizOpen(false);
      setPracticeStatus("Quiz question saved.");
    } catch (err) {
      setPracticeError(err instanceof Error ? err.message : "Failed to save quiz.");
    }
  }

  async function handleSaveManualFlashcard(input: { concept: string; summary: string }) {
    setPracticeError(null);
    setPracticeStatus(null);
    try {
      await createKeyIdea({
        concept: input.concept,
        summary: input.summary,
        subject: decoded,
      });
      setManualFlashcardOpen(false);
      setPracticeStatus("Flashcard saved.");
      await queryClient.invalidateQueries({ queryKey: ["all-key-ideas"] });
      await queryClient.invalidateQueries({ queryKey: ["due-flashcards"] });
    } catch (err) {
      setPracticeError(err instanceof Error ? err.message : "Failed to save flashcard.");
    }
  }

  async function handleGenerateFlashcards() {
    setPracticeBusy("flashcards");
    setPracticeError(null);
    setPracticeStatus(null);
    try {
      const data = await generateSubjectFlashcards(decoded, { count: 8 });
      setPracticeStatus(`Generated ${data.created} new flashcard${data.created === 1 ? "" : "s"}.`);
      await queryClient.invalidateQueries({ queryKey: ["all-key-ideas"] });
      await queryClient.invalidateQueries({ queryKey: ["due-flashcards"] });
    } catch (err) {
      if (err instanceof RateLimitError) {
        setPracticeError(`AI is rate-limited. Try again in ~${err.retryAfterSeconds}s.`);
      } else {
        setPracticeError(err instanceof Error ? err.message : "Failed to generate flashcards.");
      }
    } finally {
      setPracticeBusy(null);
    }
  }

  useEffect(() => {
    setSectionVisibility(getStoredProjectSectionVisibility(decoded));
    setLearningProgress(profile?.learning_map_progress ?? getStoredLearningProgress(decoded));
    setSelectedLearningNodeId(null);
    setEditingMap(false);
    setMapDraft([]);
    setDraftSelectedId(null);
    setMapEditError(null);
  }, [decoded, profile?.learning_map_progress]);

  function updateSectionVisibility(nextValue: ProjectSectionVisibility | ((prev: ProjectSectionVisibility) => ProjectSectionVisibility)) {
    setSectionVisibility((prev) => {
      const next = typeof nextValue === "function" ? nextValue(prev) : nextValue;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(projectSectionStorageKey(decoded), JSON.stringify(next));
      }
      return next;
    });
  }

  function toggleSection(section: ProjectSectionKey) {
    updateSectionVisibility((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  const draftMindMapNodes = useMemo<MindMapNode[]>(
    () => mapDraft.map((node) => ({
      id: node.id,
      topic: node.topic,
      description: node.description,
      subtopics: node.subtopics,
      status: node.status,
      order: node.order,
      parent_id: node.parentId,
      prerequisite_ids: node.prerequisiteIds,
      related_ids: node.relatedIds,
      linked_note_ids: node.linkedNoteIds,
      linked_material_ids: node.linkedMaterialIds,
    })),
    [mapDraft],
  );
  const learningPathNodes = useMemo(
    () => buildLearningPathNodes(
      editingMap ? draftMindMapNodes : profile?.mind_map?.nodes ?? [],
      editingMap ? Object.fromEntries(mapDraft.map((node) => [node.id, node.status])) : learningProgress,
      profile?.knowledge_state ?? {},
      subjectNotes,
      dueFlashcards?.cards ?? [],
      progress,
    ),
    [draftMindMapNodes, dueFlashcards?.cards, editingMap, learningProgress, mapDraft, profile?.knowledge_state, profile?.mind_map?.nodes, progress, subjectNotes],
  );
  const selectedLearningNode = learningPathNodes.find((node) => node.id === selectedLearningNodeId) ?? null;
  const selectedDraftNode = mapDraft.find((node) => node.id === draftSelectedId) ?? null;
  const recommendedLearning = useMemo(() => getRecommendedNode(learningPathNodes), [learningPathNodes]);
  const masteredTopicCount = learningPathNodes.filter((node) => node.status === "mastered").length;
  const reviewTopicCount = learningPathNodes.filter((node) => node.status === "needs_review").length;
  const completionPercent = learningPathNodes.length > 0 ? Math.round((masteredTopicCount / learningPathNodes.length) * 100) : 0;
  const masteryNodes = learningPathNodes.filter((node) => node.mastery !== null);
  const averageMasteryPercent = masteryNodes.length > 0
    ? Math.round((masteryNodes.reduce((sum, node) => sum + (node.mastery ?? 0), 0) / masteryNodes.length) * 100)
    : null;
  const relatedNotes = selectedLearningNode ? relatedItemsForNode(selectedLearningNode, subjectNotes) : [];
  const relatedFlashcards = selectedLearningNode ? relatedItemsForNode(selectedLearningNode, dueFlashcards?.cards ?? []) : [];

  function updateLearningNodeStatus(nodeId: string, status: LearningMapStatus) {
    setLearningProgress((prev) => {
      const next = { ...prev, [nodeId]: status };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(learningMapProgressStorageKey(decoded), JSON.stringify(next));
      }
      return next;
    });
    void updateLearningMapProgress(decoded, nodeId, status)
      .then((updatedProfile) => {
        setLearningProgress(updatedProfile.learning_map_progress ?? {});
        void queryClient.invalidateQueries({ queryKey: ["project-profile", decoded] });
        void queryClient.invalidateQueries({ queryKey: ["project-profiles"] });
      })
      .catch((err) => {
        setMindmapGenerationError(err instanceof Error ? err.message : "Could not save learning map progress.");
      });
  }

  function scrollLearningMap(direction: "left" | "right") {
    const el = mapScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === "left" ? -360 : 360, behavior: "smooth" });
  }

  function fitLearningMapToStart() {
    mapScrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }

  function startMapEditing() {
    const progressForDraft = profile?.learning_map_progress ?? learningProgress;
    setMapDraft(editableNodesFromMindMap(profile?.mind_map?.nodes ?? [], progressForDraft));
    setDraftSelectedId(null);
    setSelectedLearningNodeId(null);
    setMapEditError(null);
    setEditingMap(true);
  }

  function cancelMapEditing() {
    setEditingMap(false);
    setMapDraft([]);
    setDraftSelectedId(null);
    setMapEditError(null);
  }

  function updateDraftNode(nodeId: string, patch: Partial<EditableLearningNode>) {
    setMapDraft((prev) => prev.map((node) => node.id === nodeId ? { ...node, ...patch } : node));
  }

  function updateDraftPrerequisites(nodeId: string, prerequisiteIds: string[]) {
    if (wouldCreatePrerequisiteCycle(mapDraft, nodeId, prerequisiteIds)) {
      setMapEditError("This connection would create a circular prerequisite path.");
      return;
    }
    setMapEditError(null);
    updateDraftNode(nodeId, { prerequisiteIds });
  }

  function addDraftTopic() {
    const nextOrder = mapDraft.length;
    const id = createTopicId("new-topic");
    const node: EditableLearningNode = {
      id,
      topic: "New topic",
      description: "",
      subtopics: [],
      prerequisiteIds: nextOrder > 0 ? [mapDraft[mapDraft.length - 1].id] : [],
      relatedIds: [],
      parentId: null,
      order: nextOrder,
      status: "not_started",
      linkedNoteIds: [],
      linkedMaterialIds: [],
    };
    setMapDraft((prev) => [...prev, node]);
    setDraftSelectedId(id);
    setMapEditError(null);
  }

  function moveDraftTopic(nodeId: string, direction: -1 | 1) {
    setMapDraft((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((node) => node.id === nodeId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= sorted.length) return prev;
      const [node] = sorted.splice(index, 1);
      sorted.splice(nextIndex, 0, node);
      return sorted.map((item, order) => ({ ...item, order }));
    });
  }

  function autoOrganizeDraft() {
    setMapDraft((prev) => {
      const byId = new Map(prev.map((node) => [node.id, node]));
      const sorted: EditableLearningNode[] = [];
      const remaining = new Set(prev.map((node) => node.id));
      while (remaining.size > 0) {
        const nextId = [...remaining].find((id) => {
          const node = byId.get(id);
          return !node || node.prerequisiteIds.every((prereqId) => !remaining.has(prereqId));
        }) ?? [...remaining][0];
        const nextNode = byId.get(nextId);
        if (nextNode) sorted.push(nextNode);
        remaining.delete(nextId);
      }
      return sorted.map((node, order) => ({ ...node, order }));
    });
  }

  function deleteDraftTopic(nodeId: string) {
    const node = mapDraft.find((item) => item.id === nodeId);
    if (!node) return;
    const connectedCount = mapDraft.filter((item) => (
      item.parentId === nodeId || item.prerequisiteIds.includes(nodeId) || item.relatedIds.includes(nodeId)
    )).length;
    const linkedCount = node.linkedNoteIds.length + node.linkedMaterialIds.length;
    const confirmed = window.confirm(
      `Delete "${node.topic}"? Deleting this topic may affect ${connectedCount} connected topic${connectedCount === 1 ? "" : "s"} and ${linkedCount} linked item${linkedCount === 1 ? "" : "s"}.`,
    );
    if (!confirmed) return;
    setMapDraft((prev) => prev
      .filter((item) => item.id !== nodeId)
      .map((item, order) => ({
        ...item,
        order,
        parentId: item.parentId === nodeId ? null : item.parentId,
        prerequisiteIds: item.prerequisiteIds.filter((id) => id !== nodeId),
        relatedIds: item.relatedIds.filter((id) => id !== nodeId),
      })));
    setDraftSelectedId(null);
  }

  function duplicateDraftTopic(nodeId: string) {
    const node = mapDraft.find((item) => item.id === nodeId);
    if (!node) return;
    const id = createTopicId(node.topic);
    const copy = {
      ...node,
      id,
      topic: `${node.topic} copy`,
      order: mapDraft.length,
      relatedIds: [],
    };
    setMapDraft((prev) => [...prev, copy]);
    setDraftSelectedId(id);
  }

  async function saveMapChanges() {
    if (mapDraft.some((node) => !node.topic.trim())) {
      setMapEditError("Every topic needs a title.");
      return;
    }
    const hasCycle = mapDraft.some((node) => wouldCreatePrerequisiteCycle(mapDraft, node.id, node.prerequisiteIds));
    if (hasCycle) {
      setMapEditError("This connection would create a circular prerequisite path.");
      return;
    }
    setSavingMap(true);
    setMapEditError(null);
    try {
      const sortedDraft = [...mapDraft].sort((a, b) => a.order - b.order).map((node, order) => ({ ...node, order }));
      const progressPayload = Object.fromEntries(sortedDraft.map((node) => [node.id, node.status]));
      const updated = await updateProjectMindMap(decoded, mindMapFromEditableNodes(displaySubject || decoded, sortedDraft), progressPayload);
      setLearningProgress(updated.learning_map_progress ?? progressPayload);
      setEditingMap(false);
      setMapDraft([]);
      setDraftSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ["project-profile", decoded] });
      await queryClient.invalidateQueries({ queryKey: ["project-profiles"] });
    } catch (err) {
      setMapEditError(err instanceof Error ? err.message : "Could not save learning map.");
    } finally {
      setSavingMap(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="project-hero-card">
        {profile?.cover_image_url ? (
          <img
            src={profile.cover_image_url}
            alt={`${displaySubject} cover`}
            className="project-hero-image"
          />
        ) : (
          <div className="project-hero-image project-hero-image-empty" />
        )}
        <div className="project-hero-overlay" />
        <div className="project-hero-content">
          <div className="project-hero-text">
            <h1 className="project-hero-title">{displaySubject}</h1>
          </div>
          <div className="project-hero-actions">
            <button
              className="button button-secondary project-hero-secondary"
              onClick={() => setLectureOpen(true)}
              type="button"
            >
              <Play size={14} strokeWidth={2} fill="currentColor" />
              Lecture mode
            </button>
            <button
              className="button button-primary project-hero-primary"
              disabled={newSessionMutation.isPending}
              onClick={() => newSessionMutation.mutate()}
              type="button"
            >
              {newSessionMutation.isPending ? "Creating..." : "New study session"}
            </button>
            <details className="project-action-menu">
              <summary aria-label="Subject actions" title="Subject actions">
                <MoreHorizontal size={18} strokeWidth={2} />
              </summary>
              <div className="project-action-menu-panel">
                <Link to={`/projects/${encodeURIComponent(decoded)}/setup`} className="project-action-menu-item">
                  <Pencil size={14} strokeWidth={2} />
                  Edit subject / cover
                </Link>
                <button
                  className="project-action-menu-item project-action-menu-danger"
                  disabled={deleteSubjectMutation.isPending}
                  onClick={handleDeleteSubject}
                  type="button"
                >
                  <Trash2 size={14} strokeWidth={2} />
                  {deleteSubjectMutation.isPending ? "Deleting..." : "Delete subject"}
                </button>
              </div>
            </details>
          </div>
        </div>
      </div>

      {deleteSubjectError ? <p className="error-text">{deleteSubjectError}</p> : null}

      {showMindmapWarning && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "0.75rem",
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            background: "var(--surface-2, #fff8e1)",
            border: "1px solid var(--warning-border, #f0c674)",
            borderRadius: "8px",
            fontSize: "0.85rem",
          }}
        >
          <div>
            <strong>Mind map not yet generated.</strong>{" "}
            Sapient is building it automatically. If generation is rate-limited, saving subject setup or reopening this subject will retry it.
            {mindmapGenerationError && (
              <div style={{ marginTop: "0.25rem", color: "var(--error, #e55)" }}>{mindmapGenerationError}</div>
            )}
          </div>
        </div>
      )}

      {lectureOpen && (
        <LectureModeOverlay
          subject={decoded}
          tutorName={user?.tutor_name ?? "Sapient"}
          tutorInitials={(user?.tutor_name ?? "S").slice(0, 2).toUpperCase()}
          onClose={() => setLectureOpen(false)}
        />
      )}

      <div className="settings-tabs project-tabs" role="tablist">
        {PROJECT_TABS.map((tab) => {
          const badge =
            tab === "notes" && subjectNotes.length > 0
              ? ` (${subjectNotes.length})`
              : tab === "materials" && subjectMaterials.length > 0
              ? ` (${subjectMaterials.length})`
              : tab === "flashcards" && dueCount > 0
              ? ` (${dueCount})`
              : "";
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`settings-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABEL[tab]}{badge}
            </button>
          );
        })}
      </div>

      {activeTab === "materials" && <MaterialsView subject={decoded} />}
      {activeTab === "flashcards" && <FlashcardsView subject={decoded} />}

      {activeTab === "notes" && (
        <section className="notes-notebook">
          <div className="notes-notebook-header">
            <div>
              <h2>Notes</h2>
              <p>Capture the most important ideas from your study sessions here.</p>
            </div>
            <button className="button button-primary notes-add-button" onClick={startNewNote} type="button">
              <Plus size={15} strokeWidth={2} />
              Add note
            </button>
          </div>

          <div className="notes-notebook-search">
            <div className="notes-search-wrap">
              <svg fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15" className="notes-search-icon">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                className="notes-search"
                onChange={(e) => setNoteSearch(e.target.value)}
                placeholder="Search notes"
                type="search"
                value={noteSearch}
              />
            </div>
          </div>

          {notesLoading && <p className="notebook-loading">Loading notes...</p>}

          {!notesLoading && (
            <div className="notebook-list">
              {noteEditor?.id === "new" ? renderNoteEditor() : null}

              {filteredNotes.length === 0 && noteEditor?.id !== "new" ? (
                <div className="notebook-empty">
                  <h3>{subjectNotes.length === 0 ? "No notes yet" : "No matching notes"}</h3>
                  <p>
                    {subjectNotes.length === 0
                      ? `Add a note for ${displaySubject}, or save key ideas during a tutoring session.`
                      : "Try a different search term."}
                  </p>
                </div>
              ) : null}

              {filteredNotes.map((note) => (
                noteEditor?.id === note.id ? (
                  <div key={note.id}>{renderNoteEditor()}</div>
                ) : (
                  <article
                    className="notebook-note"
                    key={note.id}
                    onClick={() => startEditingNote(note)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        startEditingNote(note);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="notebook-note-content">
                      <h3>{note.concept}</h3>
                      <p>{note.summary}</p>
                    </div>
                    <div className="notebook-note-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="notebook-note-action" onClick={() => startEditingNote(note)} type="button">
                        Edit
                      </button>
                      <button
                        className="notebook-note-action notebook-note-action-danger"
                        disabled={deletingNoteId === note.id}
                        onClick={() => void handleDeleteNote(note.id)}
                        type="button"
                      >
                        {deletingNoteId === note.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </article>
                )
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "overview" && (
        <>
      {subjectAssignments.length > 0 && (
        <section className="project-upcoming-strip">
          <div className="project-upcoming-head">
            <div>
              <span>Upcoming</span>
              <strong>{subjectAssignments.length} deadline{subjectAssignments.length === 1 ? "" : "s"}</strong>
            </div>
            <Link to="/calendar" className="text-link">Open calendar</Link>
          </div>
          <div className="project-upcoming-list">
            {subjectAssignments.slice(0, 3).map((assignment) => (
              <article className="project-upcoming-item" key={assignment.id}>
                <CalendarDays size={16} strokeWidth={2} />
                <div>
                  <strong>{assignment.title}</strong>
                  <span>{formatTimestamp(assignment.due_at)}</span>
                </div>
                {assignment.source_url ? (
                  <a href={assignment.source_url} target="_blank" rel="noreferrer" aria-label="Open assignment source">
                    <ExternalLink size={15} strokeWidth={2} />
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Mind map */}
      <section className="project-section-shell project-map-section">
        <div className="project-section-header project-map-header">
          <div>
            <div className="content-card-title project-section-title project-map-title">Learning Map</div>
            <div className="project-map-summary">
              {completionPercent}% complete · {masteredTopicCount} mastered · {reviewTopicCount} need review
              {averageMasteryPercent !== null ? ` · ${averageMasteryPercent}% BKT mastery` : ""}
              {recommendedLearning.node ? ` · Next: ${recommendedLearning.node.topic}` : learningPathNodes.length > 0 ? " · You're caught up" : ""}
            </div>
          </div>
          <div className="project-map-header-actions">
            <button className="project-map-nav-btn" onClick={() => scrollLearningMap("left")} type="button" aria-label="Scroll learning map left">
              <ArrowLeft size={15} strokeWidth={2} />
            </button>
            <button className="project-map-nav-btn" onClick={() => scrollLearningMap("right")} type="button" aria-label="Scroll learning map right">
              <ArrowRight size={15} strokeWidth={2} />
            </button>
            <button className="button button-secondary project-map-collapse" onClick={fitLearningMapToStart} type="button">
              Fit to screen
            </button>
            {editingMap ? (
              <>
                <button className="button button-secondary project-map-collapse" onClick={addDraftTopic} type="button">Add topic</button>
                <button className="button button-secondary project-map-collapse" onClick={autoOrganizeDraft} type="button">Auto-organize</button>
                <button className="button button-secondary project-map-collapse" onClick={cancelMapEditing} disabled={savingMap} type="button">Cancel</button>
                <button className="button button-primary project-map-collapse" onClick={() => void saveMapChanges()} disabled={savingMap} type="button">
                  {savingMap ? "Saving..." : "Save changes"}
                </button>
              </>
            ) : (
              <>
                <button className="button button-secondary project-map-collapse" onClick={startMapEditing} type="button">Edit map</button>
                <button
                  className="button button-secondary project-map-collapse"
                  onClick={() => toggleSection("map")}
                  type="button"
                >
                  {sectionVisibility.map ? "Collapse all" : "Expand all"}
                </button>
              </>
            )}
          </div>
        </div>
        {sectionVisibility.map && (
          <div className={`content-card project-map-card${editingMap ? " project-map-card-editing" : ""}`}>
            {profile?.mind_map ? (
              <>
                {editingMap && (
                  <div className="project-map-edit-banner">
                    <strong>Edit map mode</strong>
                    <span>Change the learning structure. The visual layout updates automatically after you save.</span>
                  </div>
                )}
                {mapEditError && <p className="error-text project-map-edit-error">{mapEditError}</p>}
                <div className="project-map-recommendation">
                  <div>
                    <span>Recommended next</span>
                    <strong>{recommendedLearning.node?.topic ?? "You're caught up"}</strong>
                  </div>
                  <p>{recommendedLearning.reason}</p>
                </div>
                <div className={`project-map-body${(editingMap ? selectedDraftNode : selectedLearningNode) ? " has-detail" : ""}`}>
                  <div className="mindmap" ref={mapScrollRef}>
                    <div className="mindmap-flow">
                      <button
                        className="mindmap-root"
                        onClick={() => setSelectedLearningNodeId(null)}
                        type="button"
                      >
                        {formatSubjectName(profile.mind_map.subject)}
                      </button>
                      {learningPathNodes.map((node, index) => (
                        <button
                          key={node.id}
                          className={`mindmap-node mindmap-node-status-${node.status}${node.locked ? " mindmap-node-locked" : ""}${(editingMap ? draftSelectedId : selectedLearningNode?.id) === node.id ? " mindmap-node-selected" : ""}${editingMap ? " mindmap-node-editing" : ""}`}
                          onClick={() => {
                            if (editingMap) {
                              setDraftSelectedId(node.id);
                              setSelectedLearningNodeId(null);
                            } else {
                              setSelectedLearningNodeId(node.id);
                            }
                          }}
                          style={{ "--node-index": index } as CSSProperties}
                          type="button"
                        >
                          <div className="mindmap-node-title-row">
                            <span className="mindmap-node-title">{node.topic}</span>
                            <span className="mindmap-status-chip">
                              <StatusIcon status={node.status} locked={node.locked} />
                              {node.locked ? "Prereq" : STATUS_LABELS[node.status]}
                            </span>
                          </div>
                          {node.mastery !== null && (
                            <div className="mindmap-mastery-meter" aria-label={`BKT mastery ${Math.round(node.mastery * 100)}%`}>
                              <span style={{ width: `${Math.round(node.mastery * 100)}%` }} />
                            </div>
                          )}
                          <div className="mindmap-subtopics" aria-hidden="true">
                            {node.subtopics.slice(0, 3).map((sub, subIndex) => (
                              <span
                                key={sub}
                                className="mindmap-subtopic"
                                style={{ "--subtopic-index": subIndex } as CSSProperties}
                              >
                                {sub}
                              </span>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {editingMap && selectedDraftNode && (
                    <aside className="learning-node-detail learning-node-edit-panel visible">
                      <div className="learning-node-detail-head">
                        <div>
                          <span className="learning-node-eyebrow">Edit topic</span>
                          <h3>{selectedDraftNode.topic || "Untitled topic"}</h3>
                        </div>
                        <button type="button" onClick={() => setDraftSelectedId(null)} aria-label="Close topic editor">
                          ×
                        </button>
                      </div>

                      <label className="learning-node-form-field">
                        Topic title
                        <input
                          value={selectedDraftNode.topic}
                          onChange={(e) => updateDraftNode(selectedDraftNode.id, { topic: e.target.value })}
                        />
                      </label>

                      <label className="learning-node-form-field">
                        Short description
                        <textarea
                          rows={3}
                          value={selectedDraftNode.description}
                          onChange={(e) => updateDraftNode(selectedDraftNode.id, { description: e.target.value })}
                          placeholder="What should the student understand here?"
                        />
                      </label>

                      <label className="learning-node-form-field">
                        Status
                        <select
                          value={selectedDraftNode.status}
                          onChange={(e) => updateDraftNode(selectedDraftNode.id, { status: e.target.value as LearningMapStatus })}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                          ))}
                        </select>
                      </label>

                      <div className="learning-node-form-row">
                        <label className="learning-node-form-field">
                          Topic order
                          <input
                            min={1}
                            type="number"
                            value={selectedDraftNode.order + 1}
                            onChange={(e) => {
                              const nextOrder = Math.max(0, Math.min(mapDraft.length - 1, Number(e.target.value) - 1));
                              setMapDraft((prev) => {
                                const without = prev.filter((node) => node.id !== selectedDraftNode.id).sort((a, b) => a.order - b.order);
                                without.splice(nextOrder, 0, selectedDraftNode);
                                return without.map((node, order) => ({ ...node, order }));
                              });
                            }}
                          />
                        </label>
                        <div className="learning-node-move-actions">
                          <button type="button" onClick={() => moveDraftTopic(selectedDraftNode.id, -1)}>Move left</button>
                          <button type="button" onClick={() => moveDraftTopic(selectedDraftNode.id, 1)}>Move right</button>
                        </div>
                      </div>

                      <label className="learning-node-form-field">
                        Parent topic or group
                        <select
                          value={selectedDraftNode.parentId ?? ""}
                          onChange={(e) => updateDraftNode(selectedDraftNode.id, { parentId: e.target.value || null })}
                        >
                          <option value="">No parent</option>
                          {mapDraft.filter((node) => node.id !== selectedDraftNode.id).map((node) => (
                            <option key={node.id} value={node.id}>{node.topic}</option>
                          ))}
                        </select>
                      </label>

                      <label className="learning-node-form-field">
                        Prerequisites
                        <select
                          multiple
                          value={selectedDraftNode.prerequisiteIds}
                          onChange={(e) => updateDraftPrerequisites(
                            selectedDraftNode.id,
                            Array.from(e.currentTarget.selectedOptions, (option) => option.value),
                          )}
                        >
                          {mapDraft.filter((node) => node.id !== selectedDraftNode.id).map((node) => (
                            <option key={node.id} value={node.id}>{node.topic}</option>
                          ))}
                        </select>
                      </label>

                      <label className="learning-node-form-field">
                        Related topics
                        <select
                          multiple
                          value={selectedDraftNode.relatedIds}
                          onChange={(e) => updateDraftNode(selectedDraftNode.id, {
                            relatedIds: Array.from(e.currentTarget.selectedOptions, (option) => option.value),
                          })}
                        >
                          {mapDraft.filter((node) => node.id !== selectedDraftNode.id).map((node) => (
                            <option key={node.id} value={node.id}>{node.topic}</option>
                          ))}
                        </select>
                      </label>

                      <label className="learning-node-form-field">
                        Subtopics
                        <textarea
                          rows={3}
                          value={selectedDraftNode.subtopics.join("\n")}
                          onChange={(e) => updateDraftNode(selectedDraftNode.id, {
                            subtopics: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean),
                          })}
                          placeholder="One subtopic per line"
                        />
                      </label>

                      <label className="learning-node-form-field">
                        Linked notes
                        <select
                          multiple
                          value={selectedDraftNode.linkedNoteIds.map(String)}
                          onChange={(e) => updateDraftNode(selectedDraftNode.id, {
                            linkedNoteIds: Array.from(e.currentTarget.selectedOptions, (option) => Number(option.value)),
                          })}
                        >
                          {subjectNotes.map((note) => (
                            <option key={note.id} value={note.id}>{note.concept}</option>
                          ))}
                        </select>
                      </label>

                      <label className="learning-node-form-field">
                        Linked materials
                        <select
                          multiple
                          value={selectedDraftNode.linkedMaterialIds.map(String)}
                          onChange={(e) => updateDraftNode(selectedDraftNode.id, {
                            linkedMaterialIds: Array.from(e.currentTarget.selectedOptions, (option) => Number(option.value)),
                          })}
                        >
                          {subjectMaterials.map((material) => (
                            <option key={material.id} value={material.id}>{material.filename}</option>
                          ))}
                        </select>
                      </label>

                      <div className="learning-node-edit-actions">
                        <button className="button button-secondary" type="button" onClick={() => duplicateDraftTopic(selectedDraftNode.id)}>Duplicate</button>
                        <button className="button button-secondary danger" type="button" onClick={() => deleteDraftTopic(selectedDraftNode.id)}>Delete topic</button>
                        <button className="button button-primary" type="button" onClick={() => setDraftSelectedId(null)}>Save topic</button>
                      </div>
                    </aside>
                  )}

                  {!editingMap && selectedLearningNode && (
                    <aside className="learning-node-detail visible">
                      <>
                        <div className="learning-node-detail-head">
                          <div>
                            <span className="learning-node-eyebrow">Topic detail</span>
                            <h3>{selectedLearningNode.topic}</h3>
                          </div>
                          <button type="button" onClick={() => setSelectedLearningNodeId(null)} aria-label="Close topic detail">
                            ×
                          </button>
                        </div>
                        <p className="learning-node-summary">
                          {selectedLearningNode.description
                            ? selectedLearningNode.description
                            : selectedLearningNode.subtopics.length > 0
                            ? `This topic connects ${selectedLearningNode.subtopics.slice(0, 3).join(", ")}${selectedLearningNode.subtopics.length > 3 ? ", and related skills" : ""}.`
                            : "Use this topic as a checkpoint in your learning path."}
                        </p>
                        {selectedLearningNode.mastery !== null && (
                          <div className="learning-node-mastery-card">
                            <span>BKT mastery</span>
                            <strong>{Math.round(selectedLearningNode.mastery * 100)}%</strong>
                            <small>{selectedLearningNode.attempts} quiz observation{selectedLearningNode.attempts === 1 ? "" : "s"}</small>
                          </div>
                        )}
                        {selectedLearningNode.locked && (
                          <div className="learning-node-prereq-warning">
                            Start with{" "}
                            {selectedLearningNode.prerequisiteIds
                              .map((id) => learningPathNodes.find((node) => node.id === id)?.topic)
                              .filter(Boolean)
                              .join(", ")}{" "}
                            first.
                          </div>
                        )}

                        <label className="learning-node-status-select">
                          Status
                          <select
                            value={selectedLearningNode.status}
                            onChange={(e) => updateLearningNodeStatus(selectedLearningNode.id, e.target.value as LearningMapStatus)}
                          >
                            {STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                            ))}
                          </select>
                        </label>

                        <div className="learning-node-detail-section">
                          <span>Prerequisites</span>
                          {selectedLearningNode.prerequisiteIds.length === 0 ? (
                            <p>No prerequisites. This is a good starting point.</p>
                          ) : (
                            <p>
                              {selectedLearningNode.prerequisiteIds
                                .map((id) => learningPathNodes.find((node) => node.id === id)?.topic)
                                .filter(Boolean)
                                .join(", ")}
                            </p>
                          )}
                        </div>

                        <div className="learning-node-detail-section">
                          <span>Related notes</span>
                          {relatedNotes.length > 0 ? (
                            <ul>
                              {relatedNotes.map((note) => <li key={note.id}>{note.concept}</li>)}
                            </ul>
                          ) : (
                            <p>No saved notes for this topic yet.</p>
                          )}
                        </div>

                        <div className="learning-node-detail-section">
                          <span>Related flashcards</span>
                          {relatedFlashcards.length > 0 ? (
                            <ul>
                              {relatedFlashcards.map((card) => <li key={card.id}>{card.concept}</li>)}
                            </ul>
                          ) : (
                            <p>No due flashcards match this topic.</p>
                          )}
                        </div>

                        <div className="learning-node-detail-section">
                          <span>Related topics</span>
                          <div className="learning-related-topics">
                            {selectedLearningNode.relatedIds.map((id) => {
                              const related = learningPathNodes.find((node) => node.id === id);
                              if (!related) return null;
                              return (
                                <button key={id} type="button" onClick={() => setSelectedLearningNodeId(id)}>
                                  {related.topic}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <button
                          className="button button-primary learning-mini-lesson-btn"
                          disabled={newSessionMutation.isPending}
                          onClick={() => newSessionMutation.mutate()}
                          type="button"
                        >
                          {newSessionMutation.isPending ? "Starting..." : "Start mini lesson"}
                        </button>
                      </>
                    </aside>
                  )}
                </div>
              </>
            ) : (
              <p className="muted" style={{ fontSize: "0.875rem" }}>
                {generatingMindmap
                  ? "Building your learning map..."
                  : mindmapGenerationError
                  ? `Learning map generation is pending: ${mindmapGenerationError}`
                  : "Your learning map will appear here automatically."}
              </p>
            )}
          </div>
        )}
      </section>

      {profile?.goals && (
        <section className="project-section-shell">
          <div className="project-section-header">
            <div className="content-card-title project-section-title">Goals</div>
            <SectionToggle
              open={sectionVisibility.goals}
              onClick={() => toggleSection("goals")}
              label="goals"
            />
          </div>
          {sectionVisibility.goals && (
            <div className="project-goals">
              <span className="project-goals-label">Goals</span>
              <span className="project-goals-text">{profile.goals}</span>
            </div>
          )}
        </section>
      )}

      {/* Progress section */}
      {progress && (progress.quizzes_attempted > 0 || progress.concepts_covered.length > 0 || progress.knowledge_mastery.length > 0) && (
        <section className="project-section-shell">
          <div className="project-section-header">
            <div className="progress-section-title project-section-title">Progress</div>
            <SectionToggle
              open={sectionVisibility.progress}
              onClick={() => toggleSection("progress")}
              label="progress"
            />
          </div>
          {sectionVisibility.progress && (
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

              {/* BKT mastery */}
              {progress.knowledge_mastery.length > 0 && (
                <div className="progress-stat-card progress-stat-card-wide">
                  <div className="progress-stat-label">BKT concept mastery</div>
                  <div className="progress-mastery-list">
                    {progress.knowledge_mastery.slice(0, 6).map((entry) => (
                      <div key={entry.concept_id} className="progress-mastery-row">
                        <span>{entry.concept}</span>
                        <div className="progress-mastery-meter" aria-label={`${Math.round(entry.mastery * 100)}% mastery`}>
                          <span style={{ width: `${Math.round(entry.mastery * 100)}%` }} />
                        </div>
                        <strong>{Math.round(entry.mastery * 100)}%</strong>
                      </div>
                    ))}
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
                  <div className="weak-quiz-action">
                    <button
                      className="button button-primary"
                      disabled={generatingWeakQuiz}
                      onClick={() => void handleGenerateWeakQuiz()}
                      type="button"
                    >
                      {generatingWeakQuiz ? "Generating…" : "Practice weak areas"}
                    </button>
                    {weakQuizError && (
                      <p className="weak-quiz-error">{weakQuizError}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Next review */}
              {progress.next_review.length > 0 && (
                <div className="progress-stat-card progress-stat-card-wide">
                  <div className="progress-stat-label">Review next study session</div>
                  <div className="progress-topic-list">
                    {progress.next_review.map((t) => (
                      <span key={t} className="progress-topic-chip progress-topic-chip-review">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Practice: generate or add quizzes / flashcards */}
      <section className="project-section-shell project-practice-section">
        <div className="project-section-header">
          <div className="content-card-title project-section-title">Practice</div>
        </div>
        <div className="project-practice-grid">
          <div className="project-practice-card">
            <h3>Quizzes</h3>
            <p>Generate a new quiz across {displaySubject} or write your own questions.</p>
            <div className="project-practice-actions">
              <button
                className="button button-primary"
                disabled={practiceBusy === "quiz"}
                onClick={() => void handleGenerateSubjectQuiz()}
                type="button"
              >
                {practiceBusy === "quiz" ? "Generating…" : "Generate quiz"}
              </button>
              <button
                className="button button-secondary"
                onClick={() => setManualQuizOpen(true)}
                type="button"
              >
                Add question
              </button>
            </div>
          </div>
          <div className="project-practice-card">
            <h3>Flashcards</h3>
            <p>Auto-build flashcards on this subject or save one yourself.</p>
            <div className="project-practice-actions">
              <button
                className="button button-primary"
                disabled={practiceBusy === "flashcards"}
                onClick={() => void handleGenerateFlashcards()}
                type="button"
              >
                {practiceBusy === "flashcards" ? "Generating…" : "Generate flashcards"}
              </button>
              <button
                className="button button-secondary"
                onClick={() => setManualFlashcardOpen(true)}
                type="button"
              >
                Add flashcard
              </button>
            </div>
          </div>
        </div>
        {practiceError && <p className="project-practice-error">{practiceError}</p>}
        {practiceStatus && <p className="project-practice-status">{practiceStatus}</p>}
        {manualQuizOpen && (
          <ManualQuizDialog
            onCancel={() => setManualQuizOpen(false)}
            onSave={(input) => void handleSaveManualQuiz(input)}
          />
        )}
        {manualFlashcardOpen && (
          <ManualFlashcardDialog
            onCancel={() => setManualFlashcardOpen(false)}
            onSave={(input) => void handleSaveManualFlashcard(input)}
          />
        )}
      </section>

      {/* Study sessions list */}
      <section className="project-section-shell">
        <div className="project-section-header">
          <div className="content-card-title project-section-title">Study Sessions</div>
          <SectionToggle
            open={sectionVisibility.sessions}
            onClick={() => toggleSection("sessions")}
            label="study sessions"
          />
        </div>
        {sectionVisibility.sessions && (
          <>
            {generateError && (
              <p style={{ fontSize: "0.8rem", color: "var(--error, #e55)", marginBottom: "0.5rem" }}>{generateError}</p>
            )}
            {sessions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><MessageCircle size={26} strokeWidth={1.6} /></div>
                <h3>No study sessions yet</h3>
                <p>Start your first study session for this subject.</p>
                <button className="button button-primary" onClick={() => newSessionMutation.mutate()} type="button">
                  Start study session
                </button>
              </div>
            ) : (
              <div className="content-card" style={{ padding: 0, overflow: "hidden" }}>
                {sessions.map((c, i) => {
                  const sessionNum = sessions.length - i;
                  const isExpanded = expandedIds.has(c.id);
                  const hasSummary = !!c.summary;
                  const lastAssistantAt = lastAssistantMessageTimestamp(c);
                  const sessionTitle = getSessionTitle(c, displaySubject);
                  return (
                    <div key={c.id} className="project-session-wrap">
                      <div
                        className="project-session-row project-session-row-clickable"
                        onClick={() => openSession(c.id)}
                        onKeyDown={(event) => handleSessionRowKeyDown(event, c.id)}
                        role="link"
                        style={{ borderTop: i === 0 ? "none" : undefined }}
                        tabIndex={0}
                      >
                        <div className="project-session-info">
                          {editingTitleId === c.id ? (
                            <form
                              className="project-session-title-edit"
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                              onSubmit={(event) => {
                                event.preventDefault();
                                submitSessionTitle(c.id);
                              }}
                            >
                              <input
                                autoFocus
                                className="project-session-title-input"
                                maxLength={120}
                                onChange={(event) => setEditingTitleDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") {
                                    setEditingTitleId(null);
                                    setEditingTitleDraft("");
                                  }
                                }}
                                value={editingTitleDraft}
                              />
                              <button
                                className="button button-secondary"
                                disabled={!editingTitleDraft.trim() || updateTitleMutation.isPending}
                                type="submit"
                                style={{ fontSize: "0.74rem", padding: "0.35rem 0.65rem" }}
                              >
                                Save
                              </button>
                              <button
                                className="button button-secondary"
                                onClick={() => {
                                  setEditingTitleId(null);
                                  setEditingTitleDraft("");
                                }}
                                type="button"
                                style={{ fontSize: "0.74rem", padding: "0.35rem 0.65rem" }}
                              >
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <div className="project-session-title-row">
                              <Link className="project-session-num" to={`/sessions/${c.id}`}>
                                {sessionTitle}
                              </Link>
                              <button
                                aria-label={`Edit ${sessionTitle}`}
                                className="project-session-title-edit-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  startEditingSessionTitle(c, sessionTitle);
                                }}
                                title="Edit session label"
                                type="button"
                              >
                                <Pencil size={13} strokeWidth={2} />
                              </button>
                            </div>
                          )}
                          <div className="project-session-meta">
                            {lastAssistantAt ? formatTimestamp(lastAssistantAt) : "No tutor reply yet"}
                            {hasSummary && <span className="session-summary-badge">Summary</span>}
                          </div>
                        </div>
                        <div className="project-session-actions" onClick={(event) => event.stopPropagation()}>
                          {hasSummary ? (
                            <>
                              <button
                                className={`button button-secondary session-summary-toggle ${isExpanded ? "active" : ""}`}
                                onClick={() => toggleExpanded(c.id)}
                                type="button"
                                style={{ fontSize: "0.78rem", padding: "0.4rem 0.8rem" }}
                              >
                                {isExpanded ? (
                                  <>Hide summary <ChevronUp size={13} strokeWidth={2} style={{ verticalAlign: "-2px" }} /></>
                                ) : (
                                  <>View summary <ChevronDown size={13} strokeWidth={2} style={{ verticalAlign: "-2px" }} /></>
                                )}
                              </button>
                              <button
                                className="button button-secondary session-download-btn"
                                onClick={() => downloadSummary(decoded, sessionNum, c)}
                                title="Download summary as text file"
                                aria-label="Download summary"
                                type="button"
                                style={{ fontSize: "0.8rem", padding: "0.4rem 0.55rem" }}
                              >
                                <Download size={14} strokeWidth={2} />
                              </button>
                            </>
                          ) : (
                            <button
                              className="button button-secondary"
                              disabled={generatingId === c.id || c.messages.length < 2}
                              onClick={() => void handleGenerateSummary(c.id)}
                              title={c.messages.length < 2 ? "Study session is too short to summarize" : undefined}
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
                          <button
                            aria-label={`Delete ${sessionTitle}`}
                            className="project-session-delete"
                            disabled={deleteSessionMutation.isPending}
                            onClick={() => handleDeleteSession(c.id)}
                            title="Delete study session"
                            type="button"
                          >
                            <Trash2 size={15} strokeWidth={1.8} />
                          </button>
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
          </>
        )}
      </section>
        </>
      )}
      {weakQuizzes && (
        <WeakQuizModal quizzes={weakQuizzes} onClose={() => setWeakQuizzes(null)} />
      )}
    </div>
  );
}
