import { getToken } from "./auth";
import type { Assignment, AssignmentInput, AssignmentUpdate, AttemptResult, AuthResult, CalendarFeed, CalendarFeedSyncResponse, ChatRequest, ChatStreamEvent, Conversation, FeedbackRequest, FeedbackResponse, Flashcard, FlashcardDueResponse, KeyIdea, KeyIdeaArtifactData, KeyIdeaArtifactType, LearningMapStatus, Material, MindMap, ProjectCoverImageOption, ProjectProfile, ProjectProgress, QuizRead, Resource, SearchResponse, SessionSummary, SmartReminder, TutorPreferences, UserProfile, WeakQuizResponse } from "./types";

function resolveDefaultApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:8000";
  }

  const protocol = window.location.protocol;
  const hostname = window.location.hostname || "127.0.0.1";
  return `${protocol}//${hostname}:8000`;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? resolveDefaultApiBaseUrl();

function buildHeaders(extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders);
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function _parseRetryAfter(response: Response, body: { retry_after_seconds?: unknown } | null): number {
  const fromBody = body && typeof body.retry_after_seconds === "number" ? body.retry_after_seconds : null;
  if (fromBody && fromBody > 0) return fromBody;
  const header = response.headers.get("Retry-After");
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 60;
}

interface ErrorBody {
  detail?: string;
  retry_after_seconds?: number;
  rate_limited?: boolean;
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    let body: ErrorBody | null = null;
    try {
      body = (await response.json()) as ErrorBody;
      if (body.detail) detail = body.detail;
    } catch {
      // Keep the default error detail.
    }

    if (response.status === 503 && body?.rate_limited) {
      throw new RateLimitError(detail, _parseRetryAfter(response, body));
    }
    if (response.status === 429) {
      throw new RateLimitError(detail, _parseRetryAfter(response, body));
    }

    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export async function getHealth(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/health`);
  return parseJson(response);
}

export async function register(email: string, password: string): Promise<AuthResult> {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password }),
  });
  return parseJson(response);
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password }),
  });
  return parseJson(response);
}

export async function loginWithGoogle(credential: string): Promise<AuthResult> {
  const response = await fetch(`${API_BASE_URL}/auth/google`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ credential }),
  });
  return parseJson(response);
}

export async function getCurrentUser(): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function completeOnboarding(name: string, useCase: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/auth/onboarding`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name, use_case: useCase }),
  });
  return parseJson(response);
}

export async function updateTutorPreferences(preferences: TutorPreferences): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/auth/tutor`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(preferences),
  });
  return parseJson(response);
}

export async function listConversations(): Promise<Conversation[]> {
  const response = await fetch(`${API_BASE_URL}/conversations`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function createConversation(
  subject?: string,
  options?: { isLecture?: boolean; model?: string | null },
): Promise<Conversation> {
  const response = await fetch(`${API_BASE_URL}/conversations`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      subject: subject ?? null,
      is_lecture: options?.isLecture ?? false,
      model: options?.model ?? null,
    }),
  });
  return parseJson(response);
}

export async function getConversation(conversationId: number): Promise<Conversation> {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function updateConversationTitle(conversationId: number, title: string): Promise<Conversation> {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
    method: "PATCH",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ title }),
  });
  return parseJson(response);
}

export async function updateConversationModel(conversationId: number, model: string): Promise<Conversation> {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
    method: "PATCH",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ model }),
  });
  return parseJson(response);
}

export async function listModels(): Promise<{ id: string; label: string; provider: string }[]> {
  const response = await fetch(`${API_BASE_URL}/models`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function listSubjectResources(subject: string): Promise<Resource[]> {
  const response = await fetch(
    `${API_BASE_URL}/projects/${encodeURIComponent(subject)}/resources`,
    { headers: buildHeaders() },
  );
  return parseJson(response);
}

export async function listConversationResources(conversationId: number): Promise<Resource[]> {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/resources`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function deleteResource(resourceId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/resources/${resourceId}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to delete resource: ${response.status}`);
  }
}

export async function submitFeedback(request: FeedbackRequest): Promise<FeedbackResponse> {
  const response = await fetch(`${API_BASE_URL}/feedback`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(request),
  });
  return parseJson(response);
}

export async function deleteConversation(conversationId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Delete failed: ${response.status} ${response.statusText}`);
  }
}

