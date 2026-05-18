# Sapient: A Retrieval-Augmented Intelligent Tutoring System

## Abstract

Sapient is a full-stack intelligent tutoring system designed to support active study rather than one-off question answering. The platform combines conversational tutoring, retrieval-augmented generation (RAG) over student-provided materials, inline formative assessment, spaced-repetition review, and multimodal interaction through diagrams and voice. The system is implemented with a FastAPI backend, a React frontend, PostgreSQL with `pgvector`, Google Gemini for tutoring and structured generation, and OpenAI speech services for transcription and audio playback. Its core architectural goal is to turn tutoring sessions into durable learning artifacts: conversations generate quizzes, key ideas, summaries, flashcards, and project-level progress signals that can be revisited over time. This write-up presents the motivation, design, implementation, and current limitations of the system as implemented in the repository.

**Keywords:** intelligent tutoring systems, retrieval-augmented generation, spaced repetition, educational AI, FastAPI, React, pgvector

## 1. Introduction

Many AI learning tools behave like generic chat assistants: they answer questions quickly, but they do not preserve learning structure, track misconceptions, or build a usable study history. Sapient was built to address that gap. The system treats tutoring as a stateful workflow centered on subjects, study sessions, and review artifacts rather than as a sequence of disconnected prompts.

The project is designed around three assumptions:

1. Students benefit more from guided learning than direct answer delivery.
2. Study sessions are more valuable when they produce reusable artifacts such as notes, quizzes, and review prompts.
3. Answers are stronger when grounded in the learner's own uploaded materials instead of relying only on the base model.

## 2. Problem Statement and Goals

The system aims to solve a practical study problem: how to provide personalized AI tutoring that remains grounded, organized, and useful across multiple sessions.

The main goals of the project are:

- provide subject-based conversational tutoring
- ground tutor responses in uploaded study materials
- generate formative checks during study, not only after it
- preserve important concepts as notes and flashcards
- identify weak areas and support targeted review
- support multiple interaction modes, including voice and lecture-style learning

## 3. System Overview

Sapient is organized around **subjects** and **study sessions**.

- A **subject** acts as a project container with a level, goals, materials, cover image, mind map, and progress indicators.
- A **study session** is a conversation between the student and the tutor.
- During a session, the tutor can produce quizzes, key ideas, summaries, citations, and diagrams.
- After a session, the student can revisit notes, flashcards, search results, summaries, and weak-area practice.

This structure gives the application a longer-lived educational memory than a standard chatbot interface.

## 4. Technical Architecture

### 4.1 Frontend

The frontend is implemented in React 19 with TypeScript and Vite. It is responsible for:

- authentication-aware routing
- project and session navigation
- streamed chat rendering via Server-Sent Events
- file upload orchestration
- quiz, note, and flashcard interfaces
- project dashboards and history views
- lecture mode, microphone input, and speech playback

TanStack React Query is used for client-server data synchronization, and React Router handles protected navigation across the app.

### 4.2 Backend

The backend is implemented in FastAPI with SQLAlchemy 2.0 async ORM and Alembic migrations. It provides:

- JWT-based authentication
- Google OAuth sign-in verification
- conversation and project APIs
- streaming tutoring responses
- material ingestion and retrieval
- search, summaries, quizzes, flashcards, and progress aggregation

The backend also controls the structured tutoring actions that let the model create persistent learning artifacts.

### 4.3 Database and Storage

The system uses PostgreSQL for relational data and `pgvector` for semantic retrieval over uploaded materials. File uploads are stored in S3-compatible object storage rather than directly in the database or application filesystem. The database stores metadata and object keys, while the object store holds the original files.

## 5. AI and Retrieval Design

### 5.1 Tutor generation

Tutor responses are generated with Google Gemini through the LangChain Google GenAI integration. Each chat request is composed from:

- a system prompt
- subject context when available
- user-specific tutor customization settings
- prior conversation history
- retrieved study-material context when available

This design allows the tutor to adapt both to the learner and to the current subject.

### 5.2 Retrieval-augmented generation

Uploaded PDF, TXT, and Markdown files are processed into semantic chunks. Each chunk is embedded and stored in the `material_chunks` table with its vector representation. At chat time, the system:

1. embeds the user's query
2. filters materials by ownership and optional subject
3. over-fetches candidate chunks by cosine similarity
4. optionally reranks those candidates with a cross-encoder reranker
5. limits overrepresentation from any one material
6. injects the best matches into the prompt as contextual sources

The retrieved chunks are also streamed back to the frontend as citation metadata so the interface can display sources to the student.

### 5.3 Structured tutoring actions

The tutoring layer exposes three internal structured actions to the model:

- `generate_quiz`
- `save_key_idea`
- `create_diagram`

These actions are important because they let the tutor produce data objects, not just text. Quizzes and key ideas are persisted to the database, while diagrams are streamed to the client as Excalidraw-compatible payloads for immediate rendering.

## 6. Implemented Features

### 6.1 Personalized tutoring

Users can customize tutor name, tone, style, and freeform instructions. These settings are appended to the tutor prompt so the teaching style can vary by learner preference without changing the rest of the system design.

### 6.2 Session-based chat with streaming output

The main tutor interface uses SSE streaming. The frontend receives incremental assistant tokens and structured events such as:

- `start`
- `token`
- `sources`
- `quiz`
- `key_idea`
- `diagram`
- `end`
- `error`

This gives the product a more interactive study workflow than a standard request-response chat.

### 6.3 Material upload, preview, and grounding

Material upload is implemented as a presigned direct-to-object-storage flow:

1. the frontend requests a presigned URL
2. the browser uploads the file directly
3. the backend records the material and starts ingestion
4. the material is marked `processing`, `ready`, or `failed`

Ready materials can be previewed through a signed GET URL and used for retrieval grounding during chat.

### 6.4 Inline quizzes and weak-area practice

The tutor can generate inline quizzes during a session. Student answers are stored and evaluated server-side. Separately, the project layer can generate targeted weak-area quizzes using prior summaries, failed quiz attempts, and concept mastery signals, producing a dedicated practice conversation and quiz set.

Quiz attempts also feed a Bayesian Knowledge Tracing (BKT) model. Each observed answer updates a per-concept mastery probability using the standard prior, learn, guess, and slip parameters. The resulting mastery estimate is stored on the subject profile and used by the Learning Map and tutor prompt to distinguish topics that are mastered, in progress, or likely to need review.

### 6.5 Key ideas and notes

Important concepts can be saved as key ideas during a tutoring session. These notes appear in the session artifact panel and on the dedicated notes page, where they can be filtered, searched, deleted, or promoted for immediate review.

### 6.6 Spaced-repetition flashcards

Key ideas double as flashcards using SM-2 scheduling fields. The system tracks repetition count, interval, ease factor, and next due date, allowing the notes generated during tutoring to become part of a long-term revision workflow.

### 6.7 Session summaries and project progress

Session summaries are generated on demand and cached on the conversation. These summaries capture covered topics, struggled concepts, key concepts, and next-review suggestions. Project progress is then computed from the aggregate of sessions, summaries, and quiz attempts.

### 6.8 Mind maps and diagrams

The system supports two different visual representations:

- **session diagrams**, which are streamed during chat as Excalidraw-style diagrams and rendered immediately in the UI
- **session images**, which are streamed during chat as attributed Wikimedia Commons image artifacts when a real photo/reference image is more useful than a generated diagram
- **project mind maps**, which are generated through a dedicated endpoint and stored on the `project_profiles` table as JSON

This distinction matters because diagrams and images are ephemeral session artifacts, while mind maps are subject-level persistent planning artifacts. Diagrams are best for abstract structure, flows, and relationships; real images are best for concrete visual references such as organisms, places, lab setups, physical objects, or historical artifacts.

### 6.9 Voice and lecture mode

The system supports:

- speech-to-text with OpenAI Whisper
- text-to-speech with OpenAI `tts-1-hd`
- a user-selectable tutor voice stored on the user profile and applied to all generated speech
- a lecture overlay that turns a tutoring session into a guided notebook-style experience
- hands-free voice interruption, with browser echo cancellation plus application-level transcript echo filtering
- manual stop control for ending the current spoken response without leaving the lecture
- source rendering for retrieved uploaded-material chunks, including snippets and links back to the source material
- real image artifacts in chat and lecture mode when the tutor needs a photo/reference visual
- lecture pace controls, playback-speed controls, and quick actions for "check me" and "show visually"

Lecture mode buffers streamed tutor text into shorter audio chunks and plays them sequentially while collecting notes, diagrams, real images, and source cards in a live notebook view. The voice layer is intentionally interruptible: when the learner starts speaking, the current stream/audio queue is cancelled, the utterance is transcribed, and a new tutor turn is started. This makes lecture mode behave like a real-time tutoring conversation rather than a passive audio player.

### 6.10 Search and review

The search interface queries across:

- prior session messages
- saved notes
- uploaded material chunks

This gives the learner a way to recover earlier ideas and study context without manually opening each session.

## 7. Data Model

The major persisted entities are:

- `users`: authentication, onboarding, and tutor preferences
- `conversations`: subject-scoped study sessions
- `messages`: user and assistant turns within a session
- `materials`: uploaded files and ingestion status
- `material_chunks`: extracted chunk text plus embeddings
- `quizzes`: tutor-generated quiz questions
- `quiz_attempts`: student responses and correctness
- `key_ideas`: saved notes and flashcard scheduling data
- `project_profiles`: subject-level settings, cover image metadata, and mind maps

This schema supports both short-term tutoring interactions and long-term review behavior.

## 8. Deployment and Operational Design

The deployment shape is a Dockerized FastAPI backend and a static React build, both hosted on Fly.io, paired with managed Postgres on Neon and S3-compatible object storage on Cloudflare R2. External AI services (Gemini, OpenAI speech APIs, Google OAuth, Pexels) are accessed over the public internet via API keys held as platform secrets. This section records the alternatives that were considered for each component and the reasoning that produced the current design.

### 8.1 Object storage: Cloudflare R2 over AWS S3

Earlier prototypes wrote uploaded materials to the application server's local filesystem. That approach broke as soon as the server became containerized: ephemeral disks lose state on restart, and horizontal scaling is impossible because each instance can only see its own files. The system was therefore migrated to S3-compatible object storage with two providers under consideration:

- **AWS S3.** The default industry choice and the most mature object storage product, but its egress pricing of $0.09 per gigabyte makes it expensive for an application that re-reads uploaded files for retrieval, preview, and download.
- **Cloudflare R2.** S3-compatible at the API level, with comparable storage pricing and **zero egress fees**. The free tier (10 GB storage, 1 million Class A operations, 10 million Class B operations per month) is permanent rather than time-limited.

R2 was chosen because the application's workload is read-heavy on uploaded materials: every chat turn that triggers retrieval reads chunk data, and material previews and downloads pull entire files. The egress savings dominate the comparison for any non-trivial usage. The trade-off is a slightly less mature ecosystem (some advanced S3 features like Object Lambda or Glacier-class lifecycle rules are unavailable on R2), none of which are required for the current feature set.

### 8.2 Upload flow: presigned PUT URLs

A second decision concerned how the browser delivers files to object storage. Two patterns were considered:

- **Proxy-through-API.** The browser uploads to the FastAPI server, which then writes to object storage. This keeps the existing endpoint shape but doubles the bandwidth, holds large files in backend memory, and ties upload throughput to backend container resources.
- **Direct browser-to-storage uploads via presigned URLs.** The frontend requests a short-lived signed URL from the backend, uploads the file directly to the bucket, then notifies the backend to record the resulting object key.

The presigned approach was adopted because it keeps the application servers stateless with respect to file payloads, removes a memory and bandwidth bottleneck on the backend, and follows the standard production pattern for browser-uploaded user content. The cost is a more involved client flow (presign → PUT → confirm) and a CORS configuration on the bucket. Material preview is implemented symmetrically with presigned GET URLs and a forced inline `Content-Disposition`, so previews render in-browser without proxying bytes through the backend.

