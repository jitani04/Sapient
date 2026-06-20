# Sapient, an Agentic Tutoring System

Sapient is a full-stack AI tutoring platform built around guided study sessions, retrieval over uploaded materials, formative quizzes, saved notes, spaced repetition, and project-based progress tracking.

The production domain is `sapient-ats.com`; **ATS** stands for **Agentic Tutoring System**.

The application is organized by **subject**. Each subject can have its own goals, level, cover image, learning map, uploaded materials, study sessions, flashcards, and weak-area review flow.
Watch the demo! https://drive.google.com/file/d/15KdNhLlXCjWUHv6Bmps-nQ0C-Xig2JpC/view

## Legal

- [License](LICENSE.md)
- [Privacy Policy](PRIVACY.md)
- [Terms and Conditions](TERMS.md)

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, FastAPI, SQLAlchemy 2.0 async |
| Runtime and packaging | Docker images deployed on Fly.io |
| Database | Neon PostgreSQL + `pgvector` |
| Object storage | S3-compatible storage (AWS S3 or Cloudflare R2) |
| Tutor LLM — Google | Gemini 2.5 Flash via `langchain-google-genai` |
| Tutor LLM — Anthropic | Claude Sonnet 4.6 via `langchain-anthropic` |
| Tutor LLM — OpenAI | GPT-4o via `langchain-openai` |
| Embeddings | Google Generative Language embeddings API |
| Reranker | LangSearch reranker API |
| Speech | OpenAI Whisper (`whisper-1`) + OpenAI TTS (`tts-1`) |
| Email | Resend |
| Scheduler | GitHub Actions |
| Migrations | Alembic |
| Frontend | React 19, TypeScript, Vite |
| Routing | React Router 7 |
| Client data layer | TanStack React Query |
| Diagram rendering | Mermaid |

## System Diagrams

### Figure 1. Production System Design

```mermaid
flowchart TB
    User["fa:fa-user Student"]
    Domain["fa:fa-globe sapient-ats.com"]
    Frontend["fa:fa-window-maximize React SPA"]
    Backend["fa:fa-server FastAPI API"]
    Docker["fa:fa-cube Docker images"]
    Fly["fa:fa-cloud Fly.io"]
    Neon[("fa:fa-database Neon Postgres")]
    ObjectStore[("fa:fa-archive S3 / R2")]
    Gemini["fa:fa-robot Gemini 2.5 Flash"]
    Claude["fa:fa-robot Claude Sonnet 4.6"]
    GPT["fa:fa-robot GPT-4o"]
    Embed["fa:fa-vector-square Embeddings"]
    Rerank["fa:fa-sort-amount-down LangSearch"]
    OpenAI["fa:fa-microphone OpenAI speech"]
    Search["fa:fa-search Web APIs"]
    Resend["fa:fa-envelope Resend"]
    Actions["fa:fa-clock GitHub Actions"]

    User --> Domain --> Frontend
    Frontend -->|"REST + SSE"| Backend
    Frontend -->|"signed upload"| ObjectStore

    subgraph Runtime["Fly.io runtime"]
        Frontend
        Backend
    end

    subgraph Build["Container delivery"]
        Docker --> Fly
    end

    Fly --> Frontend
    Fly --> Backend
    Backend --> Neon
    Backend --> ObjectStore
    Backend --> Gemini
    Backend --> Claude
    Backend --> GPT
    Backend --> Embed
    Backend --> Rerank
    Backend --> OpenAI
    Backend --> Search
    Backend --> Resend
    Actions -->|"review job"| Backend
```

### Figure 2. Tutor Turn and Agentic Planning Flow

