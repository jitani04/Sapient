import { getToken } from "./auth";
import type { AttemptResult, AuthResult, ChatRequest, ChatStreamEvent, Conversation, KeyIdea, Material, ProjectProfile, ProjectProgress, QuizRead, SessionSummary, TutorPreferences, UserProfile } from "./types";

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

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;

    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      // Keep the default error detail.
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

export async function createConversation(subject?: string): Promise<Conversation> {
  const response = await fetch(`${API_BASE_URL}/conversations`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ subject: subject ?? null }),
  });
  return parseJson(response);
}

export async function getConversation(conversationId: number): Promise<Conversation> {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function listMaterials(): Promise<Material[]> {
  const response = await fetch(`${API_BASE_URL}/materials`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function uploadMaterial(file: File, subject?: string): Promise<Material> {
  const formData = new FormData();
  formData.set("file", file);
  if (subject?.trim()) {
    formData.set("subject", subject.trim());
  }

  const response = await fetch(`${API_BASE_URL}/materials`, {
    method: "POST",
    headers: buildHeaders(),
    body: formData,
  });
  return parseJson(response);
}

export async function getProjectProfile(subject: string): Promise<ProjectProfile> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}`, {
    headers: buildHeaders(),
  });
  return parseJson(response);
}

export async function setupProject(subject: string, level: string | null, goals: string | null): Promise<ProjectProfile> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(subject)}/setup`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ subject, level, goals }),
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
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/chat/${conversationId}`, {
    method: "POST",
    headers: buildHeaders({
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    }),
    body: JSON.stringify(request),
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