### 8.3 Database: Neon over Supabase, Railway, RDS, and self-hosted Postgres

The application requires PostgreSQL with the `pgvector` extension. The shortlist of providers that meet that requirement on a sustainable free or low-cost tier was:

- **Neon.** Serverless Postgres with a permanent free tier (0.5 GB storage), built-in `pgvector`, automatic scale-to-zero, and database branching for development. Idle databases cold-start in roughly one second on the next request.
- **Supabase.** Generous free tier (500 MB) with `pgvector` available, but free projects are paused after one week of inactivity and must be manually resumed. Bundles authentication, realtime, and storage products that the system already implements internally and would not use.
- **Railway.** Solid developer experience, but the free trial is credit-based rather than permanent. Steady-state cost is roughly 5 USD per month.
- **AWS RDS.** Mature and feature-rich, but starts at roughly 15 USD per month, requires Postgres 15.2+ on specific instance types to enable `pgvector`, and introduces operational complexity disproportionate to current needs.
- **Self-hosted Postgres on a Fly volume.** Free in raw compute terms but introduces ownership of backups, upgrades, and pgvector installation. For this project the operational overhead outweighs the cost savings.

Neon was chosen because the application has irregular usage patterns: it should cost nothing during long idle periods and should not require manual unpausing after a week of inactivity. The cold-start penalty is imperceptible relative to LLM and embedding API latency, and the database branching feature gives a low-cost path to test migrations against realistic data.

### 8.4 Compute platform: Fly.io for backend and frontend

For application hosting, four platforms were realistic for a single-developer free-tier project:

- **Fly.io.** Container-native, supports long-lived SSE connections, and runs both backend and static frontend on the same platform with multiple regions including `lax`. Fly removed its permanent free tier in October 2024; new accounts now receive trial credit, after which usage is billed per-second. Because the deployment configures `auto_stop_machines = "stop"`, idle machines hibernate and are not billed, so steady-state cost for a low-traffic application is typically a small fraction of full uptime pricing.
- **Google Cloud Run.** Container-native with a permanent free tier (two million requests and 360,000 GB-seconds of memory per month). Scales to zero with cold starts of one to three seconds. SSE works within Cloud Run's request timeout limits. A viable always-free alternative if predictable-zero billing matters more than developer experience.
- **Render.** Simplest UX, but the free web service spins down after 15 minutes of idle time, and the free Postgres tier expires after 90 days, forcing a separate Neon dependency anyway.
- **Vercel + Fly.** Excellent frontend developer experience and edge CDN distribution, but the frontend and backend live on different domains, which complicates CORS and OAuth configuration.
- **Self-hosted VPS.** Cheapest at scale, but requires managing TLS, OS updates, and deploys manually. Not appropriate as the first deployment.

Fly.io was chosen because it consolidates backend and frontend hosting on one platform, supports the long-lived SSE connections required by the chat endpoint without proxy buffering surprises, and can be operated entirely from the command line with reproducible Dockerfiles. With `auto_stop_machines` enabled, the expected steady-state cost for this workload is roughly one to three USD per month, well within the cost envelope of a single-developer project. Cloud Run remains a reasonable migration target if the steady-state cost ever becomes a concern, since the application's container is portable across both platforms with no code changes. The deployment shape is two Fly applications: the backend serves the FastAPI app on internal port 8000, and the frontend serves the Vite-built static bundle through `nginx` on port 80. The frontend calls the backend over the public internet, so cross-origin requests are governed by the `CORS_ALLOW_ORIGINS` setting on the backend rather than by an internal proxy.

### 8.5 Product name and public URL

The product is named **Sapient**, drawn from the Latin *sapere*, meaning *to know* or *to be wise*. The term refers in cognitive science to the capacity for conscious, deliberate reasoning that distinguishes thinking minds from mere intelligence, which directly aligns with the system's tutoring goal of building durable, reflective knowledge rather than surfacing one-shot answers.

The public URL is the Fly-provided subdomain, with the frontend at `https://sapient.fly.dev` and the backend at `https://sapient-api.fly.dev`. A custom domain was considered and deferred. The relevant trade-offs were:

- **Custom domain (e.g., `sapient.com`).** More polished for a public-facing product, future-proofs branding regardless of host changes, and supports a separation between marketing site at the apex and application at a subdomain. Costs roughly ten USD per year and requires DNS configuration alongside TLS certificate provisioning on Fly.
- **Fly-provided subdomain.** Costs nothing, requires no DNS work, and inherits Fly's TLS automatically. The application's branding still appears in the URL because the Fly app names contain the product name. Limitations are a less polished URL and dependence on Fly's continued operation of the `fly.dev` namespace.

The Fly-provided subdomain was chosen because the application is currently a single-developer project where the additional polish of a custom domain is not yet necessary. The deployment is structured so that adding a custom domain later is a cosmetic change rather than a structural one: it requires running `fly certs add` on each app, adding DNS records, updating the `CORS_ALLOW_ORIGINS` setting on the backend, the `VITE_API_BASE_URL` build argument on the frontend, the R2 bucket CORS policy, and the Google OAuth authorized origins. None of those changes touch application code.

### 8.6 Regional placement

The end-to-end latency profile of a tutoring request is dominated by two hops: the user-to-frontend hop, which is bounded by the user's connectivity, and the backend-to-database hop, which occurs on every request and often involves multiple round-trips per query. To minimize the second hop, the compute and database regions are aligned on the United States West Coast.

The chosen regions are Fly.io `lax` (Los Angeles) for both backend and frontend, Cloudflare R2 in the WNAM (Western North America) location, and Neon in `us-west-2` (Oregon). Neon does not offer a Los Angeles region, so Oregon is the closest available choice and yields a backend-to-database round-trip in the low tens of milliseconds. This places all three persistent components within the same broad geography, keeping per-request overhead low for a developer based in Los Angeles while preserving acceptable latency for users elsewhere on the West Coast and in the western United States.

## 9. Strengths of the Current Implementation

The project has several architectural strengths:

- it separates conversational tutoring from project-level learning memory
- it treats generated artifacts as first-class data
- it grounds answers in user-owned materials
- it supports multiple study modes without changing the core backend
- it uses a production-friendly object storage flow instead of proxying uploads through the API server

Most importantly, the system is designed around learning continuity. Sessions feed notes, quizzes, progress, and review systems rather than disappearing after the answer is delivered.

## 10. Limitations and Future Work

The current implementation is strong as a prototype and early product foundation, but several areas remain open for expansion:

- export flows for summaries, notes, or session transcripts
- stronger mobile optimization
- richer analytics and retention metrics
- deeper material parsing and citation fidelity
- persistence for session diagrams if long-term diagram history becomes important
- stronger evaluation workflows for tutoring quality and retrieval relevance

## 10.1 Observability and Rate Limiting

Two operational concerns were addressed together: (1) understanding the behavior of the running service in production, and (2) protecting the LLM-bound and authentication endpoints from accidental or abusive traffic.

### Observability

#### Why server-side observability is required

A reasonable first question for a single-developer web application is whether browser-side tooling — the Chrome / Firefox developer tools, the network panel, the JavaScript console — is sufficient to understand application behavior. For Sapient it is not, and the reasons generalize to most LLM-bound applications.

Browser developer tools see only what the browser itself observes: paint times, the duration of a network request as measured at the client, console messages, and bundle sizes. They are bounded to a single user's session, last only as long as the panel is open, and have no record of what the server did internally. For a tutoring application where a single chat request can fan out to a database, an embedding API, a vector search, an LLM stream, and a database write, the browser sees only the outer envelope: that the request took, for example, twelve seconds and returned 200. It cannot answer the operationally important question of *why* it took twelve seconds.

Server-side instrumentation answers that question directly. With distributed tracing, the same twelve-second request decomposes into a tree of spans: thirty milliseconds loading the conversation from PostgreSQL, eighty milliseconds loading the user, two hundred and forty milliseconds for the embedding call, one hundred and ten milliseconds for the vector search, eleven and a half seconds inside the LLM stream span (annotated with prompt token count, completion token count, model identifier, and whether tool calls were emitted), and a final eighty milliseconds writing the assistant response back to the database. The diagnosis follows immediately from the trace: the latency is dominated by the LLM call, the prompt is unusually large because retrieval is over-fetching, and the correct model was used. None of this is recoverable from a browser timeline.

There are also categories of behavior that browser tooling cannot observe at all. It cannot aggregate across users to distinguish a personal anomaly from a systemic regression; it cannot aggregate over time to support post-hoc analysis of yesterday's complaint; it cannot run in production where the data and load actually exist; it has no notion of alerting; it does not survive the user closing the tab; it sees a single HTTP call rather than the distributed work that call triggers; and it captures nothing about background processes such as the asynchronous material-ingestion path. These are the tasks for which an instrumented backend exists, and each of them is in scope for a tutoring application that depends on a third-party LLM whose latency, cost, and failure modes are part of the user experience. Browser developer tools and a server-side observability stack are therefore complementary rather than alternatives: developer tools remain the right instrument for client-side concerns such as paint, hydration, and bundle size, while OpenTelemetry covers the entire backend call graph that DevTools cannot see.

#### Implementation

The system was instrumented for full three-signal observability — distributed traces, metrics, and structured logs that share a common correlation identifier — using OpenTelemetry as the data plane. OpenTelemetry was chosen because it is the de facto open standard for instrumentation in modern back-end services and because it decouples the instrumented application from the chosen telemetry backend: the same SDK can export to Jaeger, Tempo, Honeycomb, Grafana Cloud, Datadog, or any other OTLP-compatible system without code changes.

