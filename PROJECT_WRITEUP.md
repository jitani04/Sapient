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
3. ranks chunks by cosine similarity
4. limits overrepresentation from any one material
5. injects the best matches into the prompt as contextual sources

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

The tutor can generate inline quizzes during a session. Student answers are stored and evaluated server-side. Separately, the project layer can generate targeted weak-area quizzes using prior summaries and failed quiz attempts, producing a dedicated practice conversation and quiz set.

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

The second component is an *end-to-end* RAG evaluation built on Ragas. It exercises the full production stack — retrieve, build the prompt with the same `prompt_builder` used by the chat service, generate an answer through `LLMService`, then score the resulting `(question, contexts, answer, ground_truth)` tuple on `faithfulness`, `answer_relevancy`, `context_precision`, and `context_recall` using a Gemini judge. The Ragas evaluation captures behaviors that the retrieval-only evaluation cannot: whether the model hallucinates beyond the retrieved context, whether the answer is on-topic, and whether the retrieved chunks are themselves relevant rather than merely numerous. The cost of that coverage is variance — LLM-judged metrics carry the noise inherent to LLM-as-judge methodology and are interpreted as trends across a sample rather than as point estimates.

The third component is a *pedagogical helpfulness* evaluation, which is the artifact that distinguishes this system from a generic RAG application. Retrieval quality and answer faithfulness are necessary but not sufficient conditions for an effective tutor: a response can be perfectly grounded in the retrieved context and still be pedagogically poor — for instance by dumping the textbook excerpt verbatim, ignoring a misconception in the student's question, or refusing to scaffold a difficult concept. The pedagogical evaluation scores each response on six explicit dimensions — scaffolding, active engagement, misconception handling, calibrated depth, connections to prior knowledge, and source grounding — using a Gemini judge with a published rubric, run against a curated set of fifteen tutoring scenarios spanning five categories: direct questions with no embedded error, questions containing a deliberate misconception, explicit "just give me the answer" shortcut requests, vague under-specified questions, and context-aware scenarios in which the student has known weak and strong areas that the tutor is expected to leverage. The scenarios are deliberately authored at undergraduate level across biology, physics, calculus, chemistry, and computer science, so that the rubric can be applied uniformly without requiring domain-specialist judges. This third evaluation is independent of the RAG benchmark — it does not require any material to be ingested into pgvector — and is therefore the appropriate signal for changes that affect the system prompt, the tutor customization, or the model itself rather than retrieval.

A separate ingestion script (`evals/ingest_dataset.py`) populates pgvector with the benchmark corpus plus two hundred distractor passages drawn from the rest of the BioASQ corpus. The distractors make the retrieval task non-trivial: a retriever that simply returned every passage in the database would otherwise hit perfect recall vacuously. The eval data is owned by a dedicated `ragas-eval@local` user with a dedicated subject, so it is segregated from any real user data sharing the same database.

The harness is intentionally LLM-budget-aware. The retrieval evaluation completes in roughly thirty seconds for twenty questions and consumes only one embedding call per question. The Ragas evaluation runs serially with configurable inter-call pacing (twenty seconds by default) and supports checkpoint resume, so a partial run can be continued without re-paying for answers already generated. Both evaluations write per-row CSV outputs alongside their aggregated stdout summaries, so results can be diffed across commits as a regression signal. Run artifacts (corpus map, checkpoints, CSV outputs) are deliberately gitignored: the source of truth is the dataset and the code, not the regenerable output.

*Limitations.* The biomedical benchmark exercises retrieval and faithfulness but does not measure educational quality; the pedagogical evaluation closes that gap for response-level behaviors but introduces its own caveats. Fifteen scenarios are sufficient to detect category-level regressions but too small to give tight confidence intervals on a single dimension; that limit is intentional, both to keep the LLM-judge cost bounded and because the scenarios are hand-authored. The judge is itself a Gemini model, so its scores carry the variance and possible self-preferential bias inherent to LLM-as-judge methodology; running the same scenarios under a different judge family would be the obvious robustness check. Finally, the `context_aware` scenarios assume that the application can inject a student's weak and strong areas into the prompt — a behavior the production prompt builder does not yet implement systematically — so those scores effectively measure whether the model would adapt *given* such context, which is itself a useful signal for prioritizing future product work. Expanding both the dataset (more scenarios, more domains, real student transcripts where ethically permissible) and the judge ensemble is the natural next piece of work for a follow-up project.

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

## Decision: Ragas + Gemini judge for end-to-end RAG and pedagogical evaluation (2026-05-12)

The evaluation harness in `evals/` uses Ragas to score the end-to-end RAG pipeline on `faithfulness`, `answer_relevancy`, `context_precision`, and `context_recall`, with Google Gemini as the judge model. A second, project-specific evaluation uses the same Gemini judge with a hand-authored six-dimension rubric (scaffolding, active engagement, misconception handling, calibrated depth, prior-knowledge connections, source grounding) over fifteen tutoring scenarios. Deterministic retrieval metrics (`recall@k`, `precision@k`, MRR) are computed against ground-truth labels without an LLM judge.

*Rationale.* Ragas ships the metric set that is most directly aligned with the failure modes a tutoring RAG system actually produces — hallucination beyond the retrieved context, off-topic answers, and retrieval that is numerous but irrelevant — and it does so against the existing `(question, contexts, answer, ground_truth)` interface that the production retriever already emits. The Gemini judge keeps the evaluation in the same model family as the tutor, which removes one source of cross-vendor variance when interpreting deltas across commits.

*Alternatives considered.*
- *DeepEval / `deepeval`.* Ships a similar metric surface (faithfulness, answer-relevancy, hallucination, bias) with a pytest-style harness. Rejected because its metrics are tuned for general LLM-app testing rather than RAG specifically, and its tighter coupling to its own dataset format would have meant rewriting the `(question, ground_truth_answer, relevant_passage_ids)` schema that `rag-mini-bioasq` already provides.
- *TruLens.* Strong on observability and feedback functions, oriented toward production tracing. Rejected because the eval harness is run offline against a fixed dataset, not against live traffic; the tracing surface would be unused and the metric set is less RAG-specific than Ragas.
- *LangSmith evaluators.* Tight integration with LangChain (which this project already uses for tutor generation) and good UI for inspecting per-row results. Rejected because it introduces a hosted-service dependency and an extra account/SDK surface for a metric set that Ragas implements offline without external state.
- *ARES / RAGAs-style learned judges.* Higher-fidelity per-metric judges fine-tuned on retrieval-augmented QA. Rejected as out of scope for this iteration — the cost of training or hosting a judge model outweighs the marginal accuracy gain at the current dataset size.
- *Custom rubric prompts only, no Ragas.* The pedagogical evaluation already takes this shape because no off-the-shelf framework scores tutoring behavior. Rejected as a *replacement* for Ragas on the RAG side, because rewriting `faithfulness` and `context_precision` prompts in-house gives up an externally-audited baseline for no architectural benefit.
- *Judge ensemble (Gemini + GPT-4o + Claude).* Would mitigate single-judge self-preferential bias. Acknowledged in the limitations section but deferred — the current single-judge configuration is already useful for trend detection, and adding two more providers triples the LLM cost and the failure-mode surface per run.

## Decision: `rag-mini-bioasq` as the RAG benchmark corpus (2026-05-12)

The retrieval and Ragas evaluations both run against `rag-datasets/rag-mini-bioasq` (4.7K biomedical passages with ground-truth `relevant_passage_ids` per question), supplemented with two hundred distractor passages drawn from the rest of the BioASQ corpus and segregated to a dedicated `ragas-eval@local` user with its own subject.

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
