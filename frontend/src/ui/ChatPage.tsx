import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { RateLimitError, createConversation, deleteConversation, getConversation, getConversationQuizzes, getCurrentUser, getKeyIdeas, listMaterials, streamChat, uploadMaterial } from "../api";
import { getPendingStudyContext } from "../studyState";
import type { AttemptResult, ChatStreamEvent, Conversation, DiagramData, ImageData, KeyIdea, Material, Message, QuizData, RetrievedSource } from "../types";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { DiagramCard } from "./DiagramCard";
import { ImageArtifactCard } from "./ImageArtifactCard";
import { LectureModeOverlay } from "./LectureModeOverlay";
import { MarkdownText } from "./MarkdownText";
import { QuizCard } from "./QuizCard";
import { useSpeech } from "../useSpeech";
import { useMicrophone } from "../useMicrophone";
import { useSessionTimer, formatTimer } from "../useSessionTimer";

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

const POMODORO_KEY = "kp-pomodoro";
const POMODORO_INTERVAL_SECONDS = 25 * 60;

const ATTACHMENT_READY_TIMEOUT_MS = 25_000;
const ATTACHMENT_POLL_INTERVAL_MS = 1_500;
const SUPPORTED_ATTACHMENT_SUFFIXES = [".pdf", ".pptx", ".txt", ".md"];
const SUPPORTED_ATTACHMENT_ACCEPT = ".pdf,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown,text/x-markdown";

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
  if (words.length === 0) return "KP";
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
  const timer = useSessionTimer(conversationId);
  const [pomodoroEnabled] = useState(() => localStorage.getItem(POMODORO_KEY) === "true");
  const [dismissedIntervals, setDismissedIntervals] = useState(() => new Set<number>());
  const pomodoroInterval = Math.floor(timer.elapsed / POMODORO_INTERVAL_SECONDS);
  const showPomodoroPrompt = pomodoroEnabled && timer.active && pomodoroInterval > 0 && !dismissedIntervals.has(pomodoroInterval);
  const [draft, setDraft] = useState("");
  const [streamedText, setStreamedText] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sources, setSources] = useState<RetrievedSource[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [sseQuizzes, setSseQuizzes] = useState<QuizData[]>([]);
  const [sseKeyIdeas, setSseKeyIdeas] = useState<KeyIdea[]>([]);
  const [sseDiagrams, setSseDiagrams] = useState<DiagramData[]>([]);
  const [sseImages, setSseImages] = useState<ImageData[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pendingContext] = useState(() => getPendingStudyContext());
  const [lectureOpen, setLectureOpen] = useState(false);

  const userQuery = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
  });

  const conversationQuery = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => getConversation(conversationId!),
    enabled: conversationId !== null,
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
  const historicalKeyIdeasIds = new Set((keyIdeasQuery.data ?? []).map((k) => k.id));
  const allKeyIdeas: KeyIdea[] = [
    ...(keyIdeasQuery.data ?? []),
    ...sseKeyIdeas.filter((k) => !historicalKeyIdeasIds.has(k.id)),
  ];
  const historicalQuizzes: QuizData[] = (quizzesQuery.data ?? []).map((q) => ({
    quiz_id: q.id,
    question: q.question,
    quiz_type: q.quiz_type as QuizData["quiz_type"],
    options: q.options,
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
    setShowSources(false);
    setSseQuizzes([]);
    setSseKeyIdeas([]);
    setSseDiagrams([]);
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
        ? "Only PDF, PPTX, TXT, and MD attachments are supported."
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

    timer.start();
    setStreamError(null);
    setAttachmentError(null);
    setStreamedText("");
    setSources([]);
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
      setStreamedText("");
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
    const msg = result.is_correct
      ? `I answered "${answer}" — that was correct!`
      : `I answered "${answer}" but got it wrong. The correct answer was "${result.correct_answer}". Can you explain why?`;
    void send(msg);
  }

  function handleQuizSkipped(result: AttemptResult) {
    void send(`I skipped that quiz question. The correct answer was "${result.correct_answer}". Can you explain it before we move on?`);
  }

  function handleEvent(event: ChatStreamEvent) {
    if (event.event === "token") { setStreamedText((t) => t + event.data.delta); return; }
    if (event.event === "sources") { setSources(event.data.sources); return; }
    if (event.event === "quiz") { setSseQuizzes((q) => [...q, event.data]); return; }
    if (event.event === "diagram") {
      setSseDiagrams((d) => [...d, event.data]);
      return;
    }
    if (event.event === "image") {
      setSseImages((images) => [...images, event.data]);
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
    if (event.event === "error") {
      if (event.data.rate_limited && event.data.retry_after_seconds) {
        setStreamError(`AI is rate-limited. Try again in ~${event.data.retry_after_seconds}s.`);
      } else {
        setStreamError(event.data.error);
      }
    }
  }

  function setDraftAndFocus(text: string) {
    setDraft(text);
    textareaRef.current?.focus();
  }

  const title = context?.subject ?? (conversation ? `Study session #${conversation.id}` : "New study session");
  const subtitle = context?.subject ?? "General study";
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
            {timer.active && (
              <span className="thread-timer" title="Session duration">{formatTimer(timer.elapsed)}</span>
            )}
            <button
              className="thread-action-btn"
              onClick={() => setLectureOpen(true)}
              title="Start a voice lecture on this topic"
              type="button"
            >
              ▶ Lecture
            </button>
            <button
              className="thread-action-btn"
              onClick={() => setDraftAndFocus("Quiz me on this topic instead of explaining.")}
              type="button"
            >
              Quiz
            </button>
            {conversationId !== null && (
              <button
                className={`thread-action-btn ${showNotes ? "active" : ""}`}
                onClick={() => { setShowNotes((n) => !n); if (showSources) setShowSources(false); }}
                type="button"
              >
                Notes{allKeyIdeas.length > 0 ? ` (${allKeyIdeas.length})` : ""}
              </button>
            )}
            {sources.length > 0 && (
              <button
                className={`thread-action-btn ${showSources ? "active" : ""}`}
                onClick={() => { setShowSources((s) => !s); if (showNotes) setShowNotes(false); }}
                type="button"
              >
                Sources ({sources.length})
              </button>
            )}
          </div>
        </div>

        {showPomodoroPrompt && (
          <div className="pomodoro-prompt">
            <span>⏸ Time for a 5-minute break! You've been studying for {pomodoroInterval * 25} minutes.</span>
            <button
              onClick={() => setDismissedIntervals((d) => { const next = new Set(d); next.add(pomodoroInterval); return next; })}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="thread-body" ref={threadRef}>
          {conversationId === null || (conversationQuery.isFetched && messages.length === 0 && !isStreaming) ? (
            <div className="thread-empty">
              <div className="thread-empty-glyph">◎</div>
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
              {messages.map((msg) =>
                msg.role === "user" ? (
                  <div key={`${msg.id}-${msg.created_at}`} className="msg-user-row">
                    <div className="msg-user-bubble">{msg.content}</div>
                    <CopyButton text={msg.content} />
                  </div>
                ) : (
                  <div key={`${msg.id}-${msg.created_at}`} className="msg">
                    <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                    <div className="msg-body">
                      <div className="msg-sender">{tutorName} · {formatTime(msg.created_at)}</div>
                      <MarkdownText className="msg-text" children={msg.content} />
                      <div className="msg-actions">
                        <CopyButton text={msg.content} />
                        <button
                          className={`msg-listen-btn${speakingId === String(msg.id) ? " active" : ""}`}
                          onClick={() => void speak(String(msg.id), msg.content)}
                          type="button"
                        >
                          {loadingId === String(msg.id) ? (
                            <>
                              <svg fill="currentColor" height="13" viewBox="0 0 24 24" width="13">
                                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                              </svg>
                              Loading…
                            </>
                          ) : speakingId === String(msg.id) ? (
                            <>
                              <svg fill="currentColor" height="13" viewBox="0 0 24 24" width="13">
                                <path d="M6 6h12v12H6z"/>
                              </svg>
                              Stop
                            </>
                          ) : (
                            <>
                              <svg fill="currentColor" height="13" viewBox="0 0 24 24" width="13">
                                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                              </svg>
                              Read aloud
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              )}

              {isStreaming && (
                <div className="agent-step">
                  <div className="agent-step-dot">⟳</div>
                  <span className="agent-step-text">I am selecting the best approach…</span>
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
                    />
                  </div>
                </div>
              )}

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

              {(() => {
                const sseIds = new Set(sseQuizzes.map((q) => q.quiz_id));
                const allQuizzes = [
                  ...historicalQuizzes.filter((q) => !sseIds.has(q.quiz_id)),
                  ...sseQuizzes,
                ];
                return allQuizzes.map((q) => (
                  <div key={q.quiz_id} className="msg msg-artifact msg-artifact-quiz">
                    <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                    <div className="msg-body">
                      <div className="msg-sender msg-artifact-label">
                        <span className="msg-artifact-tag">Quiz</span>
                        <span className="msg-artifact-source">from {tutorName}</span>
                      </div>
                      <QuizCard quiz={q} onAnswered={handleQuizAnswered} onSkipped={handleQuizSkipped} />
                    </div>
                  </div>
                ));
              })()}

              {sseDiagrams.map((d) => (
                <div key={d.id} className="msg msg-artifact msg-artifact-diagram">
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

              {sseImages.map((image) => (
                <div key={image.id} className="msg msg-artifact msg-artifact-image">
                  <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                  <div className="msg-body">
                    <div className="msg-sender msg-artifact-label">
                      <span className="msg-artifact-tag">Image</span>
                      <span className="msg-artifact-source">from {tutorName}</span>
                    </div>
                    <ImageArtifactCard image={image} />
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
              <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" width="17">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
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
            <button className="composer-send" disabled={(!draft.trim() && attachments.length === 0) || isStreaming} type="submit">
              ↑
            </button>
          </div>
          <div className="composer-hint">Press Enter to send · Shift+Enter for new line</div>
        </form>
      </div>

      {showSources && sources.length > 0 && (
        <div className="sources-panel">
          <div className="sources-header">
            <span className="sources-title">Sources ({sources.length})</span>
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
    </div>
  );
}