**Traces.** An ASGI-level middleware (`ObservabilityMiddleware`) assigns every HTTP request a `X-Request-ID` (accepted from upstream or generated as a UUID), binds the ID into a `ContextVar`, and emits a structured JSON log line at request completion. Distributed tracing itself is provided by four OpenTelemetry instrumentations: `FastAPIInstrumentor` produces an `http.server` span per request annotated with the matched route template, `SQLAlchemyInstrumentor` and `AsyncPGInstrumentor` produce DB spans for every query, and `HTTPXClientInstrumentor` produces client spans for outbound calls (the Whisper, OpenAI TTS, and Pexels APIs). Manual spans are added inside `LLMService.stream_response` and `LLMService.stream_with_tools` and annotated with the OpenTelemetry GenAI semantic conventions (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`), so per-call latency, token consumption, and tool-call rate are queryable as first-class span attributes. The middleware is intentionally implemented as a pure ASGI wrapper rather than a Starlette `BaseHTTPMiddleware` because the chat endpoint streams long-lived Server-Sent Events and `BaseHTTPMiddleware` is known to buffer streaming bodies in certain configurations.

**Metrics.** Metrics flow through the same OpenTelemetry `MeterProvider`, which is configured with two readers: a `PrometheusMetricReader` that backs the `/metrics` scrape endpoint, and a `PeriodicExportingMetricReader` that pushes the same data over OTLP/HTTP to any configured collector. The FastAPI instrumentor automatically emits `http.server.request.duration` and `http.server.active_requests`. Three application-specific counters — `rate_limit_rejections_total{bucket}`, `llm_calls_total{model,status}`, and `llm_tokens_total{model,kind}` — record the policy events that matter for capacity planning: which buckets are pressured, which model is being called, whether calls are succeeding, and how prompt and completion tokens are accumulating per model.

**Logs.** Logs are emitted as JSON to stdout. A `TraceContextLogFilter` reads the active OpenTelemetry span at log time and stamps `trace_id` and `span_id` onto every `LogRecord`, so each log line carries the correlation identifiers needed to navigate from a log entry to the corresponding span and back. The same fields (`trace_id`, `span_id`, `request_id`, `user_id`) appear consistently across application logs, the per-request log line emitted by the middleware, and any exception traces.

*Alternatives considered.* A first iteration used `prometheus-client` directly with no tracing, on the reasoning that the application was a single-process deployment and that Prometheus alone would be sufficient. That position was revisited and rejected: an LLM-tutoring application has a fan-out call graph (request → DB → retriever → embedding API → LLM stream → DB writes) where the most useful operational question is "where did this slow request spend its time," and that question is only answerable with traces. A hosted APM (Datadog, Sentry Performance, New Relic) was rejected on cost and lock-in grounds at the current scale; using OpenTelemetry preserves the option to point at any of those systems later by changing one environment variable. A push-only setup using StatsD/DogStatsD was rejected because it requires running an agent process for any backend to be useful, and because the OpenTelemetry pull-and-push hybrid means the application can be scraped locally during development and exported to a collector in production with a single configuration change. Computing latency histograms from logs alone (e.g., Loki + LogQL `quantile_over_time`) was rejected because it is lossy at the percentiles that matter for an LLM application and significantly more expensive than first-class metric histograms. The instrumentation-package footprint (api, sdk, OTLP HTTP exporter, Prometheus reader, four instrumentation libraries) was accepted as a deliberate cost of the standardization benefit.

### Rate limiting

#### Why rate limiting is required

An LLM-bound application has a property that traditional web applications do not: the marginal cost of a single request is non-trivial and is denominated in tokens billed by an external provider. A modest tutoring conversation may consume several thousand prompt tokens and several hundred completion tokens per turn, and the cost is incurred whether the request originates from a legitimate user, a buggy client that retries on every keystroke, or an automated script. Without an explicit policy, a single misbehaving caller can exhaust both the application's monthly LLM budget and the throughput of the upstream API, degrading service for every other user.

Rate limiting is therefore a substantive operational requirement rather than a defensive afterthought. It serves three distinct goals in this system. The first is cost containment: per-user limits on the chat, weak-quiz, summary, and mind-map endpoints place a hard ceiling on how much LLM spend any individual account can drive in a given minute, which makes per-user cost predictable and bounds the blast radius of a runaway client. The second is upstream protection: the Whisper, OpenAI text-to-speech, and Google embedding APIs each enforce their own quotas, and submitting more requests than those quotas allow produces cascading 429s and degraded latency for all users; bounding outbound rate locally avoids that failure mode. The third is authentication abuse: the `/auth/login`, `/auth/register`, and `/auth/google` endpoints are reachable without credentials and are therefore the natural target for credential stuffing and account enumeration. Per-IP throttling makes online password attacks materially more expensive without requiring CAPTCHA or other interactive friction.

These goals motivate three concrete design choices that the implementation reflects. Limits are *per principal* rather than per route — a single user calling chat repeatedly should be throttled even when the global request rate is low. Limits are *segmented by bucket* — a user uploading a large set of materials should not deplete the budget for their chat session, because uploads and chat answer different operational questions. And limits are *observable* — every rejection increments a counter that flows into the same Grafana stack as the rest of the metrics, so that limit pressure is visible alongside latency and error rate rather than being silently absorbed.

#### Implementation

An in-memory token-bucket limiter is exposed as two FastAPI dependency factories: `rate_limit_user` (keyed by JWT subject, falling back to client IP if no valid token is presented) and `rate_limit_ip` (used by the unauthenticated `/auth/login`, `/auth/register`, and `/auth/google` endpoints). Buckets are named (`chat`, `stt`, `tts`, `summary`, `upload`, `auth`), per-minute capacities are configurable through environment variables, and rejected requests return `429 Too Many Requests` with a computed `Retry-After` header and increment the `rate_limit_rejections_total{bucket}` counter so that limit pressure is observable in Grafana alongside everything else.

*Alternatives considered.* A Redis-backed limiter (`slowapi`, `fastapi-limiter`) would survive multi-process deployments and is the correct choice once the backend horizontally scales, but the application currently runs as a single Fly.io process and adding Redis purely for rate limiting would introduce a new piece of infrastructure for no current benefit. A reverse-proxy-level limit (Fly.io edge or Cloudflare) was rejected because it cannot key on the authenticated user ID and would conflate users behind shared NATs. Per-route hardcoded limits inside each handler were rejected as harder to audit than a single configuration surface; the dependency-factory approach keeps the limit declarations adjacent to the route definitions while centralizing the policy. The decision to keep the limiter in-memory is therefore explicitly time-bound: it is appropriate for the single-process deployment and should be replaced with a Redis-backed implementation when a second worker is added.

## 10.2 Evaluation

The retrieval-augmented generation pipeline is evaluated against `rag-mini-bioasq`, a 4.7-thousand-passage biomedical benchmark from `rag-datasets`. The dataset is chosen for two properties: it provides ground-truth `relevant_passage_ids` for each question, which makes deterministic retrieval metrics possible without an LLM judge, and its passage size and language register approximate the textbook excerpts and lecture notes that students upload as study material in production use.

The evaluation suite consists of three complementary components, all implemented in `evals/`. The first is a *retrieval-only* evaluation that computes `recall@k`, `precision@k`, and mean reciprocal rank against the dataset's ground-truth relevance labels. This evaluation runs through the production retriever, which means the same chunking strategy, the same embedding model (`text-embedding-004`), the same pgvector schema, and the same per-material deduplication logic as the live application. It is deterministic, requires only a single query embedding per question, and does not depend on an LLM judge; it is therefore the appropriate metric for detecting retrieval regressions and is run after every change to the embedding model, chunk size, or retrieval logic.

The second component is an *end-to-end* RAG evaluation built on Ragas. It exercises the full production stack — retrieve, build the prompt with the same `prompt_builder` used by the chat service, generate an answer through `LLMService`, then score the resulting `(question, contexts, answer, ground_truth)` tuple on `faithfulness`, `answer_relevancy`, `context_precision`, `context_recall`, and `factual_correctness` using an OpenAI judge. The Ragas evaluation captures behaviors that the retrieval-only evaluation cannot: whether the model hallucinates beyond the retrieved context, whether the answer is on-topic, whether the retrieved chunks are themselves relevant rather than merely numerous, and whether the final answer matches the reference answer. The cost of that coverage is variance — LLM-judged metrics carry the noise inherent to LLM-as-judge methodology and are interpreted as trends across a sample rather than as point estimates.

The third component is a *pedagogical helpfulness* evaluation, which is the artifact that distinguishes this system from a generic RAG application. Retrieval quality and answer faithfulness are necessary but not sufficient conditions for an effective tutor: a response can be perfectly grounded in the retrieved context and still be pedagogically poor — for instance by dumping the textbook excerpt verbatim, ignoring a misconception in the student's question, or refusing to scaffold a difficult concept. The pedagogical evaluation scores each response on six explicit dimensions — scaffolding, active engagement, misconception handling, calibrated depth, connections to prior knowledge, and source grounding — using an OpenAI judge against `ScaleAI/TutorBench`, a public tutoring benchmark with student prompts, follow-up questions, subject labels, and sample-specific rubrics. The harness samples text-only TutorBench rows by default, injects each row's rubric into the judge prompt, and still reports the same six shared dimensions so the results remain comparable across subjects and use cases. This third evaluation is independent of the RAG benchmark — it does not require any material to be ingested into pgvector — and is therefore the appropriate signal for changes that affect the system prompt, the tutor customization, or the model itself rather than retrieval.

A separate ingestion script (`evals/ingest_dataset.py`) populates pgvector with the benchmark corpus plus configurable distractor passages drawn from the rest of the BioASQ corpus. The default run uses one hundred QA rows and five hundred distractors. The distractors make the retrieval task non-trivial: a retriever that simply returned every passage in the database would otherwise hit perfect recall vacuously. The eval data is owned by a dedicated `ragas-eval@local` user with a dedicated subject, so it is segregated from any real user data sharing the same database.

The harness is intentionally LLM-budget-aware. The retrieval evaluation consumes only one embedding call per question. The Ragas and TutorBench evaluations run serially with configurable inter-call pacing (twenty seconds by default) and support checkpoint resume, so a partial run can be continued without re-paying for answers already generated. All evaluations write per-row CSV outputs alongside their aggregated stdout summaries, so results can be diffed across commits as a regression signal. Run artifacts (corpus map, checkpoints, CSV outputs) are deliberately gitignored: the source of truth is the dataset and the code, not the regenerable output.

*Limitations.* The biomedical benchmark exercises retrieval and faithfulness but does not measure educational quality; TutorBench closes that gap for response-level teaching behaviors but introduces its own caveats. Some TutorBench rows are multimodal, while the current eval harness is text-first, so image-backed rows are skipped by default unless explicitly enabled. The judge is from a different model family than the Gemini tutor, which reduces self-judging bias but does not eliminate LLM-as-judge variance. Expanding the judge ensemble and adding a multimodal path for image-backed TutorBench rows are natural next steps for a follow-up project.

## 11. Conclusion

Sapient demonstrates a practical architecture for an educational AI system that goes beyond generic chat. By combining conversational tutoring, retrieval grounding, structured artifact generation, spaced repetition, and voice interaction, the platform creates a more complete study environment. Its main contribution is not any single feature in isolation, but the way those features are connected: tutoring sessions generate reusable learning artifacts, those artifacts drive review and progress, and the system gradually builds a personalized study workspace for the learner over time.

## Decision: Landing page → interactive WebGL shader wallpaper (2026-05-11)

The marketing landing page was redesigned around an interactive shader wallpaper that fills the hero, warps toward the cursor, and emits expanding pulse rings on click. The hero presents the product as a "futuristic learning OS desktop" — a frosted glass panel sits over the wallpaper carrying the app name, tagline, three stat chips, and primary CTAs, framed by monospace corner badges (clock, system tag, interaction hints).

*Rationale.* The previous hero used a 2D canvas aurora that was passive and decorative. A genuinely interactive surface (mouse-warp + click ripples + iridescent palette) signals the product's adaptive/responsive nature on first paint and rewards fidgeting, which raises dwell time before sign-up.

*Alternatives considered.*
- *Three.js / react-three-fiber:* would simplify scene composition but adds ~150 KB gzipped for a single fullscreen fragment shader. Rejected — the effect is one quad with one fragment program, so raw WebGL is lighter and has no dependency cost.
- *CSS-only animated gradients (conic / mesh):* zero deps but cannot react meaningfully to mouse position or click events without compounding JS layers, and cannot produce real ripple propagation. Rejected as insufficiently interactive.
- *Lottie / video loop:* canned, not reactive. Rejected.
- *Particle system on Canvas2D:* feasible but visually noisier and CPU-bound at full viewport; the shader runs on the GPU and stays smooth at 60 fps even at 2× DPR.

*Implementation notes.* Built as `ShaderWallpaper.tsx` — a single fullscreen quad with a domain-warped fbm field, an eased mouse-follow that pulls the field toward the cursor with an exponential halo, and a fixed-size ripple buffer (8 slots, rolling index) where each click writes `(x, y, startTime)` consumed by the fragment shader as expanding sin-band rings with exponential decay. No new npm dependencies were added. DPR is capped at 2 to keep mid-range laptops responsive.

## Decision: App-wide UI cohesion pass (2026-05-11)

Following the landing redesign, three app-wide fixes were made to bring the rest of the product up to the same standard: dark-theme scoping, real navigation icons, and chat readability.

**1) Dark theme.** The previous styling defined the light palette under `:root` and only added `[data-theme="light"]` tweaks, with no `[data-theme="dark"]` rules and a stored default of `"dark"` — i.e. the app booted into a "dark" mode that rendered with light variables. Fixed by (a) changing the default in `theme.ts` to honour `prefers-color-scheme` and fall back to `"light"`, and (b) appending a comprehensive `[data-theme="dark"]` block to `styles.css` that overrides every CSS variable (`--bg`, `--surface`, `--panel-bg`, `--text-*`, `--user-bg`, sidebar tokens, status colors) and adds dark equivalents for surfaces that hardcoded `#fff` (inputs on focus, modals, flashcard faces, notes, search). Alternative considered: a near-total CSS rewrite to use semantic-only tokens — rejected as too invasive for the cohesion goal; the variable-flip plus a focused list of hardcoded-surface overrides is much smaller and reversible.

**2) Sidebar icons via `lucide-react` (new dependency).** Sidebar entries used unicode glyphs (`⊞◎⬡⌕◷◉⚙↩`) which read as bullets to screen readers, didn't align visually, and clashed with the new landing aesthetic. Replaced with `lucide-react` icons (`LayoutGrid`, `MessageSquare`, `Layers`, `FolderOpen`, `StickyNote`, `Search`, `History`, `User`, `Settings`, `LogOut`, `Plus`) and added an accent-colored left-bar plus icon-tint on the active row for clearer state. Alternatives considered: (a) `react-icons` — broader coverage but pulls a much larger surface area and inconsistent stroke widths across icon families; (b) hand-rolled SVG set — zero deps but unproductive for ~10 icons we want to add to and audit consistently. Chose lucide for tree-shakeable per-icon imports, uniform stroke geometry (matches the OS-chrome feel of the landing), and minimal runtime cost.

