import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowUp, Bookmark, BookmarkCheck, FileText, FolderOpen, Pause, Play, Plus, RotateCcw } from "lucide-react";

import { RateLimitError, createConversation, createKeyIdea, deleteConversation, getConversation, getConversationQuizzes, getCurrentUser, getKeyIdeas, listConversationResources, listMaterials, listModels, streamChat, submitFeedback, updateConversationModel, uploadMaterial } from "../api";
import { getPendingStudyContext } from "../studyState";
import type { AttemptResult, ChatStreamEvent, Conversation, DiagramData, FeedbackRating, ImageData, KeyIdea, KeyIdeaArtifactData, Material, Message, MessageTrace, QuizData, Resource, ResourceData, RetrievedSource, WebSource } from "../types";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { DiagramCard } from "./DiagramCard";
import { ImageArtifactCard } from "./ImageArtifactCard";
import { ResourceCard } from "./ResourceCard";
import { LectureModeOverlay } from "./LectureModeOverlay";
import { MarkdownText } from "./MarkdownText";
import { QuizCard } from "./QuizCard";
import { useSpeech } from "../useSpeech";
import { useMicrophone } from "../useMicrophone";
import { useSessionTimer, formatTimer } from "../useSessionTimer";
import { useStreamSmoothing } from "../useStreamSmoothing";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button className={`msg-copy-btn${copied ? " copied" : ""}`} onClick={handleCopy} title="Copy" type="button">
      {copied ? (
        <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="14">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
          <rect height="13" rx="2" width="13" x="9" y="9"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
    </button>
  );
}

interface FeedbackDraft {
  rating: FeedbackRating;
  feedbackText: string;
  correction: string;
  saved: boolean;
  saving: boolean;
  error: string | null;
}

interface FeedbackButtonsProps {
  message: Message;
  draft: FeedbackDraft | undefined;
  onRate: (message: Message, rating: FeedbackRating) => void;
}

function FeedbackButtons({ message, draft, onRate }: FeedbackButtonsProps) {
  const rating = draft?.rating ?? null;
  return (
    <>
      <button
        className={`feedback-rate-btn${rating === "thumbs_up" ? " active" : ""}`}
        disabled={draft?.saving}
        onClick={() => onRate(message, "thumbs_up")}
        type="button"
        aria-label="Thumbs up"
        title="Thumbs up"
      >
        <svg
          fill={rating === "thumbs_up" ? "currentColor" : "none"}
          height="14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="14"
        >
          <path d="M7 10v12" />
          <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l4.42-7.78A1.5 1.5 0 0 1 14 3a1 1 0 0 1 1 1z" />
        </svg>
      </button>
      <button
        className={`feedback-rate-btn${rating === "thumbs_down" ? " active" : ""}`}
        disabled={draft?.saving}
        onClick={() => onRate(message, "thumbs_down")}
        type="button"
        aria-label="Thumbs down"
        title="Thumbs down"
      >
        <svg
          fill={rating === "thumbs_down" ? "currentColor" : "none"}
          height="14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="14"
        >
          <path d="M17 14V2" />
          <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-4.42 7.78A1.5 1.5 0 0 1 10 21a1 1 0 0 1-1-1z" />
        </svg>
      </button>
    </>
  );
}

interface FeedbackModalProps {
  message: Message;
  draft: FeedbackDraft;
  onChange: (messageId: number, patch: Partial<FeedbackDraft>) => void;
  onSaveDetails: (message: Message) => void;
  onClose: () => void;
}