```mermaid
sequenceDiagram
    actor Student
    participant UI as React chat UI
    participant API as FastAPI chat route
    participant Agent as AgentOrchestrator
    participant Retriever as Retriever
    participant LLM as Tutor LLM
    participant DB as PostgreSQL

    Student->>UI: Ask a question or request practice
    UI->>API: POST /chat/{conversation_id}
    API->>Agent: Build student and subject state
    Agent->>DB: Load weak topics, due cards, assignments, notes
    Agent-->>UI: SSE agent_step events
    Agent->>Retriever: Search uploaded material chunks
    Retriever->>DB: Vector similarity over material_chunks
    Retriever-->>Agent: Ranked and reranked citations
    Agent->>LLM: Prompt with tutor policy, state, history, citations
    LLM-->>API: Tokens and structured tool calls
    API-->>UI: SSE token, sources, quiz, key_idea, diagram, resource
    API->>DB: Persist messages, quizzes, notes, actions, traces
    API-->>UI: end event with assistant message id
```

### Figure 3. Material Upload, Ingestion, and RAG

```mermaid
flowchart TD
    File["fa:fa-file Upload file"]
    Presign["fa:fa-key Presign URL"]
    Bucket[("fa:fa-archive S3 / R2")]
    Material["fa:fa-database Material row"]
    Text["fa:fa-align-left Extract text"]
    Chunk["fa:fa-scissors Chunk text"]
    Embed["fa:fa-vector-square Embed chunks"]
    Store[("fa:fa-database pgvector chunks")]
    Question["fa:fa-question User query"]
    QueryVec["fa:fa-vector-square Embed query"]
    Vector["fa:fa-search Vector search"]
    Rerank["fa:fa-sort-amount-down Rerank (LangSearch)"]
    Prompt["fa:fa-robot Tutor prompt"]
    Sources["fa:fa-book Citations"]

    File --> Presign --> Bucket
    Presign --> Material --> Text --> Chunk --> Embed --> Store
    Question --> QueryVec --> Vector --> Rerank --> Prompt --> Sources
    Store --> Vector
```

### Figure 4. Learning Memory Loop

```mermaid
flowchart LR
    Session["Study session"]

    subgraph Artifacts["Session artifacts"]
        KeyIdeas["Key ideas / notes"]
        Quizzes["Inline quizzes"]
        Diagrams["Diagrams"]
        Resources["Resources\n(videos, articles)"]
        LectureNotes["Lecture notes"]
    end

    Flashcards["SM-2 flashcards"]
    Attempts["Quiz attempts"]
    BKT["BKT mastery update\n(per topic)"]
    KnowledgeState["Knowledge state\n(mastery · attempts · status)"]
    LearningMap["Learning map\n(node statuses)"]
    Assignments["Calendar\nassignments"]
    Planner["Study planner\n& weak-area detector"]
    Actions["Next-best-action\nrecommendations"]
    WeakQuiz["Weak-area\npractice quiz"]
    Digest["Review\ndigest email"]

    Session --> KeyIdeas
    Session --> Quizzes
    Session --> Diagrams
    Session --> Resources
    Session --> LectureNotes

    KeyIdeas -->|promote| Flashcards
    Quizzes --> Attempts
    Attempts --> BKT
    BKT --> KnowledgeState
    KnowledgeState --> LearningMap

    Flashcards --> Planner
    KnowledgeState --> Planner
    Assignments --> Planner

    Planner --> Actions
    Planner --> WeakQuiz
    Planner --> Digest

    Actions --> Session
    WeakQuiz --> Session
    Digest --> Session
```

### Figure 5. Core Data Model

```mermaid
erDiagram
    USER ||--o{ CONVERSATION : owns
    USER ||--o{ PROJECT_PROFILE : configures
    USER ||--o{ MATERIAL : uploads
    USER ||--o{ KEY_IDEA : saves
    USER ||--o{ ASSIGNMENT : tracks
    USER ||--o{ CALENDAR_FEED : subscribes
    USER ||--o{ LECTURE_NOTE : writes
    USER ||--o{ PENDING_AGENT_ACTION : approves
    USER ||--o{ REVIEW_DIGEST_LOG : receives
    USER ||--o{ PREFERENCE_MEMORY : accumulates
    CONVERSATION ||--o{ MESSAGE : contains
    CONVERSATION ||--o{ QUIZ : generates
    CONVERSATION ||--o{ KEY_IDEA : produces
    CONVERSATION ||--o{ RESOURCE : saves
    MATERIAL ||--o{ MATERIAL_CHUNK : embeds
    QUIZ ||--o{ QUIZ_ATTEMPT : records
    QUIZ ||--o{ MESSAGE_FEEDBACK : receives
    PROJECT_PROFILE ||--o{ KNOWLEDGE_STATE : estimates
    CALENDAR_FEED ||--o{ ASSIGNMENT : syncs
```

