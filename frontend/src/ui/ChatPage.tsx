import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { createConversation, getConversation, getConversationQuizzes, getCurrentUser, getKeyIdeas, streamChat } from "../api";
import { getPendingStudyContext } from "../studyState";
import type { AttemptResult, ChatStreamEvent, Conversation, DiagramData, KeyIdea, Message, QuizData, RetrievedSource } from "../types";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { DiagramCard } from "./DiagramCard";
import { MarkdownText } from "./MarkdownText";
import { QuizCard } from "./QuizCard";

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

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function initialsForName(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "KP";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function ChatPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const conversationId = params.conversationId ? Number(params.conversationId) : null;
  const [draft, setDraft] = useState("");
  const [streamedText, setStreamedText] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sources, setSources] = useState<RetrievedSource[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [sseQuizzes, setSseQuizzes] = useState<QuizData[]>([]);
  const [sseKeyIdeas, setSseKeyIdeas] = useState<KeyIdea[]>([]);
  const [sseDiagrams, setSseDiagrams] = useState<DiagramData[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  const [pendingContext] = useState(() => getPendingStudyContext());

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
    mutationFn: () => createConversation(),
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

  useEffect(() => {
    if (sources.length > 0) setShowSources(true);
  }, [sources]);

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function send(message: string) {
    if (!message.trim() || isStreaming) return;

    setStreamError(null);
    setStreamedText("");
    setSources([]);
    setIsStreaming(true);

    let target = conversation;
    if (!target) {
      target = await createMutation.mutateAsync();
    }

    const optimistic: Message = {
      id: -1, conversation_id: target.id,
      role: "user", content: message,
      created_at: new Date().toISOString(),
    };

    queryClient.setQueryData<Conversation | undefined>(
      ["conversation", target.id],
      (cur) => cur ? { ...cur, messages: [...cur.messages, optimistic] } : cur,
    );

    try {
      await streamChat(target.id, { message }, handleEvent);
      await queryClient.invalidateQueries({ queryKey: ["conversation", target.id] });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["conversation-quizzes", target.id] });
      await queryClient.invalidateQueries({ queryKey: ["key-ideas", target.id] });
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : "Streaming failed.");
      await queryClient.invalidateQueries({ queryKey: ["conversation", target.id] });
    } finally {
      setIsStreaming(false);
      setStreamedText("");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    setDraft("");
    await send(message);
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
    if (event.event === "key_idea") {
      setSseKeyIdeas((ks) => [...ks, {
        id: event.data.id,
        concept: event.data.concept,
        summary: event.data.summary,
        subject: null,
        created_at: new Date().toISOString(),
      }]);
      setShowNotes(true);
      return;
    }
    if (event.event === "error") { setStreamError(event.data.error); }
  }

  function setDraftAndFocus(text: string) {
    setDraft(text);
    textareaRef.current?.focus();
  }

  const title = context?.subject ?? (conversation ? `Session #${conversation.id}` : "New session");
  const subtitle = context?.subject ?? "General study";
  const tutorName = userQuery.data?.tutor_name || "KnowledgePal";
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

        <div className="thread-body" ref={threadRef}>
          {conversationId === null || (conversationQuery.isFetched && messages.length === 0 && !isStreaming) ? (
            <div className="thread-empty">
              <div className="thread-empty-glyph">◎</div>
              <h2>{context?.subject ?? "What should we work on?"}</h2>
              <p>
                {context
                  ? `Ask a question about ${context.subject} to start the session.`
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
              <p className="muted">Loading session…</p>
            </div>
          ) : null}

          {messages.length > 0 || streamedText ? (
            <div className="messages">
              {messages.map((msg) =>
                msg.role === "user" ? (
                  <div key={`${msg.id}-${msg.created_at}`} className="msg-user-row">
                    <div className="msg-user-bubble">{msg.content}</div>
                  </div>
                ) : (
                  <div key={`${msg.id}-${msg.created_at}`} className="msg">
                    <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                    <div className="msg-body">
                      <div className="msg-sender">{tutorName} · {formatTime(msg.created_at)}</div>
                      <MarkdownText className="msg-text" children={msg.content} />
                    </div>
                  </div>
                )
              )}

              {isStreaming && (
                <div className="agent-step">
                  <div className="agent-step-dot">⟳</div>
                  <span className="agent-step-text">{tutorName} is selecting the best approach…</span>
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

              {(() => {
                const sseIds = new Set(sseQuizzes.map((q) => q.quiz_id));
                const allQuizzes = [
                  ...historicalQuizzes.filter((q) => !sseIds.has(q.quiz_id)),
                  ...sseQuizzes,
                ];
                return allQuizzes.map((q) => (
                  <div key={q.quiz_id} className="msg">
                    <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                    <div className="msg-body">
                      <div className="msg-sender">{tutorName}</div>
                      <QuizCard quiz={q} onAnswered={handleQuizAnswered} onSkipped={handleQuizSkipped} />
                    </div>
                  </div>
                ));
              })()}

              {sseDiagrams.map((d) => (
                <div key={d.id} className="msg">
                  <div className="msg-avatar msg-avatar-ai">{tutorInitials}</div>
                  <div className="msg-body">
                    <div className="msg-sender">{tutorName}</div>
                    <DiagramCard diagram={d} />
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
          <div className="composer-row">
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
                  void handleSubmit(e as unknown as FormEvent);
                }
              }}
            />
            <button className="composer-send" disabled={!draft.trim() || isStreaming} type="submit">
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
    </div>
  );
}