export async function listMaterials(subject?: string): Promise<Material[]> {
  const params = new URLSearchParams();
  if (subject?.trim()) {
    params.set("subject", subject.trim());
  }

  const response = await fetch(`${API_BASE_URL}/materials${params.size ? `?${params.toString()}` : ""}`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function listAssignments(options?: { subject?: string; includeCompleted?: boolean }): Promise<Assignment[]> {
  const params = new URLSearchParams();
  if (options?.subject?.trim()) params.set("subject", options.subject.trim());
  if (options?.includeCompleted) params.set("include_completed", "true");
  const qs = params.toString();
  const response = await fetch(`${API_BASE_URL}/assignments${qs ? `?${qs}` : ""}`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function createAssignment(input: AssignmentInput): Promise<Assignment> {
  const response = await fetch(`${API_BASE_URL}/assignments`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parseJson(response);
}

export async function updateAssignment(assignmentId: number, input: AssignmentUpdate): Promise<Assignment> {
  const response = await fetch(`${API_BASE_URL}/assignments/${assignmentId}`, {
    method: "PATCH",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parseJson(response);
}

export async function deleteAssignment(assignmentId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/assignments/${assignmentId}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  if (!response.ok) {
    await parseJson(response);
  }
}

export async function listSmartReminders(): Promise<SmartReminder[]> {
  const response = await fetch(`${API_BASE_URL}/assignments/reminders`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function listCalendarFeeds(): Promise<CalendarFeed[]> {
  const response = await fetch(`${API_BASE_URL}/calendar-feeds`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function createCalendarFeed(input: { name: string; url: string; subject?: string | null }): Promise<CalendarFeedSyncResponse> {
  const response = await fetch(`${API_BASE_URL}/calendar-feeds`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parseJson(response);
}

export async function syncCalendarFeed(feedId: number): Promise<CalendarFeedSyncResponse> {
  const response = await fetch(`${API_BASE_URL}/calendar-feeds/${feedId}/sync`, {
    method: "POST",
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function deleteCalendarFeed(feedId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/calendar-feeds/${feedId}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  if (!response.ok) {
    await parseJson(response);
  }
}

interface PresignResponse {
  upload_url: string;
  key: string;
  expires_in: number;
  max_bytes: number;
  required_headers: Record<string, string>;
}

export async function uploadMaterial(file: File, subject?: string): Promise<Material> {
  const mimeType = file.type || "application/octet-stream";

  const presignResp = await fetch(`${API_BASE_URL}/materials/presign`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ filename: file.name, mime_type: mimeType }),
  });
  const presigned = await parseJson<PresignResponse>(presignResp);

  if (file.size > presigned.max_bytes) {
    throw new Error(`Upload exceeds the ${presigned.max_bytes} byte limit.`);
  }

  const putResp = await fetch(presigned.upload_url, {
    method: "PUT",
    headers: presigned.required_headers,
    body: file,
  });
  if (!putResp.ok) {
    throw new Error(`Upload failed (${putResp.status} ${putResp.statusText}).`);
  }

  const createResp = await fetch(`${API_BASE_URL}/materials`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      filename: file.name,
      mime_type: mimeType,
      subject: subject?.trim() || null,
      key: presigned.key,
    }),
  });
  return parseJson(createResp);
}

export interface MaterialPreview {
  url: string;
  expires_in: number;
  mime_type: string;
  filename: string;
}

export async function getMaterialPreviewUrl(materialId: number): Promise<MaterialPreview> {
  const response = await fetch(`${API_BASE_URL}/materials/${materialId}/preview-url`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export interface MaterialTextChunk {
  content: string;
  page_number: number | null;
}

export interface MaterialTextResponse {
  filename: string;
  mime_type: string;
  chunks: MaterialTextChunk[];
}

export async function getMaterialExtractedText(materialId: number): Promise<MaterialTextResponse> {
  const response = await fetch(`${API_BASE_URL}/materials/${materialId}/text`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function getProjectProfile(subject: string): Promise<ProjectProfile> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function listProjectProfiles(): Promise<ProjectProfile[]> {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function deleteProjectSubject(subject: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  if (!response.ok) {
    await parseJson(response);
  }
}

export async function searchProjectCoverImages(query: string): Promise<ProjectCoverImageOption[]> {
  const response = await fetch(`${API_BASE_URL}/projects/cover-images/search?query=${encodeURIComponent(query)}`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export interface CoverImageUploadResult {
  storage_key: string;
  cover_image_url: string;
}

interface CoverImagePresignResponse {
  upload_url: string;
  storage_key: string;
  expires_in: number;
  max_bytes: number;
  required_headers: Record<string, string>;
}

export async function uploadProjectCoverImage(file: File): Promise<CoverImageUploadResult> {
  const mimeType = file.type || "application/octet-stream";

  const presignResp = await fetch(`${API_BASE_URL}/projects/cover-images/presign`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ filename: file.name, mime_type: mimeType }),
  });
  const presigned = await parseJson<CoverImagePresignResponse>(presignResp);

  if (file.size > presigned.max_bytes) {
    throw new Error(`Image exceeds the ${(presigned.max_bytes / (1024 * 1024)).toFixed(0)}MB limit.`);
  }

  const putResp = await fetch(presigned.upload_url, {
    method: "PUT",
    headers: presigned.required_headers,
    body: file,
  });
  if (!putResp.ok) {
    throw new Error(`Upload failed (${putResp.status} ${putResp.statusText}).`);
  }

  return {
    storage_key: presigned.storage_key,
    cover_image_url: URL.createObjectURL(file),
  };
}

export async function setupProject(
  subject: string,
  level: string | null,
  goals: string | null,
  coverImageUrl: string | null,
  coverImageStorageKey: string | null = null,
  coverImageSource: string | null = null,
  coverImageSourceUrl: string | null = null,
  coverImagePhotographer: string | null = null,
  coverImagePhotographerUrl: string | null = null,
): Promise<ProjectProfile> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}/setup`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      subject,
      level,
      goals,
      cover_image_url: coverImageStorageKey ? null : coverImageUrl,
      cover_image_storage_key: coverImageStorageKey,
      cover_image_source: coverImageStorageKey ? "upload" : coverImageSource,
      cover_image_source_url: coverImageStorageKey ? null : coverImageSourceUrl,
      cover_image_photographer: coverImageStorageKey ? null : coverImagePhotographer,
      cover_image_photographer_url: coverImageStorageKey ? null : coverImagePhotographerUrl,
    }),
  });
  return parseJson(response);
}

export async function searchAll(q: string): Promise<SearchResponse> {
  const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(q)}`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function transcribeAudio(blob: Blob, filename: string): Promise<string> {
  const formData = new FormData();
  formData.append("audio", blob, filename);
  const response = await fetch(`${API_BASE_URL}/stt`, {
    method: "POST",
    headers: buildHeaders(),
    body: formData,
  });
  return parseJson<{ text: string }>(response).then((r) => r.text);
}

export async function generateWeakQuiz(subject: string): Promise<WeakQuizResponse> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}/weak-quiz`, {
    method: "POST",
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function generateSubjectQuiz(
  subject: string,
  options: { count?: number; focus?: string | null } = {},
): Promise<WeakQuizResponse> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}/quizzes/generate`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ count: options.count ?? 5, focus: options.focus ?? null }),
  });
  return parseJson(response);
}

export async function createManualQuiz(input: {
  subject?: string | null;
  question: string;
  concept?: string | null;
  quiz_type: "multiple_choice" | "short_answer";
  options?: string[] | null;
  correct_answer: string;
  explanation?: string;
}): Promise<QuizRead> {
  const response = await fetch(`${API_BASE_URL}/quizzes`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      ...input,
      options: input.quiz_type === "multiple_choice" ? input.options ?? [] : null,
      explanation: input.explanation ?? "",
    }),
  });
  return parseJson(response);
}

export async function generateSubjectFlashcards(
  subject: string,
  options: { count?: number; focus?: string | null } = {},
): Promise<{ created: number }> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}/flashcards/generate`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ count: options.count ?? 8, focus: options.focus ?? null }),
  });
  return parseJson(response);
}

export async function getProjectProgress(subject: string): Promise<ProjectProgress> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}/progress`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function generateMindMap(subject: string): Promise<ProjectProfile> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}/mindmap`, {
    method: "POST",
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function updateLearningMapProgress(
  subject: string,
  nodeId: string,
  status: LearningMapStatus,
): Promise<ProjectProfile> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}/learning-map/progress`, {
    method: "PATCH",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ node_id: nodeId, status }),
  });
  return parseJson(response);
}