## Implemented Features

- Subject-based study projects with goals, level, cover image, and AI-generated learning map
- Per-topic mastery tracking using Bayesian Knowledge Tracing (BKT) with learning-map node status
- Streaming tutor chat over SSE with support for **Gemini 2.5 Flash**, **Claude Sonnet 4.6**, and **GPT-4o** — switchable per conversation
- Tutor customization per user: tutor name, tone, style, and custom instructions
- RAG over uploaded PDF, TXT, and Markdown materials
- Required second-stage reranking for retrieved material chunks (LangSearch)
- Direct browser uploads to S3-compatible storage using presigned URLs
- Secure material preview through presigned GET URLs
- Bounded agentic tutoring workflow with visible planning steps and approval-gated actions
- Inline quizzes (multiple-choice and short-answer) generated during tutoring sessions
- Weak-area practice quizzes generated from knowledge-state summaries and failed attempts
- Saved key ideas / notes during sessions, promotable to SM-2 spaced-repetition flashcards
- SM-2 flashcard review queue with smart session ordering
- Inline resource saving — YouTube videos and web articles recommended mid-chat and saved per subject
- iCal / Canvas calendar sync: assignment deadlines cross-referenced with weak topics in the study planner
- Lecture mode with continuous notebook-style tutoring and optional hands-free speech recognition
- Lecture notes — a separate long-form note layer outside chat
- Smart Review Digest emails via Resend, scheduling review tasks based on due flashcards and weak areas
- Pending agent actions with preview and user approval / rejection gate
- Next-best-action recommendations surfaced in chat and on the subject dashboard
- Thumbs up/down feedback on assistant messages with server-side category labeling
- Feedback analytics: rating, reason-category, prompt-version, and model breakdowns
- Optional preference memory derived from corrective feedback (pgvector-backed)
- On-demand session summaries cached on conversations
- Project-level progress tracking with mastery distribution
- Search across session messages, notes, and materials
- Voice input via Whisper STT
- Text-to-speech playback via OpenAI TTS
- Appearance customization: font family, font size, line spacing, letter spacing, content width
- OpenTelemetry traces, metrics, and structured logs with full trace correlation

## Project Structure

```text
app/
  main.py
  api/routes/
    auth.py
    chat.py
    conversations.py
    materials.py
    projects.py
    quiz.py
    artifacts.py
    flashcards.py
    assignments.py        # assignments + calendar feeds
    resources.py          # saved inline resources
    lecture_notes.py
    review_digests.py     # digest emails + pending agent actions
    feedback.py
    models.py             # GET /models
    search.py
    stt.py
    tts.py
  models/
    user.py
    conversation.py
    message.py
    message_feedback.py
    material.py
    material_chunk.py
    quiz.py
    key_idea.py
    project_profile.py
    assignment.py         # CalendarFeed + Assignment
    resource.py
    lecture_note.py
    agent_action.py       # PendingAgentAction + ReviewDigestLog
    preference_memory.py
  services/
    agent_orchestrator.py
    agent_tools.py
    calendar_service.py
    chat_service.py
    conversation_service.py
    email_service.py
    feedback_service.py
    knowledge_tracing_service.py   # BKT mastery updates
    llm_service.py                 # multi-provider LLM factory
    material_service.py
    onboarding_email_service.py
    prompt_builder.py
    quiz_grading_service.py
    reranker_service.py
    resource_service.py
    retriever.py
    review_digest_service.py
    s3_client.py
    stock_image_service.py
    study_planner.py
    tts_service.py
    web_image_service.py
    web_search_service.py
frontend/
  src/
    ui/
    api.ts
    types.ts
    router.tsx
    readingPrefs.ts       # font / spacing preferences
    ReadingPrefsContext.tsx
    useMicrophone.ts
    useSpeech.ts
    useLectureSession.ts
    useSessionTimer.ts
alembic/
tests/
evals/
```