function FeedbackModal({ message, draft, onChange, onSaveDetails, onClose }: FeedbackModalProps) {
  const isDown = draft.rating === "thumbs_down";
  const title = isDown ? "Tell us what went wrong" : "Tell us what worked";
  const prompt = isDown ? "What should be improved?" : "What was helpful?";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-box feedback-modal-box" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2 className="feedback-modal-title">{title}</h2>
          <button
            aria-label="Close feedback dialog"
            className="modal-close-btn"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <p className="settings-copy" style={{ margin: 0 }}>
          Your {draft.rating === "thumbs_up" ? "thumbs up" : "thumbs down"} is already saved.
          A short note helps the tutor learn what to do differently next time.
        </p>
        <label className="feedback-field">
          <span>{prompt}</span>
          <textarea
            autoFocus
            disabled={draft.saving}
            maxLength={1000}
            onChange={(event) => onChange(message.id, { feedbackText: event.target.value })}
            placeholder="Optional short note"
            rows={3}
            value={draft.feedbackText}
          />
        </label>
        {isDown ? (
          <label className="feedback-field">
            <span>What would a better answer include?</span>
            <textarea
              disabled={draft.saving}
              maxLength={1000}
              onChange={(event) => onChange(message.id, { correction: event.target.value })}
              placeholder="Optional correction or missing point"
              rows={3}
              value={draft.correction}
            />
          </label>
        ) : null}
        <div className="feedback-detail-actions">
          {draft.error ? <span className="feedback-error">{draft.error}</span> : null}
          <button
            className="feedback-save-btn"
            disabled={draft.saving}
            onClick={() => onSaveDetails(message)}
            type="button"
          >
            {draft.saving ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const SESSION_CONTROLS = [
  { label: "Hint", prompt: "I'm stuck. Give me one targeted hint without revealing the answer." },
  { label: "Explain differently", prompt: "Explain this differently using a simple analogy." },
  { label: "Quiz me", prompt: "Quiz me on this topic instead of giving the answer directly." },
  { label: "Move on", prompt: "I understand this. Give me the next question or a harder follow-up." },
];

const QUICK_PROMPTS = [
  "Quiz me on this topic instead of giving the answer immediately.",
  "Explain step by step, then check my understanding.",
  "Give me a hint and wait for my attempt.",
];

const POMODORO_KEY = "sapient-pomodoro";
const POMODORO_DURATION_KEY = "sapient-pomodoro-duration";
const DEFAULT_POMODORO_MINUTES = 25;

function readPomodoroDurationSeconds(): number {
  if (typeof window === "undefined") return DEFAULT_POMODORO_MINUTES * 60;
  const raw = window.localStorage.getItem(POMODORO_DURATION_KEY);
  const parsed = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_POMODORO_MINUTES * 60;
  return Math.min(180, Math.max(1, Math.floor(parsed))) * 60;
}

const ATTACHMENT_READY_TIMEOUT_MS = 25_000;
const ATTACHMENT_POLL_INTERVAL_MS = 1_500;
const SUPPORTED_ATTACHMENT_SUFFIXES = [".pdf", ".pptx", ".docx", ".txt", ".md"];
const SUPPORTED_ATTACHMENT_ACCEPT = ".pdf,.pptx,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/x-markdown";

type AttachmentStatus = "queued" | "uploading" | "processing" | "ready" | "failed";

interface ComposerAttachment {
  id: string;
  file: File;
  status: AttachmentStatus;
  error: string | null;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function initialsForName(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "SA";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function isSupportedAttachment(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_ATTACHMENT_SUFFIXES.some((suffix) => lowerName.endsWith(suffix));
}

function createAttachment(file: File): ComposerAttachment {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    file,
    status: "queued",
    error: null,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildMessageWithAttachments(message: string, materials: Material[]): string {
  if (materials.length === 0) return message;

  const files = materials.map((material) => `- ${material.filename}`).join("\n");
  if (message) {
    return `${message}\n\nAttached files:\n${files}`;
  }

  return `I attached these files for this subject:\n${files}\n\nPlease use them to help me study.`;
}

export function ChatPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeConversationIdRef = useRef<number | null>(null);
  const conversationLifecycleRef = useRef<Record<number, { messageCount: number; isStreaming: boolean }>>({});

  const { speakingId, loadingId, error: speechError, speak } = useSpeech();
  const { recording: micRecording, loading: micLoading, error: micError, toggle: toggleMic } = useMicrophone((text) => {
    setDraft((prev) => prev ? `${prev} ${text}` : text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  });

  const conversationId = params.conversationId ? Number(params.conversationId) : null;

  // Require a subject for new study sessions. If the user landed on /sessions/new
  // without going through the /start flow, push them through subject selection.
  useEffect(() => {
    if (conversationId !== null) return;
    const ctx = getPendingStudyContext();
    if (!ctx?.subject?.trim()) {
      navigate("/start/topic", { replace: true });
    }
  }, [conversationId, navigate]);

  const [pomodoroEnabled] = useState(() => localStorage.getItem(POMODORO_KEY) === "true");
  const [pomodoroDurationSeconds] = useState(() => readPomodoroDurationSeconds());
  const timer = useSessionTimer(conversationId, pomodoroDurationSeconds);
  const [breakDismissed, setBreakDismissed] = useState(false);
  const showPomodoroPrompt = pomodoroEnabled && timer.expired && !breakDismissed;
  const [draft, setDraft] = useState("");
  const streamSmoothing = useStreamSmoothing();
  const streamedText = streamSmoothing.text;
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sources, setSources] = useState<RetrievedSource[]>([]);
  const [webSources, setWebSources] = useState<WebSource[]>([]);
  const [showSources, setShowSources] = useState(false);
  const sourceCount = sources.length + webSources.length;
  const [sseQuizzes, setSseQuizzes] = useState<QuizData[]>([]);
  const [sseKeyIdeas, setSseKeyIdeas] = useState<KeyIdea[]>([]);
  const [sseDiagrams, setSseDiagrams] = useState<DiagramData[]>([]);
  const [sseImages, setSseImages] = useState<ImageData[]>([]);
  const [sseResources, setSseResources] = useState<ResourceData[]>([]);
  // Artifacts streamed during the current assistant turn, awaiting an `end`
  // event so we can tag them with the assistant_message_id and render inline.
  const [savedSnippetKeys, setSavedSnippetKeys] = useState<Set<string>>(new Set());
  const [pendingDiagrams, setPendingDiagrams] = useState<DiagramData[]>([]);
  const [pendingImages, setPendingImages] = useState<ImageData[]>([]);
  const [pendingResources, setPendingResources] = useState<ResourceData[]>([]);
  const [pendingQuizzes, setPendingQuizzes] = useState<QuizData[]>([]);
  const [messageDiagrams, setMessageDiagrams] = useState<Record<number, DiagramData[]>>({});
  const [messageImages, setMessageImages] = useState<Record<number, ImageData[]>>({});
  const [messageResources, setMessageResources] = useState<Record<number, ResourceData[]>>({});
  const [messageQuizzes, setMessageQuizzes] = useState<Record<number, QuizData[]>>({});
  const [showNotes, setShowNotes] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pendingContext] = useState(() => getPendingStudyContext());
  const [lectureOpen, setLectureOpen] = useState(false);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<number, FeedbackDraft>>({});
  const [feedbackModalFor, setFeedbackModalFor] = useState<number | null>(null);
  const messageTracesRef = useRef<Record<number, MessageTrace>>({});

  const userQuery = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
  });

  const conversationQuery = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => getConversation(conversationId!),
    enabled: conversationId !== null,
  });

  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: listModels,
    staleTime: Infinity,
  });

  const modelMutation = useMutation({
    mutationFn: (model: string) => updateConversationModel(conversationId!, model),
    onSuccess: (updated) => {
      queryClient.setQueryData(["conversation", conversationId], updated);
    },
  });

  const quizzesQuery = useQuery({
    queryKey: ["conversation-quizzes", conversationId],
    queryFn: () => getConversationQuizzes(conversationId!),
    enabled: conversationId !== null,
  });

  const keyIdeasQuery = useQuery({
    queryKey: ["key-ideas", conversationId],
    queryFn: () => getKeyIdeas(conversationId!),
    enabled: conversationId !== null,
  });

  const conversationResourcesQuery = useQuery({
    queryKey: ["conversation-resources", conversationId],
    queryFn: () => listConversationResources(conversationId!),
    enabled: conversationId !== null,
  });
  const historicalKeyIdeasIds = new Set((keyIdeasQuery.data ?? []).map((k) => k.id));
  const allKeyIdeas: KeyIdea[] = [
    ...(keyIdeasQuery.data ?? []),
    ...sseKeyIdeas.filter((k) => !historicalKeyIdeasIds.has(k.id)),
  ];
  const historicalQuizzes: QuizData[] = (quizzesQuery.data ?? []).map((q) => ({
    quiz_id: q.id,
    question: q.question,
    concept: q.concept,
    quiz_type: q.quiz_type as QuizData["quiz_type"],
    options: q.options,
    message_id: q.message_id,
  }));

  const createMutation = useMutation({
    mutationFn: (subject?: string) => createConversation(subject),
    onSuccess: async (c) => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`/sessions/${c.id}`, { replace: true });
    },
  });

  const conversation = conversationQuery.data ?? null;
  const context = useMemo(
    () => conversation
      ? (conversation.subject ? { subject: conversation.subject, createdAt: conversation.created_at } : null)
      : pendingContext,
    [conversation, pendingContext],
  );
  const messages = conversation?.messages ?? [];

  const subjectMaterialsQuery = useQuery({
    queryKey: ["materials", context?.subject ?? null],
    queryFn: () => listMaterials(context?.subject),
    enabled: Boolean(context?.subject),
    staleTime: 30_000,
    refetchInterval: (q) =>
      q.state.data?.some((m) => m.status === "processing") ? 3000 : false,
  });
  const subjectMaterials = subjectMaterialsQuery.data ?? [];

  useEffect(() => {
    if (conversationId === null || !conversationQuery.isFetched || !conversation) return;

    conversationLifecycleRef.current[conversationId] = {
      messageCount: messages.length,
      isStreaming,
    };
  }, [conversationId, conversationQuery.isFetched, conversation, messages.length, isStreaming]);

  useEffect(() => {
    activeConversationIdRef.current = conversationId;
    const cleanupConversationId = conversationId;

    return () => {
      if (activeConversationIdRef.current === cleanupConversationId) {
        activeConversationIdRef.current = null;
      }
      if (cleanupConversationId === null) return;

      window.setTimeout(() => {
        if (activeConversationIdRef.current === cleanupConversationId) return;

        const lifecycle = conversationLifecycleRef.current[cleanupConversationId];
        if (!lifecycle || lifecycle.messageCount > 0 || lifecycle.isStreaming) return;

        delete conversationLifecycleRef.current[cleanupConversationId];
        void deleteConversation(cleanupConversationId)
          .then(() => {
            queryClient.removeQueries({ queryKey: ["conversation", cleanupConversationId] });
            queryClient.removeQueries({ queryKey: ["conversation-quizzes", cleanupConversationId] });
            queryClient.removeQueries({ queryKey: ["key-ideas", cleanupConversationId] });
            void queryClient.invalidateQueries({ queryKey: ["conversations"] });
          })
          .catch(() => {
            // Empty chat cleanup is best-effort; listing queries already hide these rows.
          });
      }, 0);
    };
  }, [conversationId, queryClient]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamedText]);

  useEffect(() => {
    setSources([]);
    setWebSources([]);
    setShowSources(false);
    setSseQuizzes([]);
    setSseKeyIdeas([]);
    setSseDiagrams([]);
    setSseImages([]);
    setSseResources([]);
    setPendingDiagrams([]);
    setPendingImages([]);
    setPendingResources([]);
    setPendingQuizzes([]);
    setMessageDiagrams({});
    setMessageImages({});
    setMessageResources({});
    setMessageQuizzes({});
    setShowNotes(false);
  }, [conversationId]);

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function updateAttachment(id: string, patch: Partial<Pick<ComposerAttachment, "status" | "error">>) {
    setAttachments((current) =>
      current.map((attachment) => attachment.id === id ? { ...attachment, ...patch } : attachment),
    );
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    const supported = files.filter(isSupportedAttachment);
    const unsupportedCount = files.length - supported.length;
    setAttachmentError(
      unsupportedCount > 0
        ? "Only PDF, PPTX, DOCX, TXT, and MD attachments are supported."
        : null,
    );

    if (supported.length > 0) {
      setAttachments((current) => [...current, ...supported.map(createAttachment)]);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function waitForAttachmentProcessing(uploaded: { attachment: ComposerAttachment; material: Material }[], subject?: string) {
    const processingIds = new Set(uploaded.filter(({ material }) => material.status === "processing").map(({ material }) => material.id));
    if (processingIds.size === 0) return;

    const deadline = Date.now() + ATTACHMENT_READY_TIMEOUT_MS;
    while (processingIds.size > 0 && Date.now() < deadline) {
      await wait(ATTACHMENT_POLL_INTERVAL_MS);
      const latestMaterials = await listMaterials(subject);

      for (const { attachment, material } of uploaded) {
        if (!processingIds.has(material.id)) continue;

        const latest = latestMaterials.find((candidate) => candidate.id === material.id);
        if (!latest) continue;

        if (latest.status === "ready") {
          processingIds.delete(material.id);
          updateAttachment(attachment.id, { status: "ready", error: null });
        }

        if (latest.status === "failed") {
          processingIds.delete(material.id);
          updateAttachment(attachment.id, {
            status: "failed",
            error: latest.error_message ?? "Processing failed.",
          });
          throw new Error(`${latest.filename} failed to process.`);
        }
      }
    }
  }

  async function uploadAttachmentsForProject(snapshot: ComposerAttachment[], subject?: string): Promise<Material[]> {
    if (snapshot.length === 0) return [];

    const uploaded = await Promise.all(
      snapshot.map(async (attachment) => {
        updateAttachment(attachment.id, { status: "uploading", error: null });
        try {
          const material = await uploadMaterial(attachment.file, subject);
          updateAttachment(attachment.id, {
            status: material.status === "ready" ? "ready" : "processing",
            error: material.error_message,
          });
          return { attachment, material };
        } catch (error) {
          updateAttachment(attachment.id, {
            status: "failed",
            error: error instanceof Error ? error.message : "Upload failed.",
          });
          throw error;
        }
      }),
    );

    await queryClient.invalidateQueries({ queryKey: ["materials"] });
    await waitForAttachmentProcessing(uploaded, subject);
    await queryClient.invalidateQueries({ queryKey: ["materials"] });
    return uploaded.map(({ material }) => material);
  }

  async function send(message: string, attachmentSnapshot: ComposerAttachment[] = []) {
    if ((!message.trim() && attachmentSnapshot.length === 0) || isStreaming) return;

    if (pomodoroEnabled) timer.start();
    setStreamError(null);
    setAttachmentError(null);
    streamSmoothing.reset();
    setSources([]);
    setWebSources([]);
    setShowSources(false);
    setIsStreaming(true);

    let target = conversation;
    let didStartStream = false;

    try {
      if (!target) {
        target = await createMutation.mutateAsync(context?.subject);
      }

      const targetSubject = target.subject ?? context?.subject ?? undefined;
      const uploadedMaterials = await uploadAttachmentsForProject(attachmentSnapshot, targetSubject);
      const outboundMessage = buildMessageWithAttachments(message.trim(), uploadedMaterials);

      const optimistic: Message = {
        id: -1, conversation_id: target.id,
        role: "user", content: outboundMessage,
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData<Conversation | undefined>(
        ["conversation", target.id],
        (cur) => cur ? { ...cur, messages: [...cur.messages, optimistic] } : cur,
      );

      didStartStream = true;
      await streamChat(target.id, { message: outboundMessage }, handleEvent);
      await queryClient.invalidateQueries({ queryKey: ["conversation", target.id] });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["conversation-quizzes", target.id] });
      await queryClient.invalidateQueries({ queryKey: ["key-ideas", target.id] });
      setAttachments([]);
    } catch (err) {
      if (!didStartStream) {
        setDraft(message);
      } else {
        setAttachments([]);
      }
      if (err instanceof RateLimitError) {
        setStreamError(`AI is rate-limited. Try again in ~${err.retryAfterSeconds}s.`);
      } else {
        setStreamError(err instanceof Error ? err.message : "Streaming failed.");
      }
      if (target) {
        await queryClient.invalidateQueries({ queryKey: ["conversation", target.id] });
      }
    } finally {
      setIsStreaming(false);
      streamSmoothing.reset();
    }
  }

  async function submitDraft() {
    const message = draft.trim();
    const attachmentSnapshot = attachments;
    if (!message && attachmentSnapshot.length === 0) return;

    setDraft("");
    await send(message, attachmentSnapshot);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await submitDraft();
  }

  function handleQuizAnswered(result: AttemptResult, answer: string) {
    if (context?.subject) {
      void queryClient.invalidateQueries({ queryKey: ["project-profile", context.subject] });
      void queryClient.invalidateQueries({ queryKey: ["project-progress", context.subject] });
      void queryClient.invalidateQueries({ queryKey: ["project-profiles"] });
    }
    const msg = result.is_correct
      ? `I answered "${answer}" — that was correct!`
      : `I answered "${answer}" but got it wrong. The correct answer was "${result.correct_answer}". Can you explain why?`;
    void send(msg);
  }

  function handleQuizSkipped(result: AttemptResult) {
    if (context?.subject) {
      void queryClient.invalidateQueries({ queryKey: ["project-profile", context.subject] });
      void queryClient.invalidateQueries({ queryKey: ["project-progress", context.subject] });
      void queryClient.invalidateQueries({ queryKey: ["project-profiles"] });
    }
    void send(`I skipped that quiz question. The correct answer was "${result.correct_answer}". Can you explain it before we move on?`);
  }

  async function saveSnippetToNotes(args: {
    key: string;
    concept: string;
    summary: string;
    artifactType: "text" | "diagram" | "image";
    artifactData: KeyIdeaArtifactData;
  }) {
    if (savedSnippetKeys.has(args.key)) return;
    try {
      const idea = await createKeyIdea({
        concept: args.concept,
        summary: args.summary,
        subject: context?.subject ?? null,
        artifact_type: args.artifactType,
        artifact_data: args.artifactData,
      });
      setSavedSnippetKeys((prev) => {
        const next = new Set(prev);
        next.add(args.key);
        return next;
      });
      // Make the new note appear in the side panel immediately.
      setSseKeyIdeas((existing) => [...existing, idea]);
      setShowNotes(true);
      if (conversationId !== null) {
        void queryClient.invalidateQueries({ queryKey: ["key-ideas", conversationId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["all-key-ideas"] });
    } catch (err) {
      console.error("Save to notes failed", err);
    }
  }

  function handleSaveMessageSnippet(msg: Message) {
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    const rawSelected = selection ? selection.toString().trim() : "";
    const text = rawSelected.length > 0 ? rawSelected : msg.content.trim();
    if (!text) return;
    const concept = text.length > 80 ? `${text.slice(0, 77)}…` : text;
    void saveSnippetToNotes({
      key: `msg-${msg.id}-${text.slice(0, 32)}`,
      concept,
      summary: text,
      artifactType: "text",
      artifactData: { kind: "text", text, source_message_id: msg.id },
    });
  }

  function handleSaveDiagram(diagram: DiagramData) {
    const title = diagram.title?.trim() || "Saved diagram";
    void saveSnippetToNotes({
      key: `diagram-${diagram.id}`,
      concept: title,
      summary: title,
      artifactType: "diagram",
      artifactData: { kind: "diagram", source: diagram.source, title: diagram.title ?? null },
    });
  }

  function handleSaveImage(image: ImageData) {
    const caption = (image.caption || image.query || "Saved image").trim();
    const concept = caption.length > 80 ? `${caption.slice(0, 77)}…` : caption;
    void saveSnippetToNotes({
      key: `image-${image.id}`,
      concept,
      summary: caption,
      artifactType: "image",
      artifactData: {
        kind: "image",
        image_url: image.image_url,
        thumbnail_url: image.thumbnail_url ?? null,
        caption: image.caption ?? null,
      },
    });
  }

  function handleEvent(event: ChatStreamEvent) {
    if (event.event === "token") { streamSmoothing.push(event.data.delta); return; }
    if (event.event === "sources") { setSources(event.data.sources); return; }
    if (event.event === "web_sources") { setWebSources(event.data.sources); return; }
    if (event.event === "conversation_title") {
      const activeId = conversationId;
      if (activeId !== null) {
        queryClient.setQueryData<Conversation | undefined>(["conversation", activeId], (cur) =>
          cur ? { ...cur, title: event.data.title } : cur,
        );
        void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      }
      return;
    }
    if (event.event === "quiz") {
      setSseQuizzes((q) => [...q, event.data]);
      setPendingQuizzes((q) => [...q, event.data]);
      return;
    }
    if (event.event === "diagram") {
      setSseDiagrams((d) => [...d, event.data]);
      setPendingDiagrams((d) => [...d, event.data]);
      return;
    }
    if (event.event === "image") {
      setSseImages((images) => [...images, event.data]);
      setPendingImages((images) => [...images, event.data]);
      return;
    }
    if (event.event === "resource") {
      setSseResources((r) => [...r, event.data]);
      setPendingResources((r) => [...r, event.data]);
      return;
    }
    if (event.event === "key_idea") {
      setSseKeyIdeas((ks) => [...ks, {
        id: event.data.id,
        concept: event.data.concept,
        summary: event.data.summary,
        subject: null,
        sr_repetitions: 0,
        sr_due_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }]);
      setShowNotes(true);
      return;
    }
    if (event.event === "end") {
      const assistantMessageId = event.data.assistant_message_id;
      messageTracesRef.current[assistantMessageId] = {
        latency_ms: event.data.latency_ms ?? null,
        retrieved_chunk_ids: event.data.retrieved_chunk_ids ?? null,
        tool_trace: event.data.tool_trace ?? null,
      };
      setPendingDiagrams((pending) => {
        if (pending.length > 0) {
          setMessageDiagrams((existing) => ({
            ...existing,
            [assistantMessageId]: [...(existing[assistantMessageId] ?? []), ...pending],
          }));
        }
        return [];
      });
      setPendingImages((pending) => {
        if (pending.length > 0) {
          setMessageImages((existing) => ({
            ...existing,
            [assistantMessageId]: [...(existing[assistantMessageId] ?? []), ...pending],
          }));
        }
        return [];
      });
      setPendingResources((pending) => {
        if (pending.length > 0) {
          setMessageResources((existing) => ({
            ...existing,
            [assistantMessageId]: [...(existing[assistantMessageId] ?? []), ...pending],
          }));
        }
        return [];
      });
      setPendingQuizzes((pending) => {
        if (pending.length > 0) {
          setMessageQuizzes((existing) => ({
            ...existing,
            [assistantMessageId]: [
              ...(existing[assistantMessageId] ?? []),
              ...pending.map((q) => ({ ...q, message_id: assistantMessageId })),
            ],
          }));
        }
        return [];
      });
      streamSmoothing.finish();
      if (conversationId !== null) {
        void queryClient.invalidateQueries({ queryKey: ["conversation-resources", conversationId] });
      }
      const subj = conversationQuery.data?.subject;
      if (subj) {
        void queryClient.invalidateQueries({ queryKey: ["subject-resources", subj] });
      }
      return;
    }
    if (event.event === "error") {
      streamSmoothing.flush();
      if (event.data.rate_limited && event.data.retry_after_seconds) {
        setStreamError(`AI is rate-limited. Try again in ~${event.data.retry_after_seconds}s.`);
      } else {
        setStreamError(event.data.error);
      }
    }
  }

  function updateFeedbackDraft(messageId: number, patch: Partial<FeedbackDraft>) {
    setFeedbackDrafts((current) => {
      const existing = current[messageId];
      if (!existing) return current;
      const textChanged = "feedbackText" in patch || "correction" in patch;
      return {
        ...current,
        [messageId]: { ...existing, ...patch, saved: textChanged ? false : patch.saved ?? existing.saved },
      };
    });
  }

  async function saveFeedback(message: Message, rating: FeedbackRating, feedbackText = "", correction = "") {
    setFeedbackDrafts((current) => ({
      ...current,
      [message.id]: {
        rating,
        feedbackText,
        correction,
        saved: false,
        saving: true,
        error: null,
      },
    }));

    try {
      const trace = messageTracesRef.current[message.id];
      await submitFeedback({
        message_id: message.id,
        conversation_id: message.conversation_id,
        rating,
        feedback_text: feedbackText.trim() || null,
        correction: rating === "thumbs_down" ? correction.trim() || null : null,
        latency_ms: trace?.latency_ms ?? null,
        retrieved_chunk_ids: trace?.retrieved_chunk_ids ?? null,
        tool_trace: trace?.tool_trace ?? null,
      });
      setFeedbackDrafts((current) => ({
        ...current,
        [message.id]: {
          ...(current[message.id] ?? { rating, feedbackText, correction }),
          rating,
          saved: true,
          saving: false,
          error: null,
        },
      }));
    } catch (error) {
      setFeedbackDrafts((current) => ({
        ...current,
        [message.id]: {
          ...(current[message.id] ?? { rating, feedbackText, correction, saved: false }),
          rating,
          saving: false,
          error: error instanceof Error ? error.message : "Feedback failed to save.",
        },
      }));
    }
  }

  function handleFeedbackRating(message: Message, rating: FeedbackRating) {
    const existing = feedbackDrafts[message.id];
    setFeedbackModalFor(message.id);
    void saveFeedback(
      message,
      rating,
      existing?.feedbackText ?? "",
      rating === "thumbs_down" ? existing?.correction ?? "" : "",
    );
  }

  async function handleFeedbackDetails(message: Message) {
    const draft = feedbackDrafts[message.id];
    if (!draft) return;
    await saveFeedback(message, draft.rating, draft.feedbackText, draft.correction);
    setFeedbackDrafts((current) => {
      const after = current[message.id];
      if (after && after.saved && !after.error) {
        setFeedbackModalFor((open) => (open === message.id ? null : open));
      }
      return current;
    });
  }

  function setDraftAndFocus(text: string) {
    setDraft(text);
    textareaRef.current?.focus();
  }

  const title = conversation?.title?.trim() || context?.subject || (conversation ? `Study session #${conversation.id}` : "New study session");
  const subtitleParts: string[] = [];
  if (context?.subject) {
    if (conversation) subtitleParts.push(`Session #${conversation.id}`);
    else subtitleParts.push("New study session");
  } else {
    subtitleParts.push("General study");
  }
  const subtitle = subtitleParts.join(" · ");
  const tutorName = userQuery.data?.tutor_name || "Sapient";
  const tutorInitials = initialsForName(tutorName);

  return (
    <div className="workspace">
      <div className="thread-pane">
        <div className="thread-topbar">
          <div className="thread-topbar-info">
            <div className="thread-topbar-title">{title}</div>
            <div className="thread-topbar-sub">{subtitle}</div>
          </div>
          <div className="thread-topbar-actions">
            {modelsQuery.data && modelsQuery.data.length > 0 && (
              <select
                className="model-picker"
                aria-label="Chat model"
                title="Model used for this conversation"
                value={
                  conversation?.model && modelsQuery.data.some((model) => model.id === conversation.model)
                    ? conversation.model
                    : modelsQuery.data[0]?.id ?? ""
                }
                disabled={!conversationId || modelMutation.isPending}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value) modelMutation.mutate(value);
                }}
              >
                {modelsQuery.data.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            {pomodoroEnabled && (
              <div className="focus-timer" role="group" aria-label="Focus timer">
                <span
                  className={`focus-timer-display ${timer.expired ? "expired" : timer.running ? "running" : "paused"}`}
                  title={timer.expired ? "Time is up" : timer.running ? "Counting down" : "Paused"}
                >
                  {formatTimer(timer.remaining)}
                </span>
                {timer.running ? (
                  <button
                    type="button"
                    className="focus-timer-btn"
                    onClick={() => timer.pause()}
                    title="Pause timer"
                    aria-label="Pause timer"
                  >
                    <Pause size={13} strokeWidth={2} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="focus-timer-btn"
                    onClick={() => timer.start()}
                    title={timer.expired ? "Reset to start again" : "Start timer"}
                    aria-label={timer.expired ? "Reset to start again" : "Start timer"}
                    disabled={timer.expired}
                  >
                    <Play size={13} strokeWidth={2} fill="currentColor" />
                  </button>
                )}
                <button
                  type="button"
                  className="focus-timer-btn"
                  onClick={() => {
                    timer.reset();
                    setBreakDismissed(false);
                  }}
                  title="Reset timer"
                  aria-label="Reset timer"
                >
                  <RotateCcw size={13} strokeWidth={2} />
                </button>
              </div>
            )}
            <button
              className="thread-action-btn"
              onClick={() => setLectureOpen(true)}
              title="Start a voice lecture on this topic"
              type="button"
            >
              <Play size={13} strokeWidth={2} fill="currentColor" style={{ marginRight: "0.3rem", verticalAlign: "-2px" }} />
              Lecture
            </button>
            <button
              className="thread-action-btn"
              onClick={() => setDraftAndFocus("Quiz me on this topic instead of explaining.")}
              type="button"
            >
              Quiz
            </button>
            {context?.subject && (
              <button
                className={`thread-action-btn ${showMaterials ? "active" : ""}`}
                onClick={() => {
                  setShowMaterials((m) => !m);
                  if (showNotes) setShowNotes(false);
                  if (showSources) setShowSources(false);
                }}
                title={`Materials attached to ${context.subject}`}
                type="button"
              >
                <FolderOpen size={13} strokeWidth={2} style={{ marginRight: "0.3rem", verticalAlign: "-2px" }} />
                Materials{subjectMaterials.length > 0 ? ` (${subjectMaterials.length})` : ""}
              </button>
            )}
            {conversationId !== null && (
              <button
                className={`thread-action-btn ${showNotes ? "active" : ""}`}
                onClick={() => {
                  setShowNotes((n) => !n);
                  if (showSources) setShowSources(false);
                  if (showMaterials) setShowMaterials(false);
                }}
                type="button"
              >
                Notes{allKeyIdeas.length > 0 ? ` (${allKeyIdeas.length})` : ""}
              </button>
            )}
            {sourceCount > 0 && (
              <button
                className={`thread-action-btn ${showSources ? "active" : ""}`}
                onClick={() => {
                  setShowSources((s) => !s);
                  if (showNotes) setShowNotes(false);
                  if (showMaterials) setShowMaterials(false);
                }}
                type="button"
              >
                Sources ({sourceCount})
              </button>
            )}
          </div>
        </div>

        {showPomodoroPrompt && (
          <div className="pomodoro-prompt">
            <span><Pause size={13} strokeWidth={2} style={{ verticalAlign: "-2px", marginRight: "0.4rem" }} />Time's up — take a 5-minute break. You focused for {Math.round(timer.durationSeconds / 60)} minutes.</span>
            <button
              onClick={() => {
                timer.reset();
                setBreakDismissed(true);
              }}
              type="button"
            >
              Reset & dismiss
            </button>
          </div>
        )}

        <div className="thread-body" ref={threadRef}>
          {conversationId === null || (conversationQuery.isFetched && messages.length === 0 && !isStreaming) ? (
            <div className="thread-empty">
              <h2>{context?.subject ?? "What should we work on?"}</h2>
              <p>
                {context
                  ? `Ask a question about ${context.subject} to start the study session.`
                  : "Start with a question or choose a guided prompt below."}
              </p>
              <div className="prompt-chips">
                {QUICK_PROMPTS.map((p) => (
                  <button key={p} className="prompt-chip" onClick={() => setDraftAndFocus(p)} type="button">
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {conversationQuery.isLoading && conversationId !== null ? (
            <div className="thread-empty">
              <p className="muted">Loading study session…</p>
            </div>
          ) : null}

          {messages.length > 0 || streamedText ? (
            <div className="messages">
              {messages.map((msg, idx) => {
                const isLastAssistant =
                  msg.role === "assistant" &&
                  !streamedText &&
                  !isStreaming &&
                  !messages.slice(idx + 1).some((m) => m.role === "assistant");
                if (msg.role === "user") {
                  return (
                    <div key={`${msg.id}-${msg.created_at}`} className="msg-user-row">
                      <div className="msg-user-bubble">{msg.content}</div>
                      <CopyButton text={msg.content} />
                    </div>
                  );
                }
                const msgDiagrams = messageDiagrams[msg.id] ?? [];
                const msgImages = messageImages[msg.id] ?? [];
                const liveResources = messageResources[msg.id] ?? [];
                const historicalResourcesForMsg = (conversationResourcesQuery.data ?? []).filter(
                  (r) => r.message_id === msg.id,
                );
                const liveResourceIds = new Set(liveResources.map((r) => r.id));
                const msgResources: (Resource | ResourceData)[] = [
                  ...historicalResourcesForMsg.filter((r) => !liveResourceIds.has(r.id)),
                  ...liveResources,
                ];
                const liveQuizzes = messageQuizzes[msg.id] ?? [];
                const historicalForMsg = historicalQuizzes.filter((q) => q.message_id === msg.id);
                const liveIds = new Set(liveQuizzes.map((q) => q.quiz_id));
                const msgQuizzes = [
                  ...historicalForMsg.filter((q) => !liveIds.has(q.quiz_id)),
                  ...liveQuizzes,
                ];
                return (
                  <Fragment key={`${msg.id}-${msg.created_at}`}>
                  <div className="msg">
                    <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                    <div className="msg-body">
                      <div className="msg-sender">{tutorName} · {formatTime(msg.created_at)}</div>
                      <MarkdownText className="msg-text" children={msg.content} webSources={webSources} />
                      <div className={`msg-actions${isLastAssistant ? " msg-actions-pinned" : ""}`}>
                        <CopyButton text={msg.content} />
                        <FeedbackButtons
                          message={msg}
                          draft={feedbackDrafts[msg.id]}
                          onRate={handleFeedbackRating}
                        />
                        <button
                          className={`msg-listen-btn${speakingId === String(msg.id) ? " active" : ""}`}
                          onClick={() => void speak(String(msg.id), msg.content)}
                          type="button"
                          title={
                            loadingId === String(msg.id)
                              ? "Loading audio…"
                              : speakingId === String(msg.id)
                              ? "Stop playback"
                              : "Read aloud"
                          }
                          aria-label={
                            loadingId === String(msg.id)
                              ? "Loading audio"
                              : speakingId === String(msg.id)
                              ? "Stop reading aloud"
                              : "Read aloud"
                          }
                        >
                          {loadingId === String(msg.id) ? (
                            <svg className="msg-listen-spinner" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
                              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                          ) : speakingId === String(msg.id) ? (
                            <svg fill="currentColor" height="13" viewBox="0 0 24 24" width="13">
                              <path d="M6 6h12v12H6z" />
                            </svg>
                          ) : (
                            <svg fill="currentColor" height="13" viewBox="0 0 24 24" width="13">
                              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                            </svg>
                          )}
                        </button>
                        {(() => {
                          const saved = savedSnippetKeys.has(`msg-${msg.id}-`)
                            || Array.from(savedSnippetKeys).some((k) => k.startsWith(`msg-${msg.id}-`));
                          return (
                            <button
                              className={`msg-save-btn${saved ? " saved" : ""}`}
                              onClick={() => handleSaveMessageSnippet(msg)}
                              type="button"
                              title={saved ? "Saved to notes" : "Save selection (or whole message) to notes"}
                              aria-label={saved ? "Saved to notes" : "Save to notes"}
                            >
                              {saved ? <BookmarkCheck size={14} strokeWidth={2} /> : <Bookmark size={14} strokeWidth={2} />}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  {msgDiagrams.map((d) => (
                    <div key={`diagram-${d.id}`} className="msg msg-artifact msg-artifact-diagram">
                      <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                      <div className="msg-body">
                        <div className="msg-sender msg-artifact-label">
                          <span className="msg-artifact-tag">Diagram</span>
                          <span className="msg-artifact-source">from {tutorName}</span>
                        </div>
                        <DiagramCard diagram={d} onSave={handleSaveDiagram} saved={savedSnippetKeys.has(`diagram-${d.id}`)} />
                      </div>
                    </div>
                  ))}
                  {msgQuizzes.map((q) => (
                    <div key={`quiz-${q.quiz_id}`} className="msg msg-artifact msg-artifact-quiz">
                      <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                      <div className="msg-body">
                        <div className="msg-sender msg-artifact-label">
                          <span className="msg-artifact-tag">Quiz</span>
                          <span className="msg-artifact-source">from {tutorName}</span>
                        </div>
                        <QuizCard quiz={q} onAnswered={handleQuizAnswered} onSkipped={handleQuizSkipped} />
                      </div>
                    </div>
                  ))}
                  {msgResources.map((r) => (
                    <div key={`resource-${r.id}`} className="msg msg-artifact msg-artifact-resource">
                      <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                      <div className="msg-body">
                        <div className="msg-sender msg-artifact-label">
                          <span className="msg-artifact-tag">{r.kind === "video" ? "Video" : "Article"}</span>
                          <span className="msg-artifact-source">recommended by {tutorName}</span>
                        </div>
                        <ResourceCard resource={r} />
                      </div>
                    </div>
                  ))}
                  {msgImages.map((image) => (
                    <div key={`image-${image.id}`} className="msg msg-artifact msg-artifact-image">
                      <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                      <div className="msg-body">
                        <div className="msg-sender msg-artifact-label">
                          <span className="msg-artifact-tag">Image</span>
                          <span className="msg-artifact-source">from {tutorName}</span>
                        </div>
                        <ImageArtifactCard image={image} onSave={handleSaveImage} saved={savedSnippetKeys.has(`image-${image.id}`)} />
                      </div>
                    </div>
                  ))}
                  </Fragment>
                );
              })}

              {isStreaming && !streamedText && (
                <div className="agent-thinking" aria-live="polite" aria-label="Thinking">
                  <span className="agent-thinking-dot" />
                  <span className="agent-thinking-dot" />
                  <span className="agent-thinking-dot" />
                </div>
              )}

              {streamedText && (
                <div className="msg">
                  <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                  <div className="msg-body">
                    <div className="msg-sender">{tutorName}</div>
                    <MarkdownText
                      className={`msg-text${streamedText && isStreaming ? " msg-text-streaming" : ""}`}
                      children={streamedText}
                      webSources={webSources}
                    />
                  </div>
                </div>
              )}

              {pendingQuizzes.map((q) => (
                <div key={`pending-quiz-${q.quiz_id}`} className="msg msg-artifact msg-artifact-quiz">
                  <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                  <div className="msg-body">
                    <div className="msg-sender msg-artifact-label">
                      <span className="msg-artifact-tag">Quiz</span>
                      <span className="msg-artifact-source">from {tutorName}</span>
                    </div>
                    <QuizCard quiz={q} onAnswered={handleQuizAnswered} onSkipped={handleQuizSkipped} />
                  </div>
                </div>
              ))}
              {pendingResources.map((r) => (
                <div key={`pending-resource-${r.id}`} className="msg msg-artifact msg-artifact-resource">
                  <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                  <div className="msg-body">
                    <div className="msg-sender msg-artifact-label">
                      <span className="msg-artifact-tag">{r.kind === "video" ? "Video" : "Article"}</span>
                      <span className="msg-artifact-source">recommended by {tutorName}</span>
                    </div>
                    <ResourceCard resource={r} />
                  </div>
                </div>
              ))}
              {pendingDiagrams.map((d) => (
                <div key={`pending-diagram-${d.id}`} className="msg msg-artifact msg-artifact-diagram">
                  <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                  <div className="msg-body">
                    <div className="msg-sender msg-artifact-label">
                      <span className="msg-artifact-tag">Diagram</span>
                      <span className="msg-artifact-source">from {tutorName}</span>
                    </div>
                    <DiagramCard diagram={d} />
                  </div>
                </div>
              ))}
              {pendingImages.map((image) => (
                <div key={`pending-image-${image.id}`} className="msg msg-artifact msg-artifact-image">
                  <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                  <div className="msg-body">
                    <div className="msg-sender msg-artifact-label">
                      <span className="msg-artifact-tag">Image</span>
                      <span className="msg-artifact-source">from {tutorName}</span>
                    </div>
                    <ImageArtifactCard image={image} onSave={handleSaveImage} saved={savedSnippetKeys.has(`image-${image.id}`)} />
                  </div>
                </div>
              ))}

              {streamError && (
                <div className="agent-step">
                  <div className="agent-step-dot">!</div>
                  <span className="agent-step-text" style={{ color: "var(--error)" }}>{streamError}</span>
                </div>
              )}

              {speechError && (
                <div className="agent-step">
                  <div className="agent-step-dot">!</div>
                  <span className="agent-step-text" style={{ color: "var(--error)" }}>{speechError}</span>
                </div>
              )}

              {/* Legacy fallback: pre-migration quizzes with no message_id link. */}
              {historicalQuizzes
                .filter((q) => q.message_id == null)
                .map((q) => (
                  <div key={`legacy-quiz-${q.quiz_id}`} className="msg msg-artifact msg-artifact-quiz">
                    <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                    <div className="msg-body">
                      <div className="msg-sender msg-artifact-label">
                        <span className="msg-artifact-tag">Quiz</span>
                        <span className="msg-artifact-source">from {tutorName}</span>
                      </div>
                      <QuizCard quiz={q} onAnswered={handleQuizAnswered} onSkipped={handleQuizSkipped} />
                    </div>
                  </div>
                ))}

            </div>
          ) : null}
        </div>

        <form className="composer" onSubmit={(e) => void handleSubmit(e)}>
          <div className="composer-controls">
            {SESSION_CONTROLS.map((c) => (
              <button key={c.label} className="composer-ctrl" onClick={() => setDraftAndFocus(c.prompt)} type="button">
                {c.label}
              </button>
            ))}
          </div>
          {attachments.length > 0 && (
            <div className="composer-attachments">
              {attachments.map((attachment) => (
                <div className={`composer-attachment composer-attachment-${attachment.status}`} key={attachment.id}>
                  <div className="composer-attachment-icon">
                    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                  </div>
                  <div className="composer-attachment-body">
                    <span className="composer-attachment-name">{attachment.file.name}</span>
                    <span className="composer-attachment-meta">
                      {formatFileSize(attachment.file.size)} · {attachment.status}
                      {attachment.error ? ` · ${attachment.error}` : ""}
                    </span>
                  </div>
                  <button
                    aria-label={`Remove ${attachment.file.name}`}
                    className="composer-attachment-remove"
                    disabled={isStreaming}
                    onClick={() => removeAttachment(attachment.id)}
                    type="button"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachmentError ? <div className="composer-error">{attachmentError}</div> : null}
          <div className="composer-row">
            <button
              aria-label="Attach file"
              className="composer-attach-btn"
              disabled={isStreaming}
              onClick={() => fileInputRef.current?.click()}
              title={context?.subject ? `Attach to ${context.subject}` : "Attach file"}
              type="button"
            >
              <Plus size={17} strokeWidth={2.2} />
            </button>
            <input
              accept={SUPPORTED_ATTACHMENT_ACCEPT}
              hidden
              multiple
              onChange={handleAttachmentChange}
              ref={fileInputRef}
              type="file"
            />
            <textarea
              ref={textareaRef}
              className="composer-textarea"
              placeholder="Ask a question…"
              rows={1}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); autoGrow(); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              aria-label={micRecording ? "Stop recording" : "Record voice input"}
              className={`composer-mic ${micRecording ? "composer-mic-active" : ""} ${micError ? "composer-mic-error" : ""}`}
              disabled={micLoading}
              onClick={toggleMic}
              title={micError ?? (micRecording ? "Stop recording" : "Voice input")}
              type="button"
            >
              {micLoading ? (
                <span className="composer-mic-spinner" />
              ) : (
                <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
                  <rect height="11" rx="3" width="6" x="9" y="2" />
                  <path d="M19 10a7 7 0 0 1-14 0" />
                  <line x1="12" x2="12" y1="19" y2="23" />
                  <line x1="8" x2="16" y1="23" y2="23" />
                </svg>
              )}
            </button>
            <button
              aria-label="Send message"
              className="composer-send"
              disabled={(!draft.trim() && attachments.length === 0) || isStreaming}
              type="submit"
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          </div>
        </form>
      </div>

      {showSources && sourceCount > 0 && (
        <div className="sources-panel">
          <div className="sources-header">
            <span className="sources-title">Sources ({sourceCount})</span>
            <button className="sources-close" onClick={() => setShowSources(false)} type="button">×</button>
          </div>
          <div className="sources-body">
            {sources.map((s) => (
              <div key={`${s.chunk_id}-${s.material_id}`} className="source-item">
                <div className="source-item-file">
                  {s.material_filename}
                  {s.page_number ? ` · p.${s.page_number}` : ""}
                </div>
                <div className="source-item-snippet">{s.snippet}</div>
                <div className="source-item-meta">{(s.similarity_score * 100).toFixed(0)}% match</div>
              </div>
            ))}
            {webSources.map((s, index) => (
              <a key={`${s.url}-${index}`} className="source-item source-item-link" href={s.url} rel="noreferrer" target="_blank">
                <div className="source-item-file">Web {index + 1}: {s.title}</div>
                <div className="source-item-snippet">{s.summary || s.snippet}</div>
                <div className="source-item-meta">{s.display_url || s.url}</div>
              </a>
            ))}
          </div>
        </div>
      )}

      {showMaterials && context?.subject && (
        <div className="sources-panel">
          <div className="sources-header">
            <span className="sources-title">
              Materials{subjectMaterials.length > 0 ? ` (${subjectMaterials.length})` : ""}
            </span>
            <button className="sources-close" onClick={() => setShowMaterials(false)} type="button">×</button>
          </div>
          <div className="sources-body">
            {subjectMaterialsQuery.isLoading ? (
              <p className="muted" style={{ padding: "0.5rem 0" }}>Loading…</p>
            ) : subjectMaterials.length === 0 ? (
              <div style={{ padding: "0.5rem 0" }}>
                <p className="muted" style={{ marginBottom: "0.75rem" }}>No materials attached yet.</p>
                <Link
                  to={`/projects/${encodeURIComponent(context.subject)}?tab=materials`}
                  className="button button-secondary"
                  style={{ fontSize: "0.78rem", padding: "0.4rem 0.7rem" }}
                >
                  Upload material
                </Link>
              </div>
            ) : (
              <>
                {subjectMaterials.map((m) => (
                  <Link
                    key={m.id}
                    to={`/projects/${encodeURIComponent(context.subject)}/materials/${m.id}`}
                    className="source-item materials-panel-item"
                  >
                    <div className="materials-panel-item-row">
                      <FileText size={14} strokeWidth={1.7} />
                      <span className="materials-panel-item-name">{m.filename}</span>
                      <span className={`status-dot status-dot-${m.status}`} />
                    </div>
                    {m.error_message ? (
                      <div className="source-item-meta" style={{ color: "var(--error)" }}>{m.error_message}</div>
                    ) : null}
                  </Link>
                ))}
                <Link
                  to={`/projects/${encodeURIComponent(context.subject)}?tab=materials`}
                  className="materials-panel-manage"
                >
                  Manage materials →
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {showNotes && conversationId !== null && (
        <ArtifactsPanel
          conversationId={conversationId}
          keyIdeas={allKeyIdeas}
          onClose={() => setShowNotes(false)}
          onIdeaDeleted={(id) => {
            setSseKeyIdeas((ks) => ks.filter((k) => k.id !== id));
            void queryClient.invalidateQueries({ queryKey: ["key-ideas", conversationId] });
          }}
        />
      )}

      {lectureOpen && (
        <LectureModeOverlay
          subject={context?.subject ?? null}
          tutorName={tutorName}
          tutorInitials={tutorInitials}
          onClose={() => setLectureOpen(false)}
        />
      )}

      {feedbackModalFor !== null && feedbackDrafts[feedbackModalFor] && (() => {
        const target = messages.find((m) => m.id === feedbackModalFor);
        if (!target) return null;
        return (
          <FeedbackModal
            message={target}
            draft={feedbackDrafts[feedbackModalFor]}
            onChange={updateFeedbackDraft}
            onSaveDetails={handleFeedbackDetails}
            onClose={() => setFeedbackModalFor(null)}
          />
        );
      })()}
    </div>
  );
}
