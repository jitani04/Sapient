# Sapient — Agentic Tutoring System

Sapient is a full-stack AI tutoring platform built around guided study sessions, retrieval over uploaded materials, formative quizzes, saved notes, spaced repetition, and project-based progress tracking.

The production domain is `sapient-ats.com`; **ATS** stands for **Agentic Tutoring System**.

The application is organized by **subject**. Each subject can have its own goals, cover image, mind map, uploaded materials, study sessions, flashcards, and weak-area review flow.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, FastAPI, SQLAlchemy 2.0 async |
| Runtime and packaging | Docker images deployed on Fly.io |
| Database | Neon PostgreSQL + `pgvector` |
| Object storage | S3-compatible storage, such as AWS S3 or Cloudflare R2 |
| Tutor LLM | Google Gemini via `langchain-google-genai` |
| Embeddings | Google Generative Language embeddings API |
| Reranker | Required LangSearch reranker API |
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
    Gemini["fa:fa-robot Gemini"]
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
    Retriever-->>Agent: Ranked citations
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
    Rerank["fa:fa-sort-amount-down Required rerank"]
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
    Artifacts["Durable artifacts\nnotes, quizzes, diagrams, resources"]
    Attempts["Quiz attempts"]
    BKT["BKT mastery estimates"]
    Flashcards["SM-2 flashcards"]
    Progress["Project progress and weak areas"]
    Planner["Next-best-action planner"]
    Review["Review digest or practice session"]

    Session --> Artifacts
    Session --> Attempts
    Artifacts --> Flashcards
    Attempts --> BKT
    BKT --> Progress
    Flashcards --> Progress
    Progress --> Planner
    Planner --> Review
    Review --> Session
```

### Figure 5. Core Data Model

```mermaid
erDiagram
    USER ||--o{ CONVERSATION : owns
    USER ||--o{ PROJECT_PROFILE : configures
    USER ||--o{ MATERIAL : uploads
    USER ||--o{ KEY_IDEA : saves
    USER ||--o{ ASSIGNMENT : tracks
    CONVERSATION ||--o{ MESSAGE : contains
    CONVERSATION ||--o{ QUIZ : generates
    CONVERSATION ||--o{ KEY_IDEA : produces
    MATERIAL ||--o{ MATERIAL_CHUNK : embeds
    QUIZ ||--o{ QUIZ_ATTEMPT : records
    PROJECT_PROFILE ||--o{ KNOWLEDGE_STATE : estimates
    USER ||--o{ PENDING_AGENT_ACTION : approves
    USER ||--o{ REVIEW_DIGEST_LOG : receives
```

## Implemented Features

- Subject-based study projects with goals, level, cover image, and project mind map
- Streaming tutor chat over SSE
- Tutor customization per user: tutor name, tone, style, and custom instructions
- RAG over uploaded PDF, TXT, and Markdown materials
- Required second-stage reranking for retrieved material chunks
- Direct browser uploads to S3-compatible storage using presigned URLs
- Secure material preview through presigned GET URLs
- Bounded agentic tutoring workflow with visible planning steps and approval-gated actions
- Inline quizzes generated during tutoring sessions
- Weak-area practice quizzes generated from summaries and failed attempts
- Saved key ideas / notes during sessions
- SM-2 spaced-repetition flashcards built from saved key ideas
- Smart Review Digest emails through Resend for opt-in review reminders
- On-demand session summaries cached on conversations
- Project-level progress tracking
- Search across session messages, notes, and materials
- Voice input via Whisper STT
- Text-to-speech playback via OpenAI TTS
- Lecture mode with continuous notebook-style tutoring and optional hands-free speech recognition

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
    search.py
    stt.py
    tts.py
  models/
    user.py
    conversation.py
    message.py
    material.py
    material_chunk.py
    quiz.py
    key_idea.py
    project_profile.py
  services/
    chat_service.py
    material_service.py
    retriever.py
    embedding_service.py
    llm_service.py
    stock_image_service.py
    s3_client.py
frontend/
  src/
    ui/
    api.ts
    types.ts
    router.tsx
    useMicrophone.ts
    useSpeech.ts
    useLectureSession.ts
    useSessionTimer.ts
alembic/
tests/
```

## Core Study Flow

1. A user signs in with email/password or Google OAuth.
2. The user creates or opens a subject.
3. Materials are uploaded directly to object storage, then ingested into `material_chunks`.
4. A study session is created under that subject.
5. During chat, the backend retrieves relevant chunks and injects them into the tutor prompt.
6. The agentic tutor layer checks learning state, retrieves sources, and emits visible planning events.
7. The tutor may stream quizzes, notes, diagrams, resources, images, citations, and next-best-action recommendations alongside answer text.
8. The user can later review summaries, notes, flashcards, weak areas, assignments, and search results.

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

CORS_ALLOW_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173
```

### Frontend

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id.apps.googleusercontent.com
```

Notes:

- `OPENAI_TTS_API_KEY` is required for both `/tts` and `/stt`.
- `RAG_RERANKER_ENABLED=true` is the expected production setting; `LANGSEARCH_API_KEY` is required for second-stage retrieval reranking.
- If `VITE_API_BASE_URL` is omitted, the frontend falls back to the current hostname on port `8000`.
- Material uploads require a working S3-compatible bucket and credentials.

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

### Conversations and Chat

- `GET /conversations`
- `POST /conversations`
- `GET /conversations/{conversation_id}`
- `POST /chat/{conversation_id}` — SSE stream

### Feedback Personalization

- `POST /feedback` saves thumbs up/down feedback for an assistant message. Optional short free-text fields are `feedback_text` and, for thumbs down, `correction`; category labels are generated server-side by the LLM.
- `GET /feedback/analytics` returns rating, reason-category, prompt-version, task-type, model, and summary-pattern counts for the current user.
- `ENABLE_FEEDBACK_PREFERENCES=true` enables user-level preference summary updates after text/correction thumbs-down feedback. `ENABLE_PREFERENCE_MEMORY=true` additionally enables pgvector-backed derived-preference memory; raw complaints are not embedded.

### Session Artifacts

- `GET /conversations/{conversation_id}/key-ideas`
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

### Flashcards and Notes

- `GET /flashcards/due?subject=...`
- `POST /flashcards/{card_id}/review`
- `GET /key-ideas`
- `POST /key-ideas/{idea_id}/promote`
- `DELETE /key-ideas/{idea_id}`

### Projects

- `GET /projects`
- `GET /projects/{subject}`
- `POST /projects/{subject}/setup`
- `GET /projects/{subject}/progress`
- `POST /projects/{subject}/weak-quiz`
- `POST /projects/{subject}/mindmap`
- `GET /projects/cover-images/search?query=...`

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
- Material ingestion is asynchronous and material status is tracked as `processing`, `ready`, or `failed`.
- Search across sessions currently indexes **user messages**, not assistant responses.
- Session diagrams are streamed live; project mind maps are the persistent visual artifact stored in the database.
- The session timer and Pomodoro reminders are client-side features.

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

- [PROJECT_WRITEUP.md](PROJECT_WRITEUP.md)
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [features.md](features.md)
