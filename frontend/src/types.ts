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
  is_lecture: boolean;
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
  tutor_voice: TutorVoice;
}

export type TutorVoice =
  | "alloy"
  | "ash"
  | "coral"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "sage"
  | "shimmer";

export interface TutorPreferences {
  tutor_name: string;
  tutor_tone: string;
  tutor_style: string;
  tutor_instructions: string;
  tutor_voice: TutorVoice;
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
    rate_limited?: boolean;
    retry_after_seconds?: number;
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
  cover_image_url: string | null;
  cover_image_source: string | null;
  cover_image_source_url: string | null;
  cover_image_photographer: string | null;
  cover_image_photographer_url: string | null;
  mind_map: MindMap | null;
  created_at: string;
}

export interface ProjectCoverImageOption {
  id: string;
  image_url: string;
  thumbnail_url: string;
  photographer: string;
  photographer_url: string;
  source_url: string;
  source: string;
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

export interface ImageData {
  id: string;
  provider_id: string;
  query: string;
  caption: string;
  image_url: string;
  thumbnail_url: string;
  creator: string | null;
  creator_url: string | null;
  license: string | null;
  license_url: string | null;
  source_url: string;
  source: string;
}

export interface ChatImageEvent {
  event: "image";
  data: ImageData;
}

export type ChatStreamEvent = ChatStartEvent | ChatTokenEvent | ChatSourcesEvent | ChatEndEvent | ChatErrorEvent | ChatQuizEvent | ChatKeyIdeaEvent | ChatDiagramEvent | ChatImageEvent;

export interface KeyIdea {
  id: number;
  concept: string;
  summary: string;
  subject: string | null;
  sr_repetitions: number;
  sr_due_date: string;
  created_at: string;
}

export interface SessionSummary {
  covered: string[];
  struggled_with: string[];
  key_concepts: string[];
  next_review: string[];
}

export interface Flashcard {
  id: number;
  concept: string;
  summary: string;
  subject: string | null;
  sr_interval: number;
  sr_repetitions: number;
  sr_ease_factor: number;
  sr_due_date: string;
}

export interface FlashcardDueResponse {
  cards: Flashcard[];
  total_due: number;
}

export interface SearchSessionResult {
  conversation_id: number;
  subject: string | null;
  message_id: number;
  snippet: string;
  created_at: string;
}

export interface SearchNoteResult {
  id: number;
  concept: string;
  subject: string | null;
  snippet: string;
}

export interface SearchMaterialResult {
  material_id: number;
  filename: string;
  snippet: string;
  page_number: number | null;
}

export interface SearchResponse {
  sessions: SearchSessionResult[];
  notes: SearchNoteResult[];
  materials: SearchMaterialResult[];
}

export interface PracticeQuizItem {
  id: number;
  conversation_id: number;
  question: string;
  quiz_type: "multiple_choice" | "short_answer";
  options: string[] | null;
  created_at: string;
}

export interface WeakQuizResponse {
  conversation_id: number;
  quizzes: PracticeQuizItem[];
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