**3) Chat density + typed artifact headers.** The thread crammed turns together (`gap: 0.125rem`, 0.625rem turn-padding) and gave quizzes/diagrams the same sender-line treatment as ordinary AI messages, so artifacts didn't visually announce themselves. Raised inter-turn `gap` to 0.85rem and added a typed pill label (`Quiz` / `Diagram`) with an accent-tinted background and an accent left-border on the artifact cards themselves, so the user can scan the thread for "moments" (quizzes, diagrams, sources) at a glance. The pill uses the same `--accent` slate-blue token as the rest of the design so it stays themed.

*Why bundle these.* All three are visual-cohesion items with shared dependencies on theme tokens. Doing them in one pass meant the dark-theme palette could be designed knowing exactly which surfaces (icons, artifact pills, sidebar active bar) needed accent treatment, rather than re-touching each three times.

## Decision: Lecture mode persistence + AI surfaces polish (2026-05-11)

**1) Lecture mode conversations no longer appear in the sidebar / history.** Added `is_lecture BOOLEAN NOT NULL DEFAULT FALSE` column to `conversations` (migration `20260511_000014`), threaded the flag through `ConversationCreate` and `create_conversation()`, and filtered `list_conversations_for_user` to `WHERE is_lecture IS FALSE`. `useLectureSession` now calls `createConversation(subject, { isLecture: true })`. The conversation row still exists (so key-ideas, diagrams, and the audio stream all keep working via `conversation_id`), but every listing surface that uses `listConversations()` — sidebar, recent, dashboard, history, search — now skips it automatically. Alternatives considered: (a) make lecture mode entirely ephemeral with no DB row — rejected because `streamChat` and artifact persistence both require a `conversation_id`; (b) frontend-only filter via localStorage of "ids to hide" — rejected as non-durable across devices.

**2) Lecture mode UI re-themed.** The lecture overlay used a yellow legal-pad / Bradley-Hand cursive aesthetic disconnected from the slate-blue OS theme. Kept the notebook metaphor (ruled lines, margin line, "now writing" block, note-entry stream, sketch section) but switched colors: dark slate-glass page surface with backdrop blur, faint slate ruled lines, accent-colored margin (not red), `--accent` glow on the active concept pill, and accent left-border on note entries / sketch card / live block — matching the artifact left-border treatment used in the chat thread. Replaced cursive font with the existing Newsreader serif (italicized for "in-progress" feel) so typography ties back to landing/hero. The status pill now has a pulsing accent dot to signal liveness; the speaker waveform and send button were re-tinted to use `--accent`. Removed the per-entry random rotation (`±0.45deg`) which read as a paper-stack metaphor but conflicted with the new clean OS aesthetic.

**3) Quiz result clarity.** Hardcoded greens/reds (`#15803d`, `#b91c1c`) were swapped for theme tokens (`--success`, `--error`, `--success-bg`, `--error-bg`) and a 4px colored left-border was added to `.quiz-result` so correct/wrong/skipped reads as a strong, glanceable verdict. Header font size bumped to 1rem with a status-colored leading icon.

**4) Audited & confirmed.** Verified that the previously-suspected flashcard-flip-missing issue is a false positive — flips already work via `perspective: 1200px` + `transform-style: preserve-3d` + `rotateY(180deg)`. Likewise, the "dark theme completely broken" finding from the earlier audit was overstated — a duplicate `:root` block at line 2248 of `styles.css` defines a complete dark palette that wins by cascade order, and dark mode was functionally fine; the `[data-theme="dark"]` block I added in the previous pass is now an explicit, lint-friendly override of that implicit dark base rather than a fix for missing styles.

## Decision: Grounded, interruptible lecture mode (2026-05-13)

Lecture mode was extended from "read the generated answer aloud" into a more tutor-like interaction model: grounded sources on screen, learner-controlled pacing, direct visual/checkpoint prompts, and real interruption semantics.

**1) Source rail instead of hidden citations.** The streaming chat endpoint already emits retrieved uploaded-material chunks through a `sources` SSE event. `useLectureSession` now stores those `RetrievedSource` records in session state, and `LectureModeOverlay` renders them in a dedicated source rail with filename, page metadata, snippet, relevance score, and a link back to the material detail page when a subject route is available. This keeps the learner oriented while the tutor is speaking and makes grounding visible without forcing citations into the spoken script.

**2) Pace and playback controls.** Lecture mode now separates pedagogical pace from audio playback speed. Pace (`Concise`, `Normal`, `Deep`) is sent as an instruction on the opening lecture and each follow-up so the model changes explanation depth. Playback speed (`1x`, `1.25x`, `1.5x`) updates the active `HTMLAudioElement.playbackRate` and is also applied to queued speech chunks. This avoids conflating "talk faster" with "teach less deeply."

**3) Real-time interruption and explicit stop.** The browser microphone runs with echo cancellation, noise suppression, automatic gain control, and one-channel audio. `useLectureVoiceInput` watches microphone RMS locally, stops the current tutor audio as soon as speech starts, records only the learner utterance, filters transcripts that look like the tutor's own recent speech, and then sends the clean transcript as the next turn. The manual stop button uses the same cancellation primitives (`AbortController`, generation invalidation, audio queue cleanup), so stopping a response and interrupting by voice are consistent.

**4) Fast teaching actions.** "Check me" sends a prompt that pauses the lecture and asks one focused understanding question. "Show visually" asks the tutor to generate a visual explanation/diagram for the current concept. These are intentionally buttons rather than hidden prompt examples because they represent frequent lecture-mode control moves that should be available without typing.

*Why this architecture.* The implementation keeps lecture mode on top of the existing chat stream, source retrieval, key-idea, diagram, and TTS systems instead of creating a separate lecture backend. That preserves persistence, artifact generation, and RAG behavior while adding a lecture-specific presentation and voice-control layer in the frontend. The tradeoff is that pace preferences are prompt-injected per turn rather than stored as a separate conversation setting; this is simpler and adequate until lectures need persistent per-subject pedagogy profiles.

## Decision: Real image artifacts in chat and lecture (2026-05-13)

The tutor can now call a `find_image` tool when a real photo/reference image would help more than a generated diagram. The tool searches Wikimedia Commons through a dedicated `WebImageService`, emits a streamed `image` event, and renders the same attributed image card in both normal chat and lecture mode.

*Why Wikimedia Commons.* Tutor-response images should be educational references, not decorative stock photography. Wikimedia Commons is a better default because it is public, source-oriented, commonly contains diagrams/photos of academic topics, and exposes creator/license metadata that can be rendered directly in the artifact card. It also avoids coupling response visuals to the Pexels cover-image flow. If Wikimedia search fails, the stream does not fail; the tool returns a "no image displayed" message to the model and the tutor can continue with text or a generated diagram.

*How it differs from diagrams and sources.* Diagrams remain model-generated Excalidraw artifacts for relationships, flows, systems, and abstract concepts. Images are provider-backed media artifacts for concrete visual references. Sources are uploaded-material retrieval snippets that ground claims in the student's files. Keeping these as separate event types (`diagram`, `image`, `sources`) lets the UI present each one with the right affordances and attribution instead of forcing every visual into one generic attachment format.

*Implementation notes.* `AGENT_TOOLS` now includes `find_image(query, caption)`. When the model calls it, `stream_chat()` fetches one image, yields an `image` SSE payload with URL, caption, creator, license, provider, and source links, then sends a LangChain `ToolMessage` back into the second-pass tutor response so the tutor knows whether an image was shown. The frontend adds an `ImageData` stream type, a reusable `ImageArtifactCard`, chat-side `sseImages` rendering, and lecture-side image buffering so images can appear in the live notebook alongside notes and diagrams.

## Decision: LLM-graded targeted quiz feedback (2026-05-11)

The previous grader at `POST /quizzes/{id}/attempt` did a case-insensitive string-equality check against `quiz.correct_answer` and always returned the static `quiz.explanation` written at quiz-generation time. Symptom: a free-text answer that captured the right idea with imprecise wording (e.g., calling `<header>` "the parent of `<a>`" while also correctly stating "nav is the parent of `<a>`") was marked wrong and got generic feedback that ignored what the student actually wrote. Replaced with a hybrid grader.

*Hybrid path.* Multiple-choice answers that exactly match the canonical option keep the cheap string-equality fast path and return the stored explanation (no LLM call). Everything else — wrong MCQ choices and any free-text response — routes through a new `app/services/quiz_grading_service.py`. The grader sends `(question, canonical answer, options, student answer)` to Gemini with a Socratic prompt asking for JSON `{verdict: "correct"|"partial"|"incorrect", feedback}`. Verdict maps `correct → is_correct=True`, otherwise `False`. Feedback replaces the static explanation in the response.

*Where the cost lands.* The LLM call only fires on the wrong / free-text path, which is the teaching moment. A student who answers a routine MCQ correctly burns zero LLM tokens; a student who's actually wrong gets a 1–3s response that quotes their wording and points to the specific gap.

*Failure modes.* On any LLM failure (timeout, quota, malformed JSON, empty feedback string), the grader falls back to the naive string-equality verdict + canonical explanation, so the user still gets a usable response — same UX as before this change, never worse.

*Alternatives considered.*
- *Replace with `with_structured_output()` from langchain_google_genai for hard-schema JSON.* Cleaner but adds another dependency surface and the existing artifact-generation code in `artifacts.py` already uses the bare `ainvoke` + `json.loads` pattern; consistency won.
- *Grade everything (including correct MCQs) with LLM for consistent voice.* Rejected — burns money and adds latency on the routine "correct" path with no pedagogical upside.
- *Cache feedback by `(quiz_id, normalized_user_answer)` so common mistakes don't re-grade.* Worth doing later if attempt volume grows; skipped for now since it adds infra without changing UX.
- *Add a "partial" UI verdict (yellow/amber) to surface verdict=partial distinctly.* Considered, but partial answers and incorrect answers both pedagogically want the same UX — "here's what you got, here's the gap" — so the schema currently collapses partial → `is_correct=False` and lets the feedback text do the differentiation.

## Decision: Study workspace product rules (2026-05-11)

The project workspace should prioritize the information students actually need while avoiding placeholder or telemetry-like UI clutter.

**Empty chats.** A chat with no messages is ephemeral. Empty sessions are hidden from all history/listing surfaces and are deleted on a best-effort basis when the user leaves an empty loaded chat. This keeps the sidebar, dashboard, search, and subject session lists from accumulating accidental sessions created by setup flows or abandoned navigation.

**Subject page.** The subject page should stay compact and task-focused: no activity chart, no extra message-count or session-duration metadata, no "Last tutor reply" label, and no redundant "Change cover" text button. Sections can collapse/hide to reduce page weight, the cover is intentionally smaller, and cover editing is represented by a single top-right icon button. Study-session cards show only the last tutor reply timestamp, formatted in the user's browser timezone with 12-hour time, plus the relevant action buttons.

**Navigation and dashboard.** Search belongs above recent chat history in the sidebar because it is a primary navigation/action surface, not an archive item. Recent chat rows do not need per-row message icons; the title and timestamp carry the row meaning. The dashboard should not include an extra "new subject" example card when the primary new-subject action already exists. Subject cards should stay visual and uncluttered: no "Study flow" chip, no study-session count, no percent progress, and no decorative gradient block behind the greeting.

