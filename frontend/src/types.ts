export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: number;
  conversation_id: number;
  role: MessageRole;
  content: string;
  created_at: string;
}

export type FeedbackRating = "thumbs_up" | "thumbs_down";

export interface FeedbackRequest {
  message_id: number;
  conversation_id: number;
  rating: FeedbackRating;
  feedback_text?: string | null;
  correction?: string | null;
  latency_ms?: number | null;
  retrieved_chunk_ids?: number[] | null;
  tool_trace?: Record<string, unknown>[] | null;
}

export interface FeedbackResponse {
  id: number;
  user_id: number;
  message_id: number;
  conversation_id: number;
  rating: FeedbackRating;
  feedback_text: string | null;
  correction: string | null;
  llm_reason_category: string | null;
  llm_feedback_summary: string | null;
  llm_derived_preference: string | null;
  task_type: string | null;
  prompt_version: string | null;
  model_name: string | null;
  retrieved_chunk_ids: number[] | null;
  tool_trace: Record<string, unknown>[] | null;
  latency_ms: number | null;
  created_at: string;
}

export interface Conversation {
  id: number;
  user_id: number;
  subject: string | null;
  title: string | null;
  title_manually_edited: boolean;
  is_lecture: boolean;
  model: string | null;
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
  message?: string;
  retry_message_id?: number;
  edit_message_id?: number;
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

export interface WebSource {
  title: string;
  url: string;
  display_url?: string | null;
  snippet: string;
  summary?: string | null;
  published_at?: string | null;
  crawled_at?: string | null;
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

export interface ChatWebSourcesEvent {
  event: "web_sources";
  data: {
    query: string;
    sources: WebSource[];
  };
}

export interface ChatEndEvent {
  event: "end";
  data: {
    assistant_message_id: number;
    usage?: Record<string, unknown> | null;
    latency_ms?: number;
    retrieved_chunk_ids?: number[];
    tool_trace?: Record<string, unknown>[];
  };
}

export interface ChatConversationTitleEvent {
  event: "conversation_title";
  data: {
    title: string;
  };
}

export interface MessageTrace {
  latency_ms: number | null;
  retrieved_chunk_ids: number[] | null;
  tool_trace: Record<string, unknown>[] | null;
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
  id?: string;
  topic: string;
  description?: string | null;
  subtopics: string[];
  status?: LearningMapStatus;
  order?: number;
  parent_id?: string | null;
  prerequisite_ids?: string[];
  related_ids?: string[];
  linked_note_ids?: number[];
  linked_material_ids?: number[];
}

export interface MindMap {
  subject: string;
  nodes: MindMapNode[];
}

export type LearningMapStatus = "not_started" | "in_progress" | "needs_review" | "mastered";

export interface KnowledgeStateEntry {
  concept_id: string;
  concept: string;
  mastery: number;
  attempts: number;
  correct: number;
  last_observed_at: string | null;
  params: Record<string, number>;
}

export interface ProjectProfile {
  id: number;
  subject: string;
  level: string | null;
  goals: string | null;
  cover_image_url: string | null;
  cover_image_storage_key: string | null;
  cover_image_source: string | null;
  cover_image_source_url: string | null;
  cover_image_photographer: string | null;
  cover_image_photographer_url: string | null;
  mind_map: MindMap | null;
  learning_map_progress: Record<string, LearningMapStatus> | null;
  knowledge_state: Record<string, KnowledgeStateEntry> | null;
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

export interface Assignment {
  id: number;
  subject: string | null;
  title: string;
  description: string | null;
  due_at: string;
  source: "manual" | "canvas" | string;
  source_uid: string | null;
  source_url: string | null;
  completed: boolean;
  feed_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface AssignmentInput {
  title: string;
  due_at: string;
  subject?: string | null;
  description?: string | null;
  source_url?: string | null;
}

export interface AssignmentUpdate {
  title?: string;
  due_at?: string;
  subject?: string | null;
  description?: string | null;
  source_url?: string | null;
  completed?: boolean;
}

export interface CalendarFeed {
  id: number;
  name: string;
  url: string;
  subject: string | null;
  source: string;
  last_synced_at: string | null;
  created_at: string;
}

export interface CalendarFeedSyncResponse {
  feed: CalendarFeed;
  imported_count: number;
  total_events: number;
}


export interface QuizData {
  quiz_id: number;
  question: string;
  concept?: string | null;
  quiz_type: "multiple_choice" | "short_answer";
  options: string[] | null;
  message_id?: number | null;
}

export interface QuizRead extends QuizData {
  id: number;
  conversation_id: number;
  message_id: number | null;
  created_at: string;
}

export interface AttemptResult {
  is_correct: boolean;
  correct_answer: string;
  explanation: string;
  concept?: string | null;
  mastery?: number | null;
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
  source: string;
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

export interface ResourceData {
  id: number;
  kind: "video" | "article";
  source: "youtube" | "web";
  title: string;
  url: string;
  snippet: string | null;
  thumbnail_url: string | null;
  topic: string | null;
  reason?: string | null;
}

export interface Resource {
  id: number;
  subject: string;
  conversation_id: number | null;
  message_id: number | null;
  kind: "video" | "article";
  source: "youtube" | "web";
  title: string;
  url: string;
  snippet: string | null;
  thumbnail_url: string | null;
  topic: string | null;
  created_at: string;
}

export interface ChatResourceEvent {
  event: "resource";
  data: ResourceData;
}

export type ChatStreamEvent = ChatStartEvent | ChatTokenEvent | ChatSourcesEvent | ChatWebSourcesEvent | ChatEndEvent | ChatErrorEvent | ChatConversationTitleEvent | ChatQuizEvent | ChatKeyIdeaEvent | ChatDiagramEvent | ChatImageEvent | ChatResourceEvent;

export type KeyIdeaArtifactType = "text" | "diagram" | "image";

export type KeyIdeaArtifactData =
  | { kind: "text"; text: string; source_message_id?: number | null }
  | { kind: "diagram"; source: string; title?: string | null }
  | { kind: "image"; image_url: string; thumbnail_url?: string | null; caption?: string | null };

export interface KeyIdea {
  id: number;
  concept: string;
  summary: string;
  subject: string | null;
  sr_repetitions: number;
  sr_due_date: string;
  created_at: string;
  artifact_type?: KeyIdeaArtifactType | null;
  artifact_data?: KeyIdeaArtifactData | null;
}

export type LectureTimelineEntry =
  | { kind: "key_idea"; idea: KeyIdea }
  | { kind: "diagram"; diagram: DiagramData }
  | { kind: "image"; image: ImageData };

export interface LectureNoteSummary {
  id: number;
  conversation_id: number | null;
  subject: string | null;
  title: string;
  entry_count: number;
  created_at: string;
}

export interface LectureNote {
  id: number;
  conversation_id: number | null;
  subject: string | null;
  title: string;
  timeline: LectureTimelineEntry[];
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
  concept?: string | null;
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
  knowledge_mastery: KnowledgeStateEntry[];
}