## Core Study Flow

1. A user signs in with email/password or Google OAuth.
2. The user creates or opens a subject.
3. Materials are uploaded directly to object storage, then ingested into `material_chunks`.
4. A study session is created under that subject.
5. During chat, the backend retrieves relevant chunks, reranks them, and injects citations into the tutor prompt.
6. The agentic tutor layer checks learning state, retrieves sources, and emits visible planning events.
7. The tutor may stream quizzes, notes, diagrams, resources, images, citations, and next-best-action recommendations alongside answer text.
8. Quiz attempts update the BKT mastery estimate for the matched learning-map topic.
9. The user can review summaries, notes, flashcards, weak areas, assignments, resources, and search results.
10. The study planner cross-references due flashcards, BKT-weak topics, and upcoming assignment deadlines to generate review digest emails and in-chat next-best-action cards.

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- PostgreSQL with `pgvector`
- S3-compatible object storage bucket

### Backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Default local URLs:

- Backend: `http://127.0.0.1:8000`
- Frontend: `http://127.0.0.1:5173`

## Environment Variables

### Backend

```bash
APP_NAME=Sapient
ENVIRONMENT=development
LOG_LEVEL=INFO

DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/chatbot_db

LLM_API_KEY=your_google_ai_api_key
LLM_MODEL=gemini-2.5-flash
LLM_TIMEOUT_SECONDS=60
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENAI_API_KEY=your_openai_api_key
EMBEDDING_API_KEY=
EMBEDDING_MODEL=models/gemini-embedding-001
EMBEDDING_DIMENSIONS=768

SYSTEM_PROMPT=You are a helpful assistant.
KEEPALIVE_SECONDS=15

UPLOAD_MAX_BYTES=10485760
UPLOAD_URL_EXPIRES_SECONDS=300
PREVIEW_URL_EXPIRES_SECONDS=3600

S3_BUCKET=its-materials
S3_REGION=auto
S3_ENDPOINT_URL=https://<accountid>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

RAG_TOP_K=4
RAG_CANDIDATE_K=50
RAG_CHUNK_SIZE=1200
RAG_CHUNK_OVERLAP=200
RAG_RERANKER_ENABLED=true
RAG_RERANKER_TIMEOUT_SECONDS=8
LANGSEARCH_API_KEY=your_langsearch_api_key
LANGSEARCH_API_BASE_URL=https://api.langsearch.com
LANGSEARCH_RERANK_MODEL=langsearch-reranker-v1

JWT_SECRET=replace_with_a_long_random_secret
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080

OPENAI_TTS_API_KEY=your_openai_api_key
OPENAI_TTS_VOICE=nova

GOOGLE_CLIENT_ID=your_google_oauth_client_id.apps.googleusercontent.com
PEXELS_API_KEY=optional_for_cover_image_search

ENABLE_FEEDBACK_PREFERENCES=false
ENABLE_PREFERENCE_MEMORY=false

CORS_ALLOW_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173
```