**Materials and input behavior.** PPTX is a first-class material type because student lecture materials are commonly distributed as PowerPoint decks. Chat messages and short-answer quiz responses should submit through the same path whether the user presses Enter or clicks the submit button, so keyboard and pointer behavior stay consistent.

## Decision: Ragas + OpenAI judge for end-to-end RAG and pedagogical evaluation (updated 2026-05-17)

The evaluation harness in `evals/` uses Ragas to score the end-to-end RAG pipeline on `faithfulness`, `answer_relevancy`, `context_precision`, `context_recall`, and `factual_correctness`, with OpenAI as the judge model. A second tutoring evaluation uses an OpenAI judge with a six-dimension rubric (scaffolding, active engagement, misconception handling, calibrated depth, prior-knowledge connections, source grounding) over `ScaleAI/TutorBench` rows and their sample-specific rubrics. Deterministic retrieval metrics (`recall@k`, `precision@k`, MRR) are computed against ground-truth labels without an LLM judge.

*Rationale.* Ragas ships the metric set that is most directly aligned with the failure modes a tutoring RAG system actually produces — hallucination beyond the retrieved context, off-topic answers, and retrieval that is numerous but irrelevant — and it does so against the existing `(question, contexts, answer, ground_truth)` interface that the production retriever already emits. OpenAI is used for judging because the tutor itself is Gemini-backed; judging Gemini outputs with a different model family reduces self-preferential bias and gives a cleaner evaluation story.

*Alternatives considered.*
- *DeepEval / `deepeval`.* Ships a similar metric surface (faithfulness, answer-relevancy, hallucination, bias) with a pytest-style harness. Rejected because its metrics are tuned for general LLM-app testing rather than RAG specifically, and its tighter coupling to its own dataset format would have meant rewriting the `(question, ground_truth_answer, relevant_passage_ids)` schema that `rag-mini-bioasq` already provides.
- *TruLens.* Strong on observability and feedback functions, oriented toward production tracing. Rejected because the eval harness is run offline against a fixed dataset, not against live traffic; the tracing surface would be unused and the metric set is less RAG-specific than Ragas.
- *LangSmith evaluators.* Tight integration with LangChain (which this project already uses for tutor generation) and good UI for inspecting per-row results. Rejected because it introduces a hosted-service dependency and an extra account/SDK surface for a metric set that Ragas implements offline without external state.
- *ARES / RAGAs-style learned judges.* Higher-fidelity per-metric judges fine-tuned on retrieval-augmented QA. Rejected as out of scope for this iteration — the cost of training or hosting a judge model outweighs the marginal accuracy gain at the current dataset size.
- *Custom rubric prompts only, no Ragas.* The pedagogical evaluation already takes this shape because no off-the-shelf framework scores tutoring behavior. Rejected as a *replacement* for Ragas on the RAG side, because rewriting `faithfulness` and `context_precision` prompts in-house gives up an externally-audited baseline for no architectural benefit.
- *Gemini judge.* Initially attractive because it reused the same provider and credentials as the tutor, but it makes the judge and system-under-test too similar.
- *Judge ensemble (Gemini + GPT-4o + Claude).* Would mitigate single-judge bias further. Acknowledged in the limitations section but deferred — the current single-judge configuration is already useful for trend detection, and adding two more providers triples the LLM cost and the failure-mode surface per run.

## Decision: `rag-mini-bioasq` as the RAG benchmark corpus (2026-05-12)

The retrieval and Ragas evaluations both run against `rag-datasets/rag-mini-bioasq` (4.7K biomedical passages with ground-truth `relevant_passage_ids` per question), supplemented with configurable distractor passages drawn from the rest of the BioASQ corpus and segregated to a dedicated `ragas-eval@local` user with its own subject. The current default uses one hundred QA rows and five hundred distractors.

*Rationale.* The dataset provides deterministic ground-truth relevance labels, which makes retrieval metrics computable without an LLM judge, and its passage length and register approximate the textbook excerpts and lecture notes that students actually upload. The distractor passages keep recall non-trivial: without them, a retriever that returned every passage would hit perfect recall vacuously.

*Alternatives considered.*
- *MS-MARCO.* Massive scale and a de facto industry baseline, but the passage register is web-search snippets rather than instructional content, and the relevance graders were optimized for web ranking rather than academic correctness. Rejected as a register mismatch for tutoring material.
- *FiQA / BEIR financial subset.* Domain-narrow and registers as Q&A rather than instructional prose. Rejected for the same register-mismatch reason.
- *Hand-curated corpus drawn from real student uploads.* Highest external validity but blocked on (a) consent / privacy for actual student-uploaded material and (b) the engineering cost of labeling ground-truth relevance ourselves. Deferred to a follow-up project; the BioASQ subset is the appropriate placeholder until real-user data can be ethically annotated.
- *MMLU / academic QA benchmarks.* Measure model knowledge, not retrieval quality — passages are not the unit of evaluation. Rejected as not measuring the system under test.
- *Full BioASQ (vs. `rag-mini-bioasq`).* The full corpus is millions of passages; ingestion cost and embedding budget would dominate the harness without changing the *signal* it produces, since the mini variant already exercises the retriever's ranking, deduplication, and chunking paths. Rejected as a cost-only difference.

## Decision: Lecture-mode session shape — boolean column on `conversations` (2026-05-11)

Lecture-mode sessions are modeled as ordinary `conversations` rows with a new `is_lecture BOOLEAN NOT NULL DEFAULT FALSE` column (migration `20260511_000014`), filtered out of every listing query (`list_conversations_for_user` and any view that calls it) but still backing artifact persistence via the existing `conversation_id` foreign keys.

*Rationale.* The lecture flow reuses the same `streamChat` endpoint, the same key-ideas and diagram artifact tables, and the same audio-stream wiring as ordinary chats — sharing the conversation table keeps those references valid without polymorphic joins or duplicated artifact tables. Hiding the rows at the query layer rather than at write time means the data is still introspectable for debugging and analytics, and converting an existing lecture session into a regular chat (or vice versa) is a single column flip rather than a row migration.

*Alternatives considered.*
- *Separate `lecture_sessions` table with its own primary key.* Cleanest separation of concerns, but `key_ideas`, `diagrams`, and the streaming pipeline all foreign-key to `conversations.id`. Either every artifact table would need a parallel `lecture_session_id` column (doubling the schema) or every artifact insert would need a polymorphic-association adapter. Rejected — the additional schema cost is large and the only benefit is conceptual.
- *Ephemeral / no DB row at all.* Considered briefly; rejected because `streamChat` requires a stable `conversation_id` to attach assistant messages and tool outputs to, and artifact persistence (key-ideas, diagrams) is part of the lecture-mode UX, not optional. Going ephemeral would mean re-architecting both surfaces around a transient identifier.
- *`conversation_type` enum column (`chat | lecture | …`).* More extensible than a boolean and the right shape if a third or fourth session kind is ever added. Rejected for *now* on YAGNI grounds — only two states exist today, and enums are harder to filter on indexes than booleans. The migration to an enum is trivial (`ALTER TABLE` plus a backfill) if a third state ever appears.
- *Frontend-only filter via `localStorage` of hidden conversation IDs.* Considered for speed — no migration, no backend change. Rejected because it is not durable across devices, and the "lecture sessions should not appear in history" guarantee should be a property of the data, not of one client.
- *Soft-delete on creation (`deleted_at = NOW()`).* Would naturally hide the rows from any query that already filters deleted conversations. Rejected because lecture sessions are not *deleted* — they are valid, accessible, just-not-listed — and conflating the two semantics would corrupt the meaning of the existing soft-delete column.

## Decision: Dashboard cover images via S3-backed direct upload with re-signed read URLs (2026-05-13)

Dashboard subject covers are now uploaded by the user from their machine, not pasted as arbitrary public URLs. The frontend obtains a short-lived presigned PUT URL from `POST /projects/cover-images/presign`, uploads the file directly to S3/R2 under `cover-images/{user_id}/{uuid}.{ext}`, and persists the resulting object key on `project_profiles.cover_image_storage_key` (migration `20260513_000016`). When any endpoint returns a `ProjectProfileRead`, the backend re-signs a fresh GET URL for that key and serves it as `cover_image_url`. Pexels selections continue to flow through the existing `cover_image_url` field, mutually exclusive with `cover_image_storage_key`; switching between the two modes clears the prior blob from S3 inside the `setup_project` transaction.

