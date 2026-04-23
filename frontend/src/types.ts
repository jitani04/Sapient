export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: number;
  conversation_id: number;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface Conversation {
  id: number;
  user_id: number;
  subject: string | null;
  created_at: string;
  messages: Message[];
  summary: SessionSummary | null;
}

export interface UserProfile {
  id: number;
  email: string;
  name: string | null;
  use_case: string | null;
  onboarding_complete: boolean;
  tutor_name: string;
  tutor_tone: string;
  tutor_style: string;
  tutor_instructions: string;
}

export interface TutorPreferences {
  tutor_name: string;
  tutor_tone: string;
  tutor_style: string;
  tutor_instructions: string;
}

export interface AuthResult {
  access_token: string;
  token_type: string;
  user: UserProfile;
}

export interface ChatRequest {
  message: string;
}

export type MaterialStatus = "processing" | "ready" | "failed";

export interface Material {
  id: number;
  user_id: number;
  filename: string;
  mime_type: string;
  subject: string | null;
  status: MaterialStatus;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface RetrievedSource {
  chunk_id: number;
  material_id: number;
  material_filename: string;
  subject: string | null;
  page_number: number | null;
  snippet: string;
  similarity_score: number;
}

export interface ChatStartEvent {
  event: "start";
  data: {
    conversation_id: number;
    message_id: number | null;
  };
}

export interface ChatTokenEvent {
  event: "token";
  data: {
    delta: string;
  };
}

export interface ChatSourcesEvent {
  event: "sources";
  data: {
    sources: RetrievedSource[];
  };
}

export interface ChatEndEvent {
  event: "end";
  data: {
    assistant_message_id: number;
    usage?: Record<string, unknown> | null;
  };
}

export interface ChatErrorEvent {
  event: "error";
  data: {
    error: string;
  };
}

export interface MindMapNode {
  topic: string;
  subtopics: string[];
}

export interface MindMap {
  subject: string;
  nodes: MindMapNode[];
}

export interface ProjectProfile {
  id: number;
  subject: string;
  level: string | null;
  goals: string | null;
  mind_map: MindMap | null;
  created_at: string;
}

export interface QuizData {
  quiz_id: number;
  question: string;
  quiz_type: "multiple_choice" | "short_answer";
  options: string[] | null;
}

export interface QuizRead extends QuizData {
  id: number;
  conversation_id: number;
  created_at: string;
}

export interface AttemptResult {
  is_correct: boolean;
  correct_answer: string;
  explanation: string;
}

export interface ChatQuizEvent {
  event: "quiz";
  data: QuizData;
}

export interface ChatKeyIdeaEvent {
  event: "key_idea";
  data: {
    id: number;
    concept: string;
    summary: string;
  };
}

export interface DiagramData {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elements: any[];
  title?: string;
}

export interface ChatDiagramEvent {
  event: "diagram";
  data: DiagramData;
}

export type ChatStreamEvent = ChatStartEvent | ChatTokenEvent | ChatSourcesEvent | ChatEndEvent | ChatErrorEvent | ChatQuizEvent | ChatKeyIdeaEvent | ChatDiagramEvent;

export interface KeyIdea {
  id: number;
  concept: string;
  summary: string;
  subject: string | null;
  created_at: string;
}

export interface SessionSummary {
  covered: string[];
  struggled_with: string[];
  key_concepts: string[];
  next_review: string[];
}

export interface ProjectProgress {
  total_sessions: number;
  sessions_with_summary: number;
  quizzes_attempted: number;
  quizzes_passed: number;
  pass_rate: number | null;
  concepts_covered: string[];
  weak_areas: string[];
  next_review: string[];
}