### Frontend

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id.apps.googleusercontent.com
```

Notes:

- `OPENAI_TTS_API_KEY` is required for both `/tts` and `/stt`. `OPENAI_API_KEY` is used for GPT-4o chat; if unset the backend falls back to `OPENAI_TTS_API_KEY`.
- `ANTHROPIC_API_KEY` is required to use Claude Sonnet 4.6.
- `RAG_RERANKER_ENABLED=true` is the expected production setting; `LANGSEARCH_API_KEY` is required for second-stage retrieval reranking.
- If `VITE_API_BASE_URL` is omitted, the frontend falls back to the current hostname on port `8000`.
- Material uploads require a working S3-compatible bucket and credentials.
- `ENABLE_FEEDBACK_PREFERENCES=true` enables user-level preference summary updates after corrective thumbs-down feedback. `ENABLE_PREFERENCE_MEMORY=true` additionally enables pgvector-backed derived-preference memory.

## API Overview

### Health

- `GET /health`

### Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/google`
- `GET /auth/me`
- `POST /auth/onboarding`
- `POST /auth/tutor`

### Models

- `GET /models` — list supported LLMs (Gemini 2.5 Flash, Claude Sonnet 4.6, GPT-4o)

### Conversations and Chat

- `GET /conversations`
- `POST /conversations`
- `GET /conversations/{conversation_id}`
- `POST /chat/{conversation_id}` — SSE stream

### Session Artifacts

- `GET /conversations/{conversation_id}/key-ideas`
- `GET /key-ideas`
- `POST /key-ideas`
- `PATCH /key-ideas/{idea_id}`
- `POST /key-ideas/{idea_id}/promote` — promote to flashcard
- `DELETE /key-ideas/{idea_id}`
- `POST /conversations/{conversation_id}/summary`
- `GET /conversations/{conversation_id}/quizzes`

### Materials

- `GET /materials?subject=...`
- `POST /materials/presign`
- `POST /materials`
- `GET /materials/{material_id}/preview-url`
- `DELETE /materials/{material_id}`

### Quizzes

- `POST /quizzes/{quiz_id}/attempt`
- `POST /quizzes/{quiz_id}/skip`

### Flashcards

- `GET /flashcards/due?subject=...`
- `POST /flashcards/{card_id}/review`

### Projects

- `GET /projects`
- `GET /projects/{subject}`
- `POST /projects/{subject}/setup`
- `GET /projects/{subject}/progress`
- `GET /projects/{subject}/quizzes`
- `POST /projects/{subject}/weak-quiz`
- `POST /projects/{subject}/mindmap`
- `PUT /projects/{subject}/mindmap`
- `PATCH /projects/{subject}/learning-map/progress`
- `PATCH /projects/{subject}/goals`
- `GET /projects/{subject}/flashcards/smart`
- `DELETE /projects/{subject}`
- `GET /projects/cover-images/search?query=...`
- `POST /projects/cover-images/presign`

### Resources

- `GET /projects/{subject}/resources`
- `GET /conversations/{conversation_id}/resources`
- `DELETE /resources/{resource_id}`

### Assignments and Calendar

- `GET /assignments`
- `POST /assignments`
- `PATCH /assignments/{assignment_id}`
- `DELETE /assignments/{assignment_id}`
- `GET /calendar-feeds`
- `POST /calendar-feeds` — add iCal feed URL and sync
- `POST /calendar-feeds/{feed_id}/sync`
- `DELETE /calendar-feeds/{feed_id}`

### Lecture Notes

- `POST /lecture-notes`
- `GET /lecture-notes`
- `GET /lecture-notes/{note_id}`
- `DELETE /lecture-notes/{note_id}`

### Review Digests and Agent Actions

- `POST /review-digests/preview`
- `POST /review-digests/send`
- `POST /pending-agent-actions/{action_id}/reject`

### Feedback

- `POST /feedback`
- `GET /feedback/analytics`

### Search and Speech

- `GET /search?q=...`
- `POST /stt`
- `POST /tts`

## SSE Event Types

`POST /chat/{conversation_id}` streams `text/event-stream` responses with these event types:

| Event | Payload |
|-------|---------|
| `start` | `{ "conversation_id": number, "message_id": null }` |
| `token` | `{ "delta": "..." }` |
| `sources` | `{ "sources": [...] }` |
| `quiz` | `{ quiz_id, question, quiz_type, options }` |
| `key_idea` | `{ id, concept, summary }` |
| `web_sources` | `{ query, sources }` |
| `diagram` | `{ id, source, title }` |
| `image` | `{ id, image_url, thumbnail_url, caption, source_url }` |
| `resource` | `{ id, kind, source, title, url, snippet }` |
| `agent_step` | `{ message, tool?, plan? }` |
| `pending_action` | `{ id, action_type, explanation, status, payload, preview }` |
| `next_best_action` | `{ title, reason, actions }` |
| `conversation_title` | `{ title }` |
| `end` | `{ "assistant_message_id": number, "usage": {...} }` |
| `error` | `{ "error": "..." }` |

## Notes on Current Behavior

- Session summaries are generated on demand and then cached on the conversation.
- Material ingestion is asynchronous; material status is tracked as `processing`, `ready`, or `failed`.
- Search across sessions currently indexes **user messages**, not assistant responses.
- Session diagrams are streamed live; project mind maps are the persistent visual artifact stored in the database.
- BKT mastery updates are applied per quiz attempt and mapped to the nearest learning-map node by topic matching. Concepts with no map match fall back to a subject-level `concept:` key.
- The session timer and Pomodoro reminders are client-side features.
- Calendar feeds are synced on creation and on-demand; the review digest planner reads due assignments directly from the `assignments` table.

## Observability

The backend uses [OpenTelemetry](https://opentelemetry.io/) for traces and metrics. Logs are structured JSON with trace correlation. All three signals carry the same `trace_id`, so a single request can be followed across the API, the database, the LLM call, and any HTTP egress.

**Traces.**
- `FastAPIInstrumentor` produces a server span per request with `http.method`, `http.route`, `http.status_code`.
- `SQLAlchemyInstrumentor` and `AsyncPGInstrumentor` produce DB spans for every query.
- `HTTPXClientInstrumentor` produces client spans for outbound HTTP (Whisper, OpenAI TTS, Pexels).
- `LLMService` opens manual spans (`llm.stream`, `llm.stream_with_tools`) annotated with `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` (OTel GenAI semantic conventions).
- Spans export to any OTLP/HTTP collector via `OTEL_EXPORTER_OTLP_ENDPOINT` (Tempo, Jaeger, Honeycomb, Grafana Cloud, Datadog, etc.). Leave it unset to drop traces in development; set `OTEL_CONSOLE_TRACES=true` to print spans to stdout.

**Metrics.**
- `/metrics` serves a Prometheus scrape endpoint backed by an OTel `MeterProvider` with a `PrometheusMetricReader`. The same meter also exports to OTLP if an endpoint is configured.
- Built-in (from FastAPI instrumentation): `http.server.request.duration`, `http.server.active_requests`.
- Custom counters: `rate_limit_rejections_total{bucket}`, `llm_calls_total{model,status}`, `llm_tokens_total{model,kind}`.

**Logs.**
- One structured JSON line per request from `app.request` with `method`, `path`, `status`, `duration_ms`, `request_id`, `user_id`, `trace_id`, `span_id`.
- All other application logs inherit the same formatter and a `TraceContextLogFilter` that stamps the active span IDs onto every record.
- `JSON_LOGS=false` falls back to plain-text logs for local development.

**Request IDs.** Every request gets an `X-Request-ID` header (accepted from upstream or generated as a UUID) and that ID is included in every log line for the request.

## Rate Limiting

- In-memory token-bucket per user (or per IP for unauthenticated routes).
- Limits live alongside the rest of config in `.env` (`RATE_LIMIT_*_PER_MIN`); set `RATE_LIMIT_ENABLED=false` to disable.
- Buckets: `chat`, `stt`, `tts`, `summary` (weak-quiz, mindmap, summary), `upload` (presign + create), `auth` (login/register/google, per IP).
- Exceeded requests respond with `429 Too Many Requests` and a `Retry-After` header.

## Related Docs

- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [features.md](features.md)
- [TUTORING_SPECIALIZATION.md](TUTORING_SPECIALIZATION.md)