*Rationale.* The "paste a public image URL" affordance was both a usability tax (users had to host the image themselves) and a security smell (every load issued a third-party GET that leaked the user's IP and `Referer`, and there was no integrity guarantee that the image at the URL would still be the image they picked). Moving uploads into the same bucket already used for materials gives us one credential surface, one CORS configuration, one upload-size policy (here 5 MB, enforced by the presigned URL), and one place to delete blobs when the user replaces the cover. Storing the *key* (not a presigned URL) in the database keeps the row durable across signature expiration and lets the backend control read-side TTL centrally via `preview_url_expires_seconds`.

*Alternatives considered.*
- *Backend multipart endpoint that streams the file through FastAPI to S3.* Conceptually simpler for the frontend (one request, no presigning) but doubles the bandwidth at the API server and ties request latency to the file size. Rejected — the materials pipeline already established the presigned-PUT pattern and the operational characteristics are strictly better.
- *Public-read bucket / public bucket prefix for cover images.* Would let `<img src>` point at a stable URL with no re-signing. Rejected because the project is single-bucket and switching one prefix to public ACL on Cloudflare R2 requires bucket-wide configuration changes, and because there is no real benefit at this scale to leaking authenticated upload artifacts to the open web.
- *7-day max-expiry presigned URL stored directly in `cover_image_url`.* Avoids the new column and the hydration helper. Rejected because the URL silently breaks after seven days and there is no signal on the row that it needs to be refreshed; the failure mode is "the user's dashboard quietly loses its image."
- *Base64-encoded image stored inline in the DB.* No S3, no signing, trivial reads. Rejected because Postgres-resident base64 image bytes inflate every profile read by ~33%, and `ProjectProfileRead` is fetched on dashboard and project pages where the payload would dominate response size.
- *Client-side blob URL only (no upload at all).* The picker would set an `<img src>` to `URL.createObjectURL(file)` and store nothing server-side. Rejected because the cover would not survive a page reload, let alone a different device, which is the entire point of the feature.
- *Keeping the URL-paste option alongside the upload picker.* Considered briefly. Rejected per the explicit product directive ("remove the URL option") and because supporting both paths doubles the validation surface (CORS for hotlinked images, MIME sniffing for arbitrary remote URLs) without a corresponding usability gain.

## Decision: Explain-first tutor prompt (concepts → examples → check) (2026-05-13)

The base tutor system prompt was rewritten to lead with *substantive explanation* — named sub-concepts in **bold**, one-sentence definitions, and at least one concrete example per principle — and to use Socratic questioning as the *closer* rather than the gate. The prior prompt began with "ASSESS FIRST. ... Never open with a lecture" and "HINT BEFORE EXPLAIN," which caused the tutor to deflect direct informational questions ("what are the main principles of UI design?") into counter-questions ("what do *you* think the most important things are?") instead of teaching. The new prompt explicitly distinguishes *information-seeking* questions (which get a structured, exampled answer) from *attempt* questions ("I think the answer is X — is that right?", which still get hints, not the full answer).

*Rationale.* A tutor that refuses to give the answer to a "what is X?" question fails the most basic affordance of a learning tool: when a student doesn't know something and asks, they should learn it, not get bounced. The original prompt over-applied Socratic method to every interaction, conflating explanation-requests with problem-solving-attempts. The rewritten prompt keeps the hinting behavior for genuine problem-solving and the comprehension check for after-explanation calibration, but unblocks the teaching path that the rest of the system (key-idea saving, diagram generation, quiz verification) was already designed to support.

*Alternatives considered.*
- *Per-style prompt switching via the `users.tutor_style` column.* The `tutor_style` field (default "Socratic guide") is concatenated into the system prompt at request time, so users could in principle pick a different style. Rejected as the *primary* fix because every new student lands on the default "Socratic guide" style and would hit the same deflecting behavior on day one; the base prompt has to be correct before per-user customization can meaningfully refine it.
- *Two-tier prompt: assess-first for the first message of a session, explain-first afterward.* Reasonable on paper. Rejected because the assess-first opener was exactly the part the user complained about, and most sessions are short enough that the "assess once, then teach" mode never reaches the teach phase.
- *Stricter quiz/diagram tool-call triggers as a substitute for explanation.* The thinking: if the tutor immediately quizzes or diagrams instead of explaining, it still teaches. Rejected because a quiz on a topic the student has never been taught is a worse experience than a clear text explanation, and diagrams are not always appropriate (the UI-principles question above is mostly textual).
- *Keep the Socratic prompt and educate users to phrase questions differently.* I.e., teach the student to type "explain X" instead of "what is X." Rejected — the prompt is a *configuration* surface the project owner controls, and pushing tutor-side configuration burden onto every student is exactly backwards.
- *RLHF / preference-tuned model swap.* A model fine-tuned on tutoring would presumably handle the assess-vs-explain distinction natively. Out of scope for this iteration; this is a prompt change, not a model change. The new prompt makes the boundary explicit enough that base instruction-tuned models can follow it reliably.

## Decision: GitHub Actions deploys commits to Fly.io (2026-05-14)

Commits pushed to `main` now trigger `.github/workflows/deploy.yml`. The workflow runs backend tests, builds the Vite frontend, installs `flyctl`, deploys the FastAPI app using the root `fly.toml` (`sapient-api`), then deploys the frontend from `frontend/fly.toml` (`sapient`). Manual runs are also available through `workflow_dispatch`.

*Operational requirements.* The repository must define `FLY_API_TOKEN` as a GitHub Actions secret. The frontend build reads `VITE_API_BASE_URL` and `VITE_GOOGLE_CLIENT_ID` from repository variables, with same-named secrets accepted as a fallback. Backend runtime secrets stay in Fly, not in GitHub Actions; the backend deploy uses Fly's release command to run `alembic upgrade head`.

*Rationale.* Deployment should be tied to the commit that produced it. Running tests and the frontend build in Actions catches broken pushes before Fly receives an image, while keeping the actual production secrets in Fly preserves the existing operational boundary.

*Alternatives considered.*
- *Manual local `fly deploy` after every commit.* Simple, but it depends on a developer machine and makes it easy for the deployed version to drift from `origin/main`.
- *Separate backend and frontend workflows.* Slightly more granular, but this app's deployable surfaces are coupled by API/frontend contract changes and should advance together for now.
- *Build-only CI plus manual deploy approval.* Useful for higher-risk production systems, but too much ceremony for the current project size. Manual dispatch remains available when a redeploy is needed without a new commit.

## Decision: Bayesian Knowledge Tracing as the student model (2026-05-15)

Sapient now maintains a per-subject BKT knowledge state on `project_profiles.knowledge_state` and stores an optional `concept` on each generated quiz. When a student answers or skips a quiz, the backend resolves the quiz to a Learning Map topic when possible, applies the BKT update, persists the new mastery probability, and maps that probability back to the Learning Map status. The tutor prompt receives the resulting mastery percentages so live tutoring can prioritize weak concepts instead of relying only on summary text.

*Rationale.* BKT is a canonical intelligent tutoring system algorithm and gives the app an explicit student model: not just "how many questions were correct," but "how likely is this student to have mastered this concept?" It is also explainable and data-efficient enough for the current product scale, unlike sequence models that require many historical attempts per user.

*Alternatives considered.*
- *Naive correctness rate per concept.* Easier to implement, but it cannot distinguish guessing from knowledge or mistakes from non-mastery.
- *Deep Knowledge Tracing.* More expressive, but it needs far more attempt-sequence data than the app currently has and is harder to explain in the UI and writeup.
- *Only prompting the LLM to infer weak areas.* Flexible, but not a durable model. The same evidence should produce the same mastery update regardless of prompt phrasing.

## Decision: Optional cross-encoder reranking for RAG retrieval (2026-05-15)

The retrieval pipeline now supports an optional second-stage reranker. The backend first over-fetches vector candidates from pgvector (`RAG_CANDIDATE_K`, default 50), then, when `RAG_RERANKER_ENABLED=true` and `LANGSEARCH_API_KEY` is configured, sends those candidate passages to LangSearch's `/v1/rerank` endpoint using `langsearch-reranker-v1`. The reranked results are then trimmed with the existing per-material diversity rule before being injected into the tutor prompt and streamed as source metadata.

*Rationale.* Embedding search is fast and broad, but it scores the query and each passage independently in the vector space. A cross-encoder reranker scores the query-passage pair directly, which is the standard two-stage retrieval architecture for improving precision at the small `top_k` used in prompts. This gives the project a concrete retrieval-quality ML story: vector-only versus vector-plus-reranker can be evaluated with recall, precision, and MRR using the existing retrieval harness.

*Alternatives considered.*
- *Always rerank every query.* Rejected because reranking adds latency and an external API dependency; the feature is opt-in and fail-open.
- *Cohere Rerank.* Strong industry baseline, but paid at production usage. LangSearch fits the student-project budget better while preserving the same two-stage retrieval architecture.
- *Local BGE reranker immediately.* Stronger local-control story, but it adds model-hosting and dependency weight that is not necessary to validate the retrieval architecture.
- *Increase `RAG_TOP_K` instead.* Cheaper, but it pushes more context into the LLM rather than making the retrieved context better, increasing prompt cost and distraction.

## Decision: Web search as an explicit tutor tool (2026-05-16)

Sapient now exposes web search to the tutoring agent as a tool, using LangSearch's `/v1/web-search` API when `WEB_SEARCH_ENABLED=true` and `LANGSEARCH_API_KEY` is configured. The tutor is instructed to call the tool for current/latest facts, outside references, or when the student explicitly asks to search the web. Results are returned with `[Web N]` labels, surfaced in the chat sources panel, and the tutor is instructed to cite web-sourced claims inline.

*Rationale.* Study-material RAG is still the primary source for course-specific tutoring, but students often ask for current examples, newer documentation, or outside context. Making web search a tool keeps the tutor grounded: it can browse when needed without pretending every answer came from uploaded notes. It also creates a clearer UX boundary between course sources and public web sources.

*Alternatives considered.*
- *Let the base LLM answer from training knowledge only.* Simple, but it cannot handle current facts and encourages vague hedging.
- *Always search the web before every answer.* Rejected because it adds latency, cost, and distraction for questions already covered by uploaded study materials.
- *Add a separate Google/Bing provider.* More familiar, but it adds another credential and billing surface. LangSearch already supports both reranking and web search with the same API-key pattern.

## Decision: First-pass security hardening — security headers and dependency bumps (2026-05-15)

A read-only security audit of the codebase produced three classes of fixable issues; this decision records the subset that was applied immediately and the items deferred for separate validation.

**Applied.**
1. **Security headers middleware** in `app/main.py`. Every response now carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Strict-Transport-Security: max-age=31536000; includeSubDomains` when the request was HTTPS. A strict `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` is applied to API responses; `/docs`, `/redoc`, and `/openapi.json` get a relaxed CSP that whitelists the jsDelivr CDN so Swagger UI continues to load.
2. **Backend dependency pins** in `requirements.txt`: `pypdf 5.4.0 → 6.10.2` (closes 22 pypdf CVEs around malformed PDF handling, directly relevant because Sapient parses user-uploaded PDFs), `python-multipart 0.0.20 → 0.0.27` (closes 3 multipart-parsing CVEs), `pyjwt 2.10.1 → 2.12.0`. Verified by `pip install --dry-run` and the full unit test suite (34 passed).
3. **Frontend transitive bumps** via `npm audit fix` in `frontend/`. Reduced reported vulnerabilities from 12 (1 high, 11 moderate) to 9 (1 high, 8 moderate). The residual high (lodash-es prototype pollution / `_.template` code injection) and the nanoid moderates are all transitive through `@excalidraw/excalidraw`; `npm audit fix --force` would bump it to a major-version-incompatible release and is deferred.

**Deferred (with rationale).**
- **`fastapi 0.115 → 0.122` + `starlette 0.46 → 0.49`.** Starlette 0.46.2 has two open CVEs (multipart parsing DoS) and FastAPI 0.115.12 pins starlette below 0.49, so closing the CVE requires bumping both. A 7-minor FastAPI bump can change middleware ordering and dependency-override scoping behavior; the audit pinned 0.122.1 in a sandbox and confirmed pip resolution but did not run the full integration suite. Treated as a separate change that needs its own validation pass.
- **JWT in `localStorage` → `HttpOnly` cookie.** The current bearer-token setup is exposed to XSS payloads that bypass CSP. Migrating requires a `/auth/logout` endpoint, CSRF token plumbing for state-changing requests, and frontend changes to `frontend/src/api.ts` and `frontend/src/auth.ts`. With the new strict CSP in place and no real users, the residual risk is small enough to handle in a dedicated change.
- **Excalidraw bump.** `npm audit fix --force` installs `@excalidraw/excalidraw@0.17.6`, a breaking-version downgrade off the current main branch. Behavior validation needs a manual pass over the diagramming feature.

*Rationale.* The three applied changes are non-behavioral and reversible: security headers are response decoration, dependency point-bumps have small surface area (pypdf and pyjwt APIs in use are stable across the bump), and `npm audit fix` only touches transitive deps. The deferred items all carry behavioral risk or require parallel frontend changes and deserve their own focused commits with smoke testing.

*Alternatives considered.*
- *Defer everything until a single big "security PR".* Rejected because it keeps trivially-closeable CVEs open while waiting for the harder changes to land.
- *Apply `npm audit fix --force` and bump FastAPI in this pass.* Rejected because both are behavior-affecting changes that should be tested in isolation, not bundled with a defensive-headers patch.
- *Strict CSP everywhere, including `/docs`.* Rejected because it breaks Swagger UI's CDN-loaded assets. The relaxed CSP on docs paths still pins script/style sources to jsDelivr and `self` — a real improvement over no CSP — without losing the developer affordance.

## Decision: Mermaid replaces Excalidraw for tutor-generated diagrams (2026-05-15)

The `create_diagram` tutor tool previously asked the LLM to emit raw Excalidraw element JSON — boxes, arrows, `boundElements` cross-references, `startBinding`/`endBinding` pairs, and a dozen other low-level fields per element. The model frequently produced malformed scenes: orphan arrows with no bindings, shapes missing their inbound edges, or arrays of nodes with no connecting edges at all. The pipeline now asks the model for **Mermaid source code** and renders it on the client with `mermaid.js`. The tool's `parameters` schema changed from `{elements: <Excalidraw JSON string>, title}` to `{source: <Mermaid source>, title}`, and the SSE `diagram` event payload changed from `{elements: [...]}` to `{source: "..."}`. `@excalidraw/excalidraw` is removed as a dependency.

*Rationale.* Mermaid is a small, well-defined DSL designed for exactly the diagram types a tutor draws — flowcharts, hierarchies, sequences, state machines, ER diagrams, mind maps. The LLM goes from generating ~200 lines of fragile JSON per diagram to ~5 lines of declarative source, which dramatically reduces the malformed-output failure mode. The conversion-to-render is now a stable, well-tested library path (`mermaid.render(id, source)`) instead of a chain of LLM correctness assumptions. As a side effect, the security audit's deferred `@excalidraw/excalidraw` major-version bump is moot — the package is gone, and the frontend's reported npm audit count drops from 12 vulnerabilities (1 high, 11 moderate) to 0.

*Alternatives considered.*
- *Server-side repair of LLM-produced Excalidraw JSON.* Rejected: it would only mask the underlying fragility (the model still has to produce a structurally complex format correctly most of the time), and the repair logic would need to grow as new failure modes emerge. Quick patch, not a fix.
- *Keep Excalidraw, switch input to Mermaid via `@excalidraw/mermaid-to-excalidraw`.* The Excalidraw team's own recommended path, and it preserves the hand-drawn aesthetic. Rejected for a masters project where polish is a secondary goal: the conversion library introduces another moving part, and the underlying excalidraw security advisories still apply. Worth revisiting if the project ever needs the hand-drawn look as a brand differentiator.
- *PlantUML / Graphviz.* Stronger for class/ER diagrams than Mermaid was historically, but PlantUML needs a Java server and Graphviz needs WASM bundles. Mermaid's coverage of the relevant diagram types is now wide enough that the operational simplicity wins.
- *Hybrid (Mermaid for structural, AI-generated raster images for spatial / free-form).* Useful if a tutoring case genuinely fails Mermaid's expressiveness, but the existing `find_image` tool (Pexels + web search) already covers real-world photographs. Deferred until a concrete failure case appears.
- *Render Mermaid as Excalidraw-style sketchy SVG via Mermaid's `look: "handDrawn"` config.* Available in Mermaid 11.x, recovers some of the Excalidraw aesthetic without the dependency. Not enabled in this pass — clean SVG is what defaults the audit and writeup care about — but it's a one-line toggle if the aesthetic becomes a priority.

## Decision: Assignments, calendar feeds, and BKT-driven smart reminders (2026-05-15)

Sapient now models student deadlines as first-class entities: a manual `Assignment` (title, due date, subject, notes, source URL) and a `CalendarFeed` that points at an iCal/webcal URL (e.g. a Canvas course calendar). Assignments imported from a feed carry `source="canvas"` and a stable `source_uid` so re-syncs are idempotent. A `/assignments/reminders` endpoint produces a unified, severity-sorted list combining upcoming-due alerts (`overdue` / `urgent` / `soon`) with mastery alerts derived from the existing BKT knowledge state and learning-map `needs_review` flags. The frontend exposes this through a global `/calendar` page, a dashboard preview, and a per-subject upcoming-strip.

*Rationale.* The tutor was already modeling what a student *knows* (BKT) and *should learn next* (learning map). Adding what they *owe and when* closes the loop: reminders can now say "your essay is due in 2 days and your BKT mastery on composition is low — start with that." Importing via standard iCal/webcal rather than the Canvas REST API means the integration works with any Canvas instance the student already has access to, with no per-institution OAuth setup. A masters writeup benefits from being able to demonstrate the three signals composing.

*Alternatives considered.*
- *Canvas REST API (OAuth).* More structured data (rubrics, submission state), but requires per-institution OAuth app registration and a Canvas tenant the student admins. Rejected as too much operational lift for the project; iCal export is universally available behind a personal-secret URL.
- *Treat reminders as a pure cron job that writes to a `notifications` table.* Cleaner separation, but adds a scheduler dependency. The on-read computation in `build_smart_reminders` is cheap (one indexed query + one profile read) and avoids the staleness problem entirely. Revisit if reminder generation ever needs to fan out to email/push.
- *Use the LLM to summarize reminders.* Would produce nicer copy, but introduces LLM latency on every dashboard load and a non-determinism cost during evaluation. The current rule-based copy ("your essay is due in 2 days, prioritize composition while preparing") is explainable and testable.

*Security: SSRF in the iCal fetcher (audited and fixed in the same pass).* The initial implementation called `httpx.get(url, follow_redirects=True)` on user-supplied feed URLs with only a scheme check. That was a clear SSRF: a student could submit `http://169.254.169.254/latest/meta-data/...` (AWS instance metadata) or `http://localhost:8000/auth/...` and have the server fetch it. `fetch_ical_events` now resolves the host, rejects any address that is loopback, private (RFC1918), link-local, multicast, reserved, or unspecified, manually follows up to 3 redirects with re-validation at each hop, and caps the response at 5 MiB. Access control on the routes themselves was already correct — every endpoint scopes by `user_id` from the JWT, and `_get_assignment` / `_get_feed` enforce ownership.

*Known limitation.* The IP-validation approach does not defend against DNS rebinding, where an attacker controls a DNS record that resolves to a public IP at validation time and a private IP at connection time. The standard defense (resolve once, then connect by IP with a `Host:` header) breaks SNI for HTTPS. For a masters project with no real users, this residual risk is accepted; a production deployment should pin the resolved IP into the httpx transport or use a SOCKS proxy that enforces egress policy.

## Decision: Human-in-the-loop study material management (2026-05-15)

The tutor still auto-generates quizzes, flashcards (key ideas), diagrams, and images during chat, but every artifact type is now also (a) **user-authorable** with a dedicated form and (b) **user-summonable** on demand from the subject page, not only as a side effect of conversation. New surface area:

- **Manual save from chat.** Assistant messages have a bookmark button that captures the current text selection (or the whole message if nothing is selected) into the notes. Diagram and image cards have their own Save buttons. Saved snippets carry an `artifact_type` (`text`, `diagram`, or `image`) plus structured `artifact_data` on `KeyIdea`, so the note panel can re-render the original Mermaid source or image thumbnail rather than just text.
- **Manual quiz authoring.** `POST /quizzes` accepts a user-written `multiple_choice` or `short_answer` quiz with full server-side validation (options ≥ 2, `correct_answer` must match one option exactly for MC). Stored in a per-subject "Manual quizzes" conversation so existing conversation-scoped flows (history, BKT attribution) still work without a separate `manual_quizzes` table.
- **Manual flashcard authoring.** Reuses the existing `POST /key-ideas` endpoint — flashcards are already KeyIdeas under the hood (the SR fields turn any note into a flashcard). The new modal just exposes that authoring surface.
- **On-demand generation per subject.** `POST /projects/{subject}/quizzes/generate` and `POST /projects/{subject}/flashcards/generate` produce a fresh batch using the subject (and recent notes) as context. Distinct from the existing `weak-quiz` endpoint, which requires struggled-with topics or failed attempts; these generators work on a fresh subject with no history.

*Rationale.* An LLM tutor that owns the entire learning loop — what you cover, what you remember, what you're quizzed on — is fragile in two ways. It's only as good as the model's choices in a given conversation, and it gives the learner no way to direct the system toward what they actually need next. Putting the user in the loop matters for both pedagogy and product: pedagogically, *generation effect* and *self-explanation* are well-documented retention boosters, so the act of writing your own flashcard is itself part of learning; product-wise, "I want five practice questions on this topic right now" is a request the user can articulate better than any heuristic. The autogeneration paths remain because they're convenient and they capture material that would otherwise be lost in chat history — but the human-in-the-loop additions guarantee the learner can always intervene, edit, add, or curate what the system stores about them.

*Alternatives considered.*
- *Auto-only, no manual authoring.* Simpler product surface, but the user has no agency over what gets remembered or quizzed on. Particularly bad in domains where the model misjudges what's important — students from underrepresented sub-disciplines would silently get worse coverage.
- *Manual-only, no LLM generation.* Lower trust risk, but loses the assistant's main value. Students rarely have the energy to author a full quiz set from scratch; the on-demand generator + author hybrid covers both peaks (engaged user authoring a key concept) and troughs (tired user wanting practice now).
- *Distinct `Note`, `Quiz`, and `Flashcard` tables for manual entries.* Cleaner separation but doubles the surface area: every consumer (search, BKT, SR scheduler, sidebar panel) would need to know about both auto and manual paths. Extending the existing `KeyIdea` and `Quiz` tables with an `artifact_type` field on the former and a synthetic "Manual …" conversation for the latter keeps a single source of truth per artifact type.
- *Save snippets into a separate `clip` model.* Considered — would let snippets carry richer metadata (origin message, timestamp range, role) — but tutors mostly produce things students want to remember as *notes*. Conflating snippets and notes means they show up in the same review pipeline (search, SR, learning-map attribution) without a separate UX.
- *Inline message-level attachment of artifacts.* The `quizzes.message_id` column added alongside this work was driven by the same principle: the user should be able to see exactly which response produced a given quiz, not be presented with a blob of artifacts disconnected from the conversation. Inline rendering of diagrams, images, and quizzes per assistant message is the read-side counterpart to the write-side authoring surfaces.

## Decision: RAGAS 100-row eval run, embedding-quota recovery, and metric interpretation (2026-05-18)

The full RAGAS evaluation now covers all 100 rows of `rag-datasets/rag-mini-bioasq` (previously 20). Final aggregates over n=100, gpt-4o judge, gemini-2.5-flash generator:

| metric | score |
|---|---|
| faithfulness | 0.962 |
| answer_relevancy | 0.819 |
| context_precision | 0.847 |
| context_recall | 0.828 |
| factual_correctness | 0.456 |

Three things changed mechanically to make the 80-row extension possible: the ingestion path now caches each embedding to `evals/eval_embedding_cache.json` as soon as the Gemini call succeeds (so a 429 mid-batch never costs prior progress); the RAGAS judge's transient-error markers were extended to recognize `APIConnectionError` / "Connection error." / "remote end closed" / "broken pipe" (a laptop sleep mid-run had killed the socket and the script exited instead of backing off); and the per-row judge checkpoint at `evals/ragas_scores_checkpoint.json` was already row-and-metric granular enough that the restart resumed at row 31's `answer_relevancy` without re-judging anything.

*Rationale.* The 20-row baseline was a smoke test, not an evaluation; n=20 with bimodal per-row scores produces confidence intervals wide enough to swallow any plausible system change. n=100 still isn't enough for tight CIs on subgroup analysis, but it crosses the threshold where mean-shifts of ~5 percentage points on the per-row metrics become detectable, which is what we need for ranking model and retriever variants in the writeup. The fixes themselves were the cheap path: per-passage caching means the next re-ingest (different chunking, different embedding model, different `k`) is incremental rather than another 1,636-call burst, and the broader retry markers convert "kill the run" into "back off and retry" for any future networking glitch.

*Alternatives considered.*
- *Switch the eval-time embedder to OpenAI `text-embedding-3-small` via an `EVAL_EMBED_PROVIDER=openai` knob.* This was the documented fallback if Gemini's daily quota stayed exhausted — both the eval ingestion and the retriever's query side would have read the same env var, keeping cosine similarity consistent. Rejected once a prepaid Gemini balance unblocked the quota: the whole point of the RAG eval is to measure the production retrieval path, and swapping the embedding model breaks production parity. Kept on the shelf as a guaranteed-to-work fallback for any future masters-project deadline where Gemini availability is the bottleneck.
- *Use Gemini's `batchEmbedContents` (up to 100 texts per request).* Would have cut request count by ~100× and worked under either tier. Not implemented because the prepaid balance made it unnecessary, and adding a batch path now would diverge the eval embedder from `app/services/embedding_service.py`'s single-call production behavior — a needless source of "but production runs one-by-one, your eval ran in batches of 100" objections during writeup defense. Worth doing if the production retriever ever moves to a batch-ingest pipeline.
- *Defer the 80-row extension and ship the writeup on n=20.* Rejected because the eval section is one of the few places where masters-rigor and product-rigor diverge: a product would be fine with n=20 as a regression gate, but a masters writeup that claims a number needs that number to be defensible.
- *Match RAGAS's eval-time embedder to the production embedder (Gemini), instead of using OpenAI `text-embedding-3-small` for `answer_relevancy`.* Rejected — the RAGAS judge embeddings serve `answer_relevancy`, which is an *evaluation* signal, not a production retrieval signal. Keeping the judge stack entirely on OpenAI (LLM + embeddings) keeps the eval evidence one provider away from the system being evaluated, which is what reduces self-preferential bias when the generator is Gemini.
- *Replace `factual_correctness` with a custom rubric.* The metric scored 0.456 — far below the other four — and the floor is driven by valid-but-differently-framed answers, not actual wrong answers (row 21's ivabradine question is the canonical example: the generator reported trial outcomes, the BioASQ reference described the mechanism, both correct, claim-overlap ≈ 0). A free-form "is this medically accurate" prompt to the judge would correlate better with human judgment. Not done in this pass because (a) the standard RAGAS number is what a reviewer recognizes, and (b) the gap between `factual_correctness` and `faithfulness` *is itself an interpretive finding* worth keeping in the writeup. A custom-judge metric can be added alongside, not in place of, the RAGAS metric if the writeup needs a head-to-head.

*Known limitation.* `factual_correctness` should not be read as "the system is half wrong." It's a strict claim-set F1 against a single short reference answer, and BioASQ references are often partial. The faithfulness + context-recall pair (0.962 / 0.828) is the better signal for "does the system answer the question correctly given retrieved evidence."

## Decision: TutorBench 100-scenario pedagogical eval and the `OPENAI_API_KEY` alias-shadow bug (2026-05-18)

The pedagogical eval (`evals/tutoring_eval.py`) now runs against 100 ScaleAI/TutorBench scenarios (text-only USE_CASE_1_TEXT after the multimodal filter), scoring tutor responses on six dimensions with a gpt-4o judge. Final n=100 means:

| dimension | mean (1-5) |
|---|---|
| scaffolding | 4.70 |
| engagement | 4.73 |
| misconception | 4.72 |
| depth | 4.82 |
| connections | 4.41 |
| grounding | 4.83 |
| **overall** | **4.70** |

The single weak dimension is `connections` — the tutor links the current concept to adjacent material less consistently than it scaffolds or grounds. This is the most actionable finding for future tuning. Two mechanical changes shipped with this run: the same `connection error` / `apiconnectionerror` / `remote end closed` retry markers added to the RAGAS judge are now in `_is_retryable`, so a laptop-sleep mid-run gets backed off instead of crashing the process; and one stuck-on-first-scenario investigation surfaced a real configuration bug that's now documented below.

*Rationale.* RAGAS measures whether the RAG path produces faithful, grounded answers — but the tutor's product value is *teaching*, not retrieval-conditioned QA, and RAGAS doesn't measure that. TutorBench (ScaleAI, 2024) is the right complement: each scenario carries a rubric of "ideal tutor behaviors" produced by domain experts, and the six-dimension judge prompt maps those rubrics onto the tutor's actual response. Running n=100 (vs. the prior 15 hand-written local scenarios) crosses the same statistical-detectability threshold as the RAGAS upsize: the per-dimension means are now stable enough to rank model and prompt variants in the writeup. Keeping the gpt-4o judge consistent across both evals (RAGAS and TutorBench) means the judge-side variance is a constant, not a confound, when comparing absolute scores.

*Configuration bug discovered during this run (worth documenting because it's not obvious from the code alone).* The first three launches failed immediately with `400 INVALID_ARGUMENT: API_KEY_INVALID` on every Gemini call. The cause was the eval launcher exporting `OPENAI_API_KEY` in the shell so the judge could read it, combined with `Settings.llm_api_key` being declared in `app/core/config.py` with `validation_alias=AliasChoices("LLM_API_KEY", "OPENAI_API_KEY")` — an intentional choice that lets users with a single OpenAI key drive the app without renaming. Pydantic-settings consults shell env before the `.env` file and tries aliases in order: when both `LLM_API_KEY` (in `.env`, the Gemini key) and `OPENAI_API_KEY` (set in the launch shell, the OpenAI key) are present, the shell-set `OPENAI_API_KEY` wins via the alias, and the resulting `settings.llm_api_key` is an OpenAI `sk-proj-...` token passed to `ChatGoogleGenerativeAI`. Google rejects it as `API_KEY_INVALID`, which is structurally correct but semantically misleading — it looks like a Google quota or auth problem and points the investigator at the wrong system. The fix is to pass the OpenAI key as `EVAL_OPENAI_API_KEY` (which is not part of any alias chain — `evals/tutoring_eval.py:_get_openai_eval_key()` and the equivalent in `evals/ragas_judge_checkpoint.py` look it up directly via `os.getenv`), so pydantic continues to read `LLM_API_KEY` from `.env` for Gemini.

*Alternatives considered (for the bug).*
- *Drop `OPENAI_API_KEY` from the `AliasChoices` and force `LLM_API_KEY` only.* Cleaner, but breaks the OpenAI-first onboarding story that motivated the alias originally. Rejected; the eval is the rare case where both keys legitimately exist in the same process, and the eval launchers can be told to use `EVAL_OPENAI_API_KEY` instead.
- *Make the eval launcher read both keys out of `.env` itself and pass each via its non-aliased name.* Already the approach for `EVAL_OPENAI_API_KEY`. Worth doing as a documented launch pattern in `evals/README.md` rather than continuing to discover it once per eval script.
- *Detect the misuse in `Settings` validation (reject a Google-shaped `LLM_API_KEY` that doesn't start with `AIza`/`AQ.`).* Tempting, but key formats change and a hard-coded prefix check is a future source of false-positive rejections. The alias-shadow case is rare enough in normal operation that a documented warning is the right granularity.
- *Surface the underlying cause through a wrapper that introspects which alias actually resolved.* Pydantic-settings doesn't expose this cleanly, and instrumenting it adds complexity for a launch-time misuse. The launch-pattern documentation route is cheaper.

*Alternatives considered (for the eval itself).*
- *Keep the original 15 hand-written local scenarios.* The local set was useful as a smoke test but is non-comparable to external benchmarks and easy to overfit to. The new `evals/tutoring_responses_checkpoint.local-source.json.bak` keeps the old run on disk in case it's needed for retrospective comparison, but the writeup will quote TutorBench numbers as the headline.
- *Include the multimodal TutorBench batches.* Possible by setting `EVAL_TUTORING_INCLUDE_MULTIMODAL=1`, but the tutor's image-handling path (image upload → Gemini vision) is not exercised by the eval harness as currently written — the multimodal scenarios would receive a textual "image unavailable" stub and the scores would conflate image-pipeline behavior with tutoring behavior. Deferred; a future eval should pass image URLs through the production materials-ingest path so the multimodal scores measure the real system.
- *Use a stronger / different judge (gpt-4o-mini, o3, Claude as judge).* gpt-4o is the standard reference for academic RAG/tutoring evals and matches RAGAS-side, which is the rationale for fixing it. A future ablation could re-score the same checkpointed tutor responses with a different judge — the per-scenario checkpoint already preserves the responses, so changing the judge is cheap.
- *Score on fewer / different dimensions.* The six dimensions (scaffolding, engagement, misconception, depth, connections, grounding) were chosen to be orthogonal-ish coverage of the pedagogy literature. Pruning to four would tighten the table but lose signal — `connections` is exactly the dimension that's separable from the others in the data, and dropping it would have hidden the only actionable weakness this run found.

*Known limitation.* The 4.70 overall mean is in the same "default high band" that cross-provider gpt-4o-as-judge tends to produce for any competent system. Read it as a *baseline to beat* in future runs (different model, different prompt, different retrieval config), not as "the tutor is near-perfect." The relative gap between `connections 4.41` and the next-lowest dimension at 4.70 is the kind of signal the eval is actually for — within-run dimensional contrast survives the judge's overall calibration drift, where absolute scores do not.

## Decision: Retrieval eval re-run at n=100 against the full 1,636-passage corpus, plus cross-eval consistency check (2026-05-18)

The label-driven retrieval eval (`evals/retrieval_eval.py`) was re-run after the 100-row BioASQ corpus was ingested. It computes recall@k, precision@k, and MRR over the 100 QA rows using the dataset's ground-truth `relevant_passage_ids`, so there is no LLM judge in the loop — only one embedding call per question against the production retriever. Unlike RAGAS and TutorBench, this run completes in ~2 minutes and produces fully deterministic numbers.

Final aggregates (n=100, corpus = 1,136 referenced + 500 distractors = 1,636 passages):

| metric | k=1 | k=3 | k=5 | k=10 |
|---|---|---|---|---|
| recall@k | 0.140 | 0.330 | 0.463 | 0.612 |
| precision@k | 0.950 | 0.903 | 0.834 | 0.641 |
| MRR | **0.965** | | | |

*Rationale (for re-running rather than reusing the prior 20-row CSV).* The previous `evals/retrieval_results.csv` was generated when pgvector held only 222 referenced passages (rows 0-19) plus 200 distractors — 422 passages total. At that scale the haystack is small enough that the retriever has an unrealistically easy time, and the metrics overstate production performance. Re-running against the 1,636-passage corpus exercises the retriever against a haystack roughly 4× larger and on 5× more queries, which is the regime the RAGAS and TutorBench runs already evaluate. With all three evals now reporting on the same 100-row slice, the writeup can present a single "eval at n=100" view across retrieval (label-based), RAG quality (LLM-judged with ground-truth references), and pedagogy (LLM-judged against expert rubrics).

*Reading the numbers (and the reason this needs to be in the writeup).* The headline is **MRR=0.965** with **precision@1=0.95**: the first relevant passage lands at rank 1 almost every time, and the top-1 hit is correct 95% of the time. The `recall@1=0.14` number looks alarming in isolation but is **structurally bounded** — each BioASQ question has many ground-truth relevant passages (`n_relevant` per question often 10-35), so recall@1 is bounded above by `1/n_relevant`, which means a perfect retriever still reads ~0.05-0.20 here. **`recall@10=0.61` is the more useful recall number**: at the production `RAG_TOP_K=4`, the retriever surfaces roughly 46% of the supporting evidence, which is consistent with RAGAS's `context_recall=0.83` (the LLM judge counts semantically related chunks as supporting even when they are not in the strict ground-truth ID set, which is the expected direction of disagreement). The precision-decay curve (`0.95 → 0.64` from k=1 to k=10) is the curve a reranker would flatten, and the reranker pluming is already configured (`RAG_RERANKER_ENABLED=false` by default, `LANGSEARCH_*` envs ready) — a follow-up ablation can flip it on and measure the lift on this same eval.

*Cross-eval consistency check.* Two independent measurements of the retrieval path agree on direction and ordering: precision@1 from the label-driven eval (0.95) and `context_precision` from RAGAS (0.85) both say the top hit is usually right; recall@10 (0.61) and `context_recall` (0.83) both say the retriever leaves real headroom, with RAGAS slightly more generous as expected. This kind of independent corroboration is the main writeup payoff of keeping all three evals — a single judge-based number is a hypothesis; a judge-based number that matches a label-based number is evidence.

*Alternatives considered.*
- *Skip the re-run and quote the prior 20-row, 422-passage numbers.* Rejected: those numbers describe a haystack 4× smaller than what the rest of the eval suite runs against, and presenting them next to the n=100 RAGAS and TutorBench tables would invite the obvious "but the retriever was tested against fewer distractors" objection. The re-run cost ~100 embedding calls — trivial against the prepaid balance.
- *Reduce `recall@1`'s prominence by reporting only recall@5/@10.* Tempting, since `recall@1=0.14` reads badly without the bounding-by-`n_relevant` context. Rejected: every retrieval eval in the literature reports recall@1 alongside higher-k versions, and silently dropping it would look like the kind of selective reporting reviewers flag. The interpretive note in the writeup is the right fix.
- *Run with `RAG_RERANKER_ENABLED=true` so the headline numbers include the reranker.* The reranker is the production *option*, not the production *default*, and switching it on for the headline conflates "what does the system do today" with "what could it do." The deferred reranker ablation is the right structure: report no-reranker headline numbers, then a separate row in the writeup showing the lift the reranker provides.
- *Add nDCG@k.* nDCG is the standard graded-relevance metric in IR, but BioASQ's labels are binary (relevant / not), so nDCG collapses to a recall-flavored summary that doesn't carry information beyond recall@k. Worth adding when an eval has graded judgments; not here.
- *Increase distractor count from 500 to e.g. 2,000.* Stresses the retriever harder and would lower precision@k. Rejected for this pass because the cross-eval consistency story relies on the corpus being the same one RAGAS and TutorBench measured against; changing the haystack now means re-running RAGAS too. Future ablation candidate.

*Known limitation.* The label-based metrics measure agreement with BioASQ's curated `relevant_passage_ids`, which are a *partial* labeling — passages not in the labeled set but still factually supportive of the answer count as misses here, even though a downstream LLM grounded on them would produce a correct answer. This is exactly why the eval is paired with RAGAS's `context_recall` (LLM-judged) rather than presented alone.