export async function updateProjectMindMap(
  subject: string,
  mindMap: MindMap,
  learningMapProgress: Record<string, LearningMapStatus>,
): Promise<ProjectProfile> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}/mindmap`, {
    method: "PUT",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ mind_map: mindMap, learning_map_progress: learningMapProgress }),
  });
  return parseJson(response);
}

export async function getConversationQuizzes(conversationId: number): Promise<QuizRead[]> {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/quizzes`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function submitQuizAttempt(quizId: number, answer: string): Promise<AttemptResult> {
  const response = await fetch(`${API_BASE_URL}/quizzes/${quizId}/attempt`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ answer }),
  });
  return parseJson(response);
}

export async function skipQuizQuestion(quizId: number): Promise<AttemptResult> {
  const response = await fetch(`${API_BASE_URL}/quizzes/${quizId}/skip`, {
    method: "POST",
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function getKeyIdeas(conversationId: number): Promise<KeyIdea[]> {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/key-ideas`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function listAllKeyIdeas(subject?: string, q?: string): Promise<KeyIdea[]> {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (q) params.set("q", q);
  const qs = params.toString();
  const response = await fetch(`${API_BASE_URL}/key-ideas${qs ? `?${qs}` : ""}`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function createKeyIdea(input: {
  concept: string;
  summary: string;
  subject?: string | null;
  artifact_type?: KeyIdeaArtifactType | null;
  artifact_data?: KeyIdeaArtifactData | null;
}): Promise<KeyIdea> {
  const response = await fetch(`${API_BASE_URL}/key-ideas`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parseJson(response);
}

export async function updateKeyIdea(ideaId: number, input: { concept: string; summary: string }): Promise<KeyIdea> {
  const response = await fetch(`${API_BASE_URL}/key-ideas/${ideaId}`, {
    method: "PATCH",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parseJson(response);
}

export async function promoteKeyIdea(ideaId: number): Promise<KeyIdea> {
  const response = await fetch(`${API_BASE_URL}/key-ideas/${ideaId}/promote`, {
    method: "POST",
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function deleteKeyIdea(ideaId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/key-ideas/${ideaId}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  if (!response.ok) {
    await parseJson(response);
  }
}

export async function generateSummary(conversationId: number): Promise<SessionSummary> {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/summary`, {
    method: "POST",
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function getDueFlashcards(subject?: string): Promise<FlashcardDueResponse> {
  const params = new URLSearchParams();
  if (subject?.trim()) {
    params.set("subject", subject.trim());
  }

  const response = await fetch(`${API_BASE_URL}/flashcards/due${params.size ? `?${params.toString()}` : ""}`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function reviewFlashcard(cardId: number, quality: number): Promise<Flashcard> {
  const response = await fetch(`${API_BASE_URL}/flashcards/${cardId}/review`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ quality }),
  });
  return parseJson(response);
}

export async function fetchSpeech(text: string, voice?: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/tts`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(voice ? { text, voice } : { text }),
  });
  if (!response.ok) {
    throw new Error(`TTS failed: ${response.status}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function deleteMaterial(materialId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/materials/${materialId}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });

  if (!response.ok) {
    await parseJson(response);
  }
}

function parseEventBlock(block: string): ChatStreamEvent | null {
  const lines = block.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: JSON.parse(dataLines.join("\n")),
  } as ChatStreamEvent;
}

export async function streamChat(
  conversationId: number,
  request: ChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/chat/${conversationId}`, {
    method: "POST",
    headers: buildHeaders({
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    }),
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Streaming request failed: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Streaming response body is not available.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex === -1) {
        break;
      }

      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const parsed = parseEventBlock(block);
      if (parsed) {
        onEvent(parsed);
      }
    }
  }

  const trailingBlock = buffer.trim();
  if (trailingBlock) {
    const parsed = parseEventBlock(trailingBlock);
    if (parsed) {
      onEvent(parsed);
    }
  }
}
