# Sapient: A Retrieval-Augmented Intelligent Tutoring System

**Technical Research Report**
**Last updated:** May 20, 2026

## Abstract

Sapient is a full-stack intelligent tutoring system designed to support active study rather than one-off question answering. The platform combines conversational tutoring, retrieval-augmented generation (RAG) over student-provided materials, inline formative assessment, spaced-repetition review, Bayesian Knowledge Tracing (BKT), assignment-aware reminders, feedback-driven personalization, and multimodal interaction through diagrams, images, resources, and voice. The system is implemented with a FastAPI backend, a React frontend, PostgreSQL with `pgvector`, S3-compatible object storage, Google Gemini as the default tutor model, optional Anthropic/OpenAI chat model selection, and OpenAI speech services for transcription and audio playback. Its core architectural goal is to turn tutoring sessions into durable learning artifacts: conversations generate quizzes, key ideas, summaries, flashcards, resources, mastery estimates, and project-level progress signals that can be revisited over time. This report presents the motivation, design, implementation, and current limitations of the system as implemented in the repository as of May 20, 2026.

**Keywords:** intelligent tutoring systems, retrieval-augmented generation, spaced repetition, educational AI, FastAPI, React, pgvector

## 1. Introduction

Many AI learning tools behave like generic chat assistants: they answer questions quickly, but they do not preserve learning structure, track misconceptions, or build a usable study history. Sapient was built to address that gap. The system treats tutoring as a stateful workflow centered on subjects, study sessions, and review artifacts rather than as a sequence of disconnected prompts.

The project is designed around three assumptions:

1. Students benefit more from guided learning than direct answer delivery.
2. Study sessions are more valuable when they produce reusable artifacts such as notes, quizzes, and review prompts.
3. Answers are stronger when grounded in the learner's own uploaded materials instead of relying only on the base model.

This report is organized around three research and engineering questions:

- **RQ1:** How can an LLM tutoring system convert transient chat interactions into durable learning artifacts?
- **RQ2:** How can the system preserve the convenience of conversational AI while encouraging active learning, retrieval practice, and source-grounded study?
- **RQ3:** What software-development practices are effective when building a full-stack AI product primarily with AI-assisted development tools?

The report makes three contributions. First, it documents a deployable architecture for a retrieval-augmented tutoring system that persists learning artifacts beyond the chat turn. Second, it describes how feedback, BKT mastery estimates, assignments, and lecture mode can be connected into one study workflow. Third, it records a practical AI-assisted development methodology for building and evaluating a full-stack educational AI system under limited time and budget constraints.

## 2. Background and Motivation

This project addresses a practical study problem: how to provide personalized AI tutoring that remains grounded, organized, and useful across multiple sessions.

The product motivation came from a mismatch between what general-purpose assistants are good at and what students often need when they are trying to learn. ChatGPT, Claude, and similar tools can produce fluent answers quickly, but speed is not the same as learning. The MIT Media Lab preprint *Your Brain on ChatGPT* [1] made this tension concrete: in an EEG-based essay-writing study, participants using an LLM showed weaker brain connectivity than the search-engine and brain-only groups, lower ownership of their essays, and difficulty accurately quoting their own work. The study is a preprint and should not be overgeneralized to all learning tasks, but it usefully frames the risk that students can outsource the very cognitive work that helps them learn.

That concern is also consistent with newer retention-focused work. A randomized controlled trial with undergraduates found lower delayed knowledge retention for students who used ChatGPT as a study aid than for students who used traditional study methods [2]. The point is not that AI should be removed from education; it is that the interaction design matters. A tutor that immediately writes the answer for the student may be efficient in the short term while weakening the effortful retrieval, explanation, and correction loops that durable learning depends on.

To ground the product direction, the project used a 13-question formative survey about students' experiences using AI for learning, followed by interviews with the key user group: students already using AI tools for coursework, studying, or project work. The raw survey responses are not stored in this repository, so the conclusions are recorded here as design takeaways rather than statistical claims. The main themes were:

- students value AI for fast explanations, examples, and debugging their confusion
- students do not consistently trust unsupported answers and want visible sources
- students often leave a chat without a durable study artifact they can review later
- students want the system to quiz them, summarize what mattered, and remember weak areas instead of only answering the current prompt
- students prefer control over study mode: quick chat when stuck, guided lecture when they want structure, and review tools when preparing for exams

One early failure mode in Sapient illustrated the same point. The original tutor prompt over-applied Socratic method: when asked direct questions such as "what are the main principles of UI design?", it often answered with a counter-question instead of teaching. That was pedagogically poor because the learner had not yet received enough material to reason from. The system prompt was therefore changed to an explain-first pattern: define the core ideas, give examples, then check understanding. Socratic questioning remains useful, but only after the student has enough context to engage productively.

## 3. Methodology and Design Requirements

The project follows a design-science framing: Sapient is treated as an implemented artifact whose value is assessed through the requirements it satisfies, the architectural trade-offs it makes, and the evaluation harnesses used to measure retrieval quality, answer faithfulness, and tutoring behavior. Requirements were derived from three sources: prior research on passive AI use and knowledge retention, formative user research with students who already use AI tools for learning, and failures observed during prototype testing.

The main design requirements derived from the literature motivation, survey themes, interviews, and early prototype failures are:

- provide subject-based conversational tutoring
- ground tutor responses in uploaded study materials and explicit web searches
- generate formative checks during study, not only after it
- preserve important concepts as notes, flashcards, diagrams, images, and resource cards
- identify weak areas with both quiz history and BKT mastery estimates
- connect learning priorities to deadlines through assignments and calendar feeds
- support multiple interaction modes, including voice and lecture-style learning

## 4. System Overview

Sapient is organized around **subjects** and **study sessions**.

- A **subject** acts as a project container with a level, goals, materials, cover image, mind map, and progress indicators.
- A **study session** is a conversation between the student and the tutor.
- During a session, the tutor can produce quizzes, key ideas, summaries, citations, Mermaid diagrams, real image artifacts, web sources, and recommended resources.
- After a session, the student can revisit notes, flashcards, resources, search results, summaries, due assignments, smart reminders, and weak-area practice.

This structure gives the application a longer-lived educational memory than a standard chatbot interface.

## 5. Technical Architecture

### 5.1 Frontend

The frontend is implemented in React 19 with TypeScript and Vite. It is responsible for:

- authentication-aware routing
- project and session navigation
- streamed chat rendering via Server-Sent Events
- file upload orchestration
- quiz, note, and flashcard interfaces
- project dashboards and history views
- assignments, calendar reminders, and resource-card views
- Mermaid diagram rendering and real-image artifact display
- lecture mode, microphone input, and streamed speech playback

TanStack React Query is used for client-server data synchronization, and React Router handles protected navigation across the app.

Styling uses Tailwind CSS v4 via the `@tailwindcss/vite` plugin, with design tokens (brand palette, typography, shadows, sidebar width) declared in a `@theme` block so they are exposed both as Tailwind utility classes (`bg-accent`, `text-main`, `font-serif`, `shadow-panel`) and as standard CSS custom properties for any hand-written rules. Dark mode is bound to the existing `data-theme="dark"` attribute on `<html>` via Tailwind's `@custom-variant`, so the runtime theme toggle in `theme.ts` continues to drive both the legacy CSS and Tailwind's `dark:` utilities from a single source of truth. The migration from a single 9,000-line `styles.css` is incremental: the existing class-based rules continue to work during the cutover and are replaced component-by-component. Alternatives considered were (1) CSS Modules, which provide scoping but do not solve the design-token or inline-style sprawl that motivated the change; (2) vanilla-extract, which offers type-safe CSS-in-TS but has a smaller ecosystem and heavier authoring ceremony; and (3) runtime CSS-in-JS libraries such as styled-components or Emotion, which were rejected because the broader React ecosystem has moved away from runtime CSS-in-JS in the React Server Components era due to its runtime cost and serialization constraints. Tailwind v4 was selected because it is the prevailing industry default for new React + Vite codebases, has zero runtime cost, performs build-time tree-shaking of unused utilities, and co-locates styling with component code while still allowing design tokens to be defined and audited in a single CSS file.

### 5.2 Backend

The backend is implemented in FastAPI with SQLAlchemy 2.0 async ORM and Alembic migrations. It provides:

- JWT-based authentication
- Google OAuth sign-in verification
- conversation and project APIs
- streaming tutoring responses
- material ingestion and retrieval
- search, summaries, quizzes, flashcards, resources, assignments, and progress aggregation
- observability, security headers, and per-bucket rate limiting

The backend also controls the structured tutoring actions that let the model create persistent learning artifacts. The current model registry exposes Gemini 2.5 Flash, Claude Sonnet 4.6, and GPT-4o as selectable chat models, while Gemini remains the default configured model.

### 5.3 Database and Storage

The system uses PostgreSQL for relational data and `pgvector` for semantic retrieval over uploaded materials and derived preference memories. File uploads and uploaded subject cover images are stored in S3-compatible object storage rather than directly in the database or application filesystem. The database stores metadata and object keys, while the object store holds the original files.

## 6. AI and Pedagogical Design

### 6.1 Tutor generation

Tutor responses are generated through a LangChain-backed model abstraction. Google Gemini 2.5 Flash is the default model because Google's current Gemini API documentation describes it as the price/performance-oriented 2.5 model and lists support for function calling, structured outputs, caching, search grounding, and URL context. The implementation can also route selected conversations to Anthropic or OpenAI chat models when the required provider API keys are configured.

Each chat request is composed from:

- a system prompt
- subject context when available
- user-specific tutor customization settings
- feedback-derived preference summaries and retrieved preference memories when enabled
- prior conversation history
- retrieved study-material context when available
- BKT mastery signals from the current subject when available

This design allows the tutor to adapt both to the learner and to the current subject.

### 6.2 Retrieval-augmented generation

Uploaded PDF, TXT, and Markdown files are processed into semantic chunks. Each chunk is embedded and stored in the `material_chunks` table with its vector representation. At chat time, the system:

1. embeds the user's query
2. filters materials by ownership and optional subject
3. over-fetches candidate chunks by cosine similarity
4. optionally reranks those candidates with a cross-encoder reranker
5. limits overrepresentation from any one material
6. injects the best matches into the prompt as contextual sources

The retrieved chunks are also streamed back to the frontend as citation metadata so the interface can display sources to the student.

The optional reranking step uses LangSearch's reranker API when `RAG_RERANKER_ENABLED=true` and `LANGSEARCH_API_KEY` is configured. A local cross-encoder reranker was considered, but it would add model-hosting overhead before the project had enough retrieval traffic to justify it. Increasing `RAG_TOP_K` alone was also rejected because it increases prompt cost and distractor context rather than improving ranking quality. Separately, web search is exposed as an explicit tutor tool for current facts, outside references, or student-requested searches, so public-web claims can be surfaced as web-source cards rather than being blended invisibly into the tutor's base-model knowledge.

### 6.3 Structured tutoring actions

The tutoring layer exposes five main structured actions to the model:

- `generate_quiz`
- `save_key_idea`
- `create_diagram`
- `find_image`
- `find_resource`

The web-search tool is added when configured. These actions are important because they let the tutor produce data objects, not just text. Quizzes, key ideas, and recommended resources are persisted to the database. Diagrams are streamed to the client as Mermaid source for immediate rendering. Real image artifacts and web-source results are streamed as attributed cards so the user can distinguish uploaded-material citations, public web sources, and visual references.

## 7. Learning and Product Features

### 7.1 Personalized tutoring

Users can customize tutor name, tone, style, and freeform instructions. These settings are appended to the tutor prompt so the teaching style can vary by learner preference without changing the rest of the system design.

### 7.2 Session-based chat with streaming output

The main tutor interface uses SSE streaming. The frontend receives incremental assistant tokens and structured events such as:

- `start`
- `token`
- `sources`
- `web_sources`
- `quiz`
- `key_idea`
- `diagram`
- `image`
- `resource`
- `conversation_title`
- `end`
- `error`

This gives the product a more interactive study workflow than a standard request-response chat.

### 7.3 Material upload, preview, and grounding

Material upload is implemented as a presigned direct-to-object-storage flow:

1. the frontend requests a presigned URL
2. the browser uploads the file directly
3. the backend records the material and starts ingestion
4. the material is marked `processing`, `ready`, or `failed`

Ready materials can be previewed through a signed GET URL and used for retrieval grounding during chat.

### 7.4 Inline quizzes and weak-area practice

The tutor can generate inline quizzes during a session. Student answers are stored and evaluated server-side. Separately, the project layer can generate targeted weak-area quizzes using prior summaries, failed quiz attempts, and concept mastery signals, producing a dedicated practice conversation and quiz set.

Quiz attempts also feed a Bayesian Knowledge Tracing (BKT) model. Each observed answer updates a per-concept mastery probability using the standard prior, learn, guess, and slip parameters. The resulting mastery estimate is stored on the subject profile and used by the Learning Map and tutor prompt to distinguish topics that are mastered, in progress, or likely to need review. BKT was chosen over a simple percent-correct score because it models hidden mastery rather than only observed accuracy; Deep Knowledge Tracing was considered but rejected for this project because it requires substantially more attempt-sequence data and is harder to explain in the UI.

### 7.5 Key ideas and notes

Important concepts can be saved as key ideas during a tutoring session. These notes appear in the session artifact panel and on the dedicated notes page, where they can be filtered, searched, edited, deleted, or promoted for immediate review. The current implementation also supports manual note creation and saving selected assistant text, Mermaid diagrams, or image cards into the same `key_ideas` table with structured artifact metadata.

### 7.6 Spaced-repetition flashcards

Key ideas double as flashcards using SM-2 scheduling fields. The system tracks repetition count, interval, ease factor, and next due date, allowing notes generated during tutoring or manually authored by the student to become part of a long-term revision workflow. The subject page can also generate fresh flashcards on demand from the subject profile and recent notes.

### 7.7 Session summaries and project progress

Session summaries are generated on demand and cached on the conversation. These summaries capture covered topics, struggled concepts, key concepts, and next-review suggestions. Project progress is then computed from the aggregate of sessions, summaries, quiz attempts, and BKT knowledge-state entries.

### 7.8 Mind maps and diagrams

The system supports three different visual representations:

- **session diagrams**, which are streamed during chat as Mermaid source and rendered immediately in the UI
- **session images**, which are streamed during chat as attributed image artifacts when a real photo/reference image is more useful than a generated diagram
- **project mind maps**, which are generated through a dedicated endpoint and stored on the `project_profiles` table as JSON

This distinction matters because diagrams and images are ephemeral session artifacts, while mind maps are subject-level persistent planning artifacts. Diagrams are best for abstract structure, flows, and relationships; real images are best for concrete visual references such as organisms, places, lab setups, physical objects, or historical artifacts. Mermaid replaced an earlier Excalidraw-style JSON approach because the model could reliably generate a small diagram DSL, while raw Excalidraw element graphs frequently produced malformed arrows, bindings, and missing relationships.

### 7.9 Voice and lecture mode

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

Lecture mode buffers streamed tutor text into shorter audio chunks and plays them sequentially while collecting notes, diagrams, real images, and source/resource cards in a live notebook view. The current TTS route streams MP3 bytes from OpenAI through FastAPI's `StreamingResponse`, and the frontend uses MediaSource Extensions where supported so playback can begin before the entire spoken chunk has been buffered. A fully buffered audio response was simpler but added avoidable first-audio latency; SSE with base64 audio chunks was also rejected because it adds bandwidth overhead without improving playback control. The voice layer is intentionally interruptible: when the learner starts speaking, the current stream/audio queue is cancelled, the utterance is transcribed, and a new tutor turn is started. This makes lecture mode behave like a real-time tutoring conversation rather than a passive audio player.

Lecture mode is also a product response to the passive-chat problem described earlier in this report. Instead of treating learning as a blank text box, it gives the student a guided explanation surface with visible source cards, live notes, generated diagrams/images, pace controls, playback controls, and two high-frequency intervention buttons: "check me" and "show visually." Lecture conversations are persisted as conversation rows so the same chat, retrieval, quiz, key-idea, and artifact infrastructure can be reused, but they are marked with `is_lecture=true` and hidden from normal sidebar/history listings. A fully ephemeral lecture mode was considered, but it would have broken artifact persistence because chat streaming, key ideas, diagrams, and audio all rely on a conversation identifier. The chosen design keeps lecture mode durable enough for artifact storage without turning every short guided explanation into long-term chat clutter.

### 7.10 Search and review

The search interface queries across:

- prior session messages
- saved notes
- uploaded material chunks

This gives the learner a way to recover earlier ideas and study context without manually opening each session.

### 7.11 Assignments, resources, and feedback personalization

Sapient now includes three study-management features beyond the original tutoring loop:

- **Assignments and calendar feeds.** Students can create manual assignments or import iCal/webcal feeds such as Canvas calendars. Smart reminders combine due-date urgency with BKT mastery signals and learning-map review states. The iCal/webcal route was preferred over a Canvas REST API integration because it works across institutions without per-school OAuth setup.
- **External resources.** The tutor can recommend a YouTube video or web article as a structured resource card. Recommended resources are saved per subject and can be deleted by the user.
- **Message feedback.** Students can rate assistant messages with thumbs up/down, optional explanation text, and corrections. The backend stores feedback analytics and can derive user-level preference summaries and vector-retrieved preference memories when the corresponding feature flags are enabled.

The feedback path is intentionally more conservative than a simple "thumbs down means never do this again" rule. A rating is saved synchronously on `message_feedback` with the assistant message, prior user turn, prompt version, model name, latency, retrieved chunk IDs, and tool trace. If the student includes written feedback or a correction, a background enrichment task asks the LLM to classify the reason category, summarize the complaint, and extract a safe future-facing preference only when the signal is stable enough. The classifier is explicitly told not to create preferences that undermine correctness or tutoring value, such as "always give me the final answer" or "agree with me even when I am wrong."

When `ENABLE_FEEDBACK_PREFERENCES=true`, thumbs-down feedback with text can update `users.preference_summary`, a compact summary of stable communication and learning-strategy preferences. When `ENABLE_PREFERENCE_MEMORY=true`, safe derived preferences are also embedded into `preference_memories` with the feedback category, task type, rating, and stability. On later chat turns, the backend retrieves the user's preference summary plus the top relevant preference memories for the current message and subject. `prompt_builder` injects them into the system prompt under "Student preferences from prior feedback" and "Relevant prior feedback for this kind of task," while also reminding the tutor that preferences must not override correctness, safety, or the learning objective. In practice, this lets Sapient adapt to repeated feedback such as "be more concise," "use more examples before quizzing me," or "cite sources when using my uploaded notes," without letting one frustrated dislike corrupt the tutor's behavior.

### 7.12 Saved lecture pages

During a lecture, the tutor builds a notebook page of key ideas, generated Mermaid diagrams, and retrieved images. Earlier in development, the only persistence path was the `save_key_idea` tool, which stores each concept as a `key_ideas` row tied to a conversation and subject. In practice students reported that nothing from a History (or similar) lecture appeared in the subject's Notes tab afterwards, because individual key-idea rows did not reconstruct the page they had actually seen — diagrams and images were never linked back, and the ordering across the timeline was lost.

Two persistence approaches were considered:

- **Reuse `key_ideas` rows.** The schema already supports `artifact_type` of "text", "diagram", or "image", so each timeline entry could become its own row. This requires no migration but conflates per-concept review notes with full lecture transcripts, makes "view the whole lecture I just had" expensive to reconstruct (multiple queries grouped by conversation and ordered by created_at), and complicates a single-document export.
- **New `lecture_notes` table snapshotting the timeline.** One row per lecture session storing the ordered timeline as a JSON column. This keeps the lecture page coherent for both viewing and download, and keeps the existing `key_ideas` table focused on spaced-repetition review.

The new-table approach was adopted (migration `20260520_000027_add_lecture_notes.py`). The lecture overlay auto-saves the timeline on **End session**, defaulting the title to `<first concept> — <date>` or `<subject> lecture — <date>` when no key idea was saved. Saved pages appear in a dedicated **Lectures** tab on the subject page (separate from **Notes**, which remains focused on short concept rows for spaced-repetition review) as cards listing title, date, and entry count. Opening a card renders a modal viewer that re-runs Mermaid for diagrams and re-uses `ImageArtifactCard` for images, ensuring fidelity to the original notebook.

For download, three options were considered: client-side Markdown export, a server-side PDF render, and an in-browser print-to-PDF flow. Markdown was rejected because Mermaid diagrams and image artifacts do not render in most Markdown readers without extra tooling, defeating "view the lecture as I saw it." A server-side PDF pipeline (e.g. headless Chromium or `weasyprint`) was rejected because it adds a significant runtime dependency for a feature whose audience is a single student and where rendering quality is not the bottleneck. The in-browser `window.print()` approach was chosen: a `@media print` stylesheet hides chrome and lets the user save to PDF via the browser's native print dialog. This adds no dependencies, works in every modern browser, and produces a PDF that matches the on-screen page including rendered Mermaid SVG.

### 7.13 Flashcard rating UI: three friendly buttons over SM-2 labels

The flashcard review screen originally exposed the four canonical SM-2 grades — Again, Hard, Good, Easy — with each button labelled with the next interval ("now", "tomorrow", ...). This mirrors Anki's interface, but in user feedback the four-option spectrum and the SM-2 jargon were reported as unfriendly: students asked what "Hard" meant relative to "Good," and the "tomorrow / tomorrow / tomorrow" subtitles in early reviews offered no real distinction.

Three redesigns were considered:

- **Two buttons** ("Didn't know" / "Got it"), mapping to qualities 1 and 4. Simplest, but collapses the "I struggled but got it" signal, which is the most informative point for ease-factor calibration in SM-2.
- **Three buttons** ("Forgot" / "Sort of" / "Knew it"), mapping to qualities 1, 3, and 5. Preserves the failure / borderline / confident distinction that actually moves the ease factor without forcing the student to differentiate "Good" from "Easy."
- **Keep four buttons with plainer copy.** Lower cognitive load only marginally and still asks the student to make a four-way comparative judgment after every card.

The three-button design was adopted. Quality scores 1/3/5 are still passed to the existing SM-2 update on the backend (no schema or scheduler change), so the spaced-repetition behavior is unchanged; only the UI surface narrows. The interval preview under each button still reads from `sr_interval`, `sr_repetitions`, and `sr_ease_factor` so students can see when the card will return.

## 8. Data Model

The major persisted entities are:

- `users`: authentication, onboarding, and tutor preferences
- `conversations`: subject-scoped study sessions
- `messages`: user and assistant turns within a session
- `materials`: uploaded files and ingestion status
- `material_chunks`: extracted chunk text plus embeddings
- `quizzes`: tutor-generated quiz questions
- `quiz_attempts`: student responses and correctness
- `key_ideas`: saved notes, artifact metadata, and flashcard scheduling data
- `project_profiles`: subject-level settings, cover image metadata, mind maps, learning-map progress, and BKT knowledge state
- `resources`: tutor-recommended videos and articles saved by subject, conversation, and optional assistant message
- `assignments`: manual or imported deadlines with completion state
- `calendar_feeds`: iCal/webcal feed definitions and sync metadata
- `message_feedback`: per-message ratings, corrections, categorization, and prompt/model metadata
- `preference_memories`: vector-searchable derived preference memories when personalization memory is enabled

This schema supports both short-term tutoring interactions and long-term review behavior.

## 9. Deployment and Operational Design

The deployment shape is a Dockerized FastAPI backend and a static React build, both hosted on Fly.io, paired with managed Postgres on Neon and S3-compatible object storage on Cloudflare R2. External AI services (Gemini, optional Anthropic/OpenAI chat models, OpenAI speech APIs, Google OAuth, Pexels/Wikimedia image search, LangSearch search/reranking, and YouTube resource search) are accessed over the public internet via API keys held as platform secrets. GitHub Actions now runs backend tests, builds the frontend, and deploys both Fly apps on pushes to `main`. This section records the alternatives that were considered for each component and the reasoning that produced the current design.

### 9.1 Object storage: Cloudflare R2 over AWS S3

Earlier prototypes wrote uploaded materials to the application server's local filesystem. That approach broke as soon as the server became containerized: ephemeral disks lose state on restart, and horizontal scaling is impossible because each instance can only see its own files. The system was therefore migrated to S3-compatible object storage with two providers under consideration:

- **AWS S3.** The default industry choice and the most mature object storage product, but its egress pricing of $0.09 per gigabyte makes it expensive for an application that re-reads uploaded files for retrieval, preview, and download.
- **Cloudflare R2.** S3-compatible at the API level, with comparable storage pricing and **zero egress fees**. The free tier (10 GB storage, 1 million Class A operations, 10 million Class B operations per month) is permanent rather than time-limited.

R2 was chosen because the application's workload is read-heavy on uploaded materials: every chat turn that triggers retrieval reads chunk data, and material previews and downloads pull entire files. The egress savings dominate the comparison for any non-trivial usage. The trade-off is a slightly less mature ecosystem (some advanced S3 features like Object Lambda or Glacier-class lifecycle rules are unavailable on R2), none of which are required for the current feature set.

### 9.2 Upload flow: presigned PUT URLs

A second decision concerned how the browser delivers files to object storage. Two patterns were considered:

- **Proxy-through-API.** The browser uploads to the FastAPI server, which then writes to object storage. This keeps the existing endpoint shape but doubles the bandwidth, holds large files in backend memory, and ties upload throughput to backend container resources.
- **Direct browser-to-storage uploads via presigned URLs.** The frontend requests a short-lived signed URL from the backend, uploads the file directly to the bucket, then notifies the backend to record the resulting object key.

The presigned approach was adopted because it keeps the application servers stateless with respect to file payloads, removes a memory and bandwidth bottleneck on the backend, and follows the standard production pattern for browser-uploaded user content. The cost is a more involved client flow (presign → PUT → confirm) and a CORS configuration on the bucket. Material preview is implemented symmetrically with presigned GET URLs and a forced inline `Content-Disposition`, so previews render in-browser without proxying bytes through the backend.

### 9.3 Database: Neon over Supabase, Railway, RDS, and self-hosted Postgres

The application requires PostgreSQL with the `pgvector` extension. The shortlist of providers that meet that requirement on a sustainable free or low-cost tier was:

- **Neon.** Serverless Postgres with a permanent free tier (0.5 GB storage), built-in `pgvector`, automatic scale-to-zero, and database branching for development. Idle databases cold-start in roughly one second on the next request.
- **Supabase.** Generous free tier (500 MB) with `pgvector` available, but free projects are paused after one week of inactivity and must be manually resumed. Bundles authentication, realtime, and storage products that the system already implements internally and would not use.
- **Railway.** Solid developer experience, but the free trial is credit-based rather than permanent. Steady-state cost is roughly 5 USD per month.
- **AWS RDS.** Mature and feature-rich, but starts at roughly 15 USD per month, requires Postgres 15.2+ on specific instance types to enable `pgvector`, and introduces operational complexity disproportionate to current needs.
- **Self-hosted Postgres on a Fly volume.** Free in raw compute terms but introduces ownership of backups, upgrades, and pgvector installation. For this project the operational overhead outweighs the cost savings.

Neon was chosen because the application has irregular usage patterns: it should cost nothing during long idle periods and should not require manual unpausing after a week of inactivity. The cold-start penalty is imperceptible relative to LLM and embedding API latency, and the database branching feature gives a low-cost path to test migrations against realistic data.

### 9.4 Compute platform: Fly.io for backend and frontend

For application hosting, four platforms were realistic for a single-developer free-tier project:

- **Fly.io.** Container-native, supports long-lived SSE connections, and runs both backend and static frontend on the same platform with multiple regions including `lax`. Fly removed its permanent free tier in October 2024; new accounts now receive trial credit, after which usage is billed per-second. Because the deployment configures `auto_stop_machines = "stop"`, idle machines hibernate and are not billed, so steady-state cost for a low-traffic application is typically a small fraction of full uptime pricing.
- **Google Cloud Run.** Container-native with a permanent free tier (two million requests and 360,000 GB-seconds of memory per month). Scales to zero with cold starts of one to three seconds. SSE works within Cloud Run's request timeout limits. A viable always-free alternative if predictable-zero billing matters more than developer experience.
- **Render.** Simplest UX, but the free web service spins down after 15 minutes of idle time, and the free Postgres tier expires after 90 days, forcing a separate Neon dependency anyway.
- **Vercel + Fly.** Excellent frontend developer experience and edge CDN distribution, but the frontend and backend live on different domains, which complicates CORS and OAuth configuration.
- **Self-hosted VPS.** Cheapest at scale, but requires managing TLS, OS updates, and deploys manually. Not appropriate as the first deployment.

Fly.io was chosen because it consolidates backend and frontend hosting on one platform, supports the long-lived SSE connections required by the chat endpoint without proxy buffering surprises, and can be operated entirely from the command line with reproducible Dockerfiles. With `auto_stop_machines` enabled, the expected steady-state cost for this workload is roughly one to three USD per month, well within the cost envelope of a single-developer project. Cloud Run remains a reasonable migration target if the steady-state cost ever becomes a concern, since the application's container is portable across both platforms with no code changes. The deployment shape is two Fly applications: the backend serves the FastAPI app on internal port 8000, and the frontend serves the Vite-built static bundle through `nginx` on port 80. The frontend calls the backend over the public internet, so cross-origin requests are governed by the `CORS_ALLOW_ORIGINS` setting on the backend rather than by an internal proxy.

Current Fly documentation confirms that stopped Machines are still billed for their root filesystem but not normal compute, and the autostop/autostart configuration remains the intended mechanism for hibernating low-traffic apps. That matches the repository's deployment posture: low idle cost is an operational assumption, but it is not the same thing as a permanent free tier.

### 9.5 Product name and public URL

The product is named **Sapient**, drawn from the Latin *sapere*, meaning *to know* or *to be wise*. The term refers in cognitive science to the capacity for conscious, deliberate reasoning that distinguishes thinking minds from mere intelligence, which directly aligns with the system's tutoring goal of building durable, reflective knowledge rather than surfacing one-shot answers.

The public URL is the Fly-provided subdomain, with the frontend at `https://sapient.fly.dev` and the backend at `https://sapient-api.fly.dev`. A custom domain was considered and deferred. The relevant trade-offs were:

- **Custom domain (e.g., `sapient.com`).** More polished for a public-facing product, future-proofs branding regardless of host changes, and supports a separation between marketing site at the apex and application at a subdomain. Costs roughly ten USD per year and requires DNS configuration alongside TLS certificate provisioning on Fly.
- **Fly-provided subdomain.** Costs nothing, requires no DNS work, and inherits Fly's TLS automatically. The application's branding still appears in the URL because the Fly app names contain the product name. Limitations are a less polished URL and dependence on Fly's continued operation of the `fly.dev` namespace.

The Fly-provided subdomain was chosen because the application is currently a single-developer project where the additional polish of a custom domain is not yet necessary. The deployment is structured so that adding a custom domain later is a cosmetic change rather than a structural one: it requires running `fly certs add` on each app, adding DNS records, updating the `CORS_ALLOW_ORIGINS` setting on the backend, the `VITE_API_BASE_URL` build argument on the frontend, the R2 bucket CORS policy, and the Google OAuth authorized origins. None of those changes touch application code.

### 9.6 Regional placement

The end-to-end latency profile of a tutoring request is dominated by two hops: the user-to-frontend hop, which is bounded by the user's connectivity, and the backend-to-database hop, which occurs on every request and often involves multiple round-trips per query. To minimize the second hop, the compute and database regions are aligned on the United States West Coast.

The chosen regions are Fly.io `lax` (Los Angeles) for both backend and frontend, Cloudflare R2 in the WNAM (Western North America) location, and Neon in `us-west-2` (Oregon). Neon does not offer a Los Angeles region, so Oregon is the closest available choice and yields a backend-to-database round-trip in the low tens of milliseconds. This places all three persistent components within the same broad geography, keeping per-request overhead low for a developer based in Los Angeles while preserving acceptable latency for users elsewhere on the West Coast and in the western United States.

### 9.7 Current external-service notes

Several external-service choices are time-sensitive, so the report was checked against current vendor documentation in May 2026:

- Google's [Gemini API model documentation](https://ai.google.dev/gemini-api/docs/models/gemini) lists `gemini-2.5-flash` with function calling, structured outputs, search grounding, URL context, caching, and batch support, which fits Sapient's tool-calling tutor design.
- OpenAI's [text-to-speech documentation](https://platform.openai.com/docs/guides/text-to-speech) now positions `gpt-4o-mini-tts` as the newest and most reliable TTS model for intelligent realtime applications, while [`tts-1-hd`](https://platform.openai.com/docs/models/tts-1-hd) remains available as a higher-quality legacy Speech API model. Sapient currently uses `tts-1-hd`, so a future migration to `gpt-4o-mini-tts` is a relevant latency and controllability upgrade path.
- OpenAI's [speech-to-text documentation](https://platform.openai.com/docs/guides/speech-to-text) now lists `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and `gpt-4o-transcribe-diarize` alongside `whisper-1`. Sapient currently uses `whisper-1`; upgrading would be a targeted improvement rather than a required architectural change because the `/stt` route already abstracts transcription behind one backend endpoint.
- Cloudflare [R2 documentation](https://developers.cloudflare.com/r2/how-r2-works/) and [R2 pricing](https://developers.cloudflare.com/r2/pricing/) still describe R2 as S3-compatible object storage with no direct data-transfer egress charges. This continues to support the R2 decision for previewing and re-reading uploaded study materials, though operations are still billable beyond the free tier.
- Fly.io [pricing](https://fly.io/docs/about/pricing/) and [autostop/autostart documentation](https://fly.io/docs/launch/autostop-autostart/) confirm that the app's `auto_stop_machines = "stop"` posture lowers idle compute spend but does not eliminate all costs.

## 10. Implementation: Observability and Rate Limiting

Two operational concerns were addressed together: (1) understanding the behavior of the running service in production, and (2) protecting the LLM-bound and authentication endpoints from accidental or abusive traffic.

### 10.1 Observability

#### 10.1.1 Why server-side observability is required

A reasonable first question for a single-developer web application is whether browser-side tooling — the Chrome / Firefox developer tools, the network panel, the JavaScript console — is sufficient to understand application behavior. For Sapient it is not, and the reasons generalize to most LLM-bound applications.

Browser developer tools see only what the browser itself observes: paint times, the duration of a network request as measured at the client, console messages, and bundle sizes. They are bounded to a single user's session, last only as long as the panel is open, and have no record of what the server did internally. For a tutoring application where a single chat request can fan out to a database, an embedding API, a vector search, an LLM stream, and a database write, the browser sees only the outer envelope: that the request took, for example, twelve seconds and returned 200. It cannot answer the operationally important question of *why* it took twelve seconds.

Server-side instrumentation answers that question directly. With distributed tracing, the same twelve-second request decomposes into a tree of spans: thirty milliseconds loading the conversation from PostgreSQL, eighty milliseconds loading the user, two hundred and forty milliseconds for the embedding call, one hundred and ten milliseconds for the vector search, eleven and a half seconds inside the LLM stream span (annotated with prompt token count, completion token count, model identifier, and whether tool calls were emitted), and a final eighty milliseconds writing the assistant response back to the database. The diagnosis follows immediately from the trace: the latency is dominated by the LLM call, the prompt is unusually large because retrieval is over-fetching, and the correct model was used. None of this is recoverable from a browser timeline.

There are also categories of behavior that browser tooling cannot observe at all. It cannot aggregate across users to distinguish a personal anomaly from a systemic regression; it cannot aggregate over time to support post-hoc analysis of yesterday's complaint; it cannot run in production where the data and load actually exist; it has no notion of alerting; it does not survive the user closing the tab; it sees a single HTTP call rather than the distributed work that call triggers; and it captures nothing about background processes such as the asynchronous material-ingestion path. These are the tasks for which an instrumented backend exists, and each of them is in scope for a tutoring application that depends on a third-party LLM whose latency, cost, and failure modes are part of the user experience. Browser developer tools and a server-side observability stack are therefore complementary rather than alternatives: developer tools remain the right instrument for client-side concerns such as paint, hydration, and bundle size, while OpenTelemetry covers the entire backend call graph that DevTools cannot see.

#### 10.1.2 Implementation

The system was instrumented for full three-signal observability — distributed traces, metrics, and structured logs that share a common correlation identifier — using OpenTelemetry as the data plane. OpenTelemetry was chosen because it is the de facto open standard for instrumentation in modern back-end services and because it decouples the instrumented application from the chosen telemetry backend: the same SDK can export to Jaeger, Tempo, Honeycomb, Grafana Cloud, Datadog, or any other OTLP-compatible system without code changes.

**Traces.** An ASGI-level middleware (`ObservabilityMiddleware`) assigns every HTTP request a `X-Request-ID` (accepted from upstream or generated as a UUID), binds the ID into a `ContextVar`, and emits a structured JSON log line at request completion. Distributed tracing itself is provided by four OpenTelemetry instrumentations: `FastAPIInstrumentor` produces an `http.server` span per request annotated with the matched route template, `SQLAlchemyInstrumentor` and `AsyncPGInstrumentor` produce DB spans for every query, and `HTTPXClientInstrumentor` produces client spans for outbound calls (the Whisper, OpenAI TTS, Pexels, Wikimedia Commons, LangSearch, and YouTube APIs). Manual spans are added inside `LLMService.stream_response` and `LLMService.stream_with_tools` and annotated with the OpenTelemetry GenAI semantic conventions (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`), so per-call latency, token consumption, and tool-call rate are queryable as first-class span attributes. The middleware is intentionally implemented as a pure ASGI wrapper rather than a Starlette `BaseHTTPMiddleware` because the chat endpoint streams long-lived Server-Sent Events and `BaseHTTPMiddleware` is known to buffer streaming bodies in certain configurations.

**Metrics.** Metrics flow through the same OpenTelemetry `MeterProvider`, which is configured with two readers: a `PrometheusMetricReader` that backs the `/metrics` scrape endpoint, and a `PeriodicExportingMetricReader` that pushes the same data over OTLP/HTTP to any configured collector. The FastAPI instrumentor automatically emits `http.server.request.duration` and `http.server.active_requests`. Three application-specific counters — `rate_limit_rejections_total{bucket}`, `llm_calls_total{model,status}`, and `llm_tokens_total{model,kind}` — record the policy events that matter for capacity planning: which buckets are pressured, which model is being called, whether calls are succeeding, and how prompt and completion tokens are accumulating per model.

**Logs.** Logs are emitted as JSON to stdout. A `TraceContextLogFilter` reads the active OpenTelemetry span at log time and stamps `trace_id` and `span_id` onto every `LogRecord`, so each log line carries the correlation identifiers needed to navigate from a log entry to the corresponding span and back. The same fields (`trace_id`, `span_id`, `request_id`, `user_id`) appear consistently across application logs, the per-request log line emitted by the middleware, and any exception traces.

*Alternatives considered.* A first iteration used `prometheus-client` directly with no tracing, on the reasoning that the application was a single-process deployment and that Prometheus alone would be sufficient. That position was revisited and rejected: an LLM-tutoring application has a fan-out call graph (request → DB → retriever → embedding API → LLM stream → DB writes) where the most useful operational question is "where did this slow request spend its time," and that question is only answerable with traces. A hosted APM (Datadog, Sentry Performance, New Relic) was rejected on cost and lock-in grounds at the current scale; using OpenTelemetry preserves the option to point at any of those systems later by changing one environment variable. A push-only setup using StatsD/DogStatsD was rejected because it requires running an agent process for any backend to be useful, and because the OpenTelemetry pull-and-push hybrid means the application can be scraped locally during development and exported to a collector in production with a single configuration change. Computing latency histograms from logs alone (e.g., Loki + LogQL `quantile_over_time`) was rejected because it is lossy at the percentiles that matter for an LLM application and significantly more expensive than first-class metric histograms. The instrumentation-package footprint (api, sdk, OTLP HTTP exporter, Prometheus reader, four instrumentation libraries) was accepted as a deliberate cost of the standardization benefit.

### 10.2 Rate limiting

#### 10.2.1 Why rate limiting is required

An LLM-bound application has a property that traditional web applications do not: the marginal cost of a single request is non-trivial and is denominated in tokens billed by an external provider. A modest tutoring conversation may consume several thousand prompt tokens and several hundred completion tokens per turn, and the cost is incurred whether the request originates from a legitimate user, a buggy client that retries on every keystroke, or an automated script. Without an explicit policy, a single misbehaving caller can exhaust both the application's monthly LLM budget and the throughput of the upstream API, degrading service for every other user.

Rate limiting is therefore a substantive operational requirement rather than a defensive afterthought. It serves three distinct goals in this system. The first is cost containment: per-user limits on the chat, weak-quiz, summary, and mind-map endpoints place a hard ceiling on how much LLM spend any individual account can drive in a given minute, which makes per-user cost predictable and bounds the blast radius of a runaway client. The second is upstream protection: the Whisper, OpenAI text-to-speech, and Google embedding APIs each enforce their own quotas, and submitting more requests than those quotas allow produces cascading 429s and degraded latency for all users; bounding outbound rate locally avoids that failure mode. The third is authentication abuse: the `/auth/login`, `/auth/register`, and `/auth/google` endpoints are reachable without credentials and are therefore the natural target for credential stuffing and account enumeration. Per-IP throttling makes online password attacks materially more expensive without requiring CAPTCHA or other interactive friction.

These goals motivate three concrete design choices that the implementation reflects. Limits are *per principal* rather than per route — a single user calling chat repeatedly should be throttled even when the global request rate is low. Limits are *segmented by bucket* — a user uploading a large set of materials should not deplete the budget for their chat session, because uploads and chat answer different operational questions. And limits are *observable* — every rejection increments a counter that flows into the same Grafana stack as the rest of the metrics, so that limit pressure is visible alongside latency and error rate rather than being silently absorbed.

#### 10.2.2 Implementation

An in-memory token-bucket limiter is exposed as two FastAPI dependency factories: `rate_limit_user` (keyed by JWT subject, falling back to client IP if no valid token is presented) and `rate_limit_ip` (used by the unauthenticated `/auth/login`, `/auth/register`, and `/auth/google` endpoints). Buckets are named (`chat`, `stt`, `tts`, `summary`, `upload`, `auth`), per-minute capacities are configurable through environment variables, and rejected requests return `429 Too Many Requests` with a computed `Retry-After` header and increment the `rate_limit_rejections_total{bucket}` counter so that limit pressure is observable in Grafana alongside everything else.

*Alternatives considered.* A Redis-backed limiter (`slowapi`, `fastapi-limiter`) would survive multi-process deployments and is the correct choice once the backend horizontally scales, but the application currently runs as a single Fly.io process and adding Redis purely for rate limiting would introduce a new piece of infrastructure for no current benefit. A reverse-proxy-level limit (Fly.io edge or Cloudflare) was rejected because it cannot key on the authenticated user ID and would conflate users behind shared NATs. Per-route hardcoded limits inside each handler were rejected as harder to audit than a single configuration surface; the dependency-factory approach keeps the limit declarations adjacent to the route definitions while centralizing the policy. The decision to keep the limiter in-memory is therefore explicitly time-bound: it is appropriate for the single-process deployment and should be replaced with a Redis-backed implementation when a second worker is added.

## 11. Evaluation

The retrieval-augmented generation pipeline is evaluated against `rag-mini-bioasq`, a 4.7-thousand-passage biomedical benchmark from `rag-datasets`. The dataset is chosen for two properties: it provides ground-truth `relevant_passage_ids` for each question, which makes deterministic retrieval metrics possible without an LLM judge, and its passage size and language register approximate the textbook excerpts and lecture notes that students upload as study material in production use.

The evaluation suite consists of three complementary components, all implemented in `evals/`. The first is a *retrieval-only* evaluation that computes `recall@k`, `precision@k`, and mean reciprocal rank against the dataset's ground-truth relevance labels. This evaluation runs through the production retriever, which means the same chunking strategy, the same embedding model (`text-embedding-004`), the same pgvector schema, and the same per-material deduplication logic as the live application. It is deterministic, requires only a single query embedding per question, and does not depend on an LLM judge; it is therefore the appropriate metric for detecting retrieval regressions and is run after every change to the embedding model, chunk size, or retrieval logic.

The second component is an *end-to-end* RAG evaluation built on Ragas. It exercises the full production stack — retrieve, build the prompt with the same `prompt_builder` used by the chat service, generate an answer through `LLMService`, then score the resulting `(question, contexts, answer, ground_truth)` tuple on `faithfulness`, `answer_relevancy`, `context_precision`, `context_recall`, and `factual_correctness` using an OpenAI judge. The Ragas evaluation captures behaviors that the retrieval-only evaluation cannot: whether the model hallucinates beyond the retrieved context, whether the answer is on-topic, whether the retrieved chunks are themselves relevant rather than merely numerous, and whether the final answer matches the reference answer. The cost of that coverage is variance — LLM-judged metrics carry the noise inherent to LLM-as-judge methodology and are interpreted as trends across a sample rather than as point estimates.

The third component is a *pedagogical helpfulness* evaluation, which is the artifact that distinguishes this system from a generic RAG application. Retrieval quality and answer faithfulness are necessary but not sufficient conditions for an effective tutor: a response can be perfectly grounded in the retrieved context and still be pedagogically poor — for instance by dumping the textbook excerpt verbatim, ignoring a misconception in the student's question, or refusing to scaffold a difficult concept. The pedagogical evaluation scores each response on six explicit dimensions — scaffolding, active engagement, misconception handling, calibrated depth, connections to prior knowledge, and source grounding — using an OpenAI judge against `ScaleAI/TutorBench`, a public tutoring benchmark with student prompts, follow-up questions, subject labels, and sample-specific rubrics. The harness samples text-only TutorBench rows by default, injects each row's rubric into the judge prompt, and still reports the same six shared dimensions so the results remain comparable across subjects and use cases. This third evaluation is independent of the RAG benchmark — it does not require any material to be ingested into pgvector — and is therefore the appropriate signal for changes that affect the system prompt, the tutor customization, or the model itself rather than retrieval.

A separate ingestion script (`evals/ingest_dataset.py`) populates pgvector with the benchmark corpus plus configurable distractor passages drawn from the rest of the BioASQ corpus. The default run uses one hundred QA rows and five hundred distractors. The distractors make the retrieval task non-trivial: a retriever that simply returned every passage in the database would otherwise hit perfect recall vacuously. The eval data is owned by a dedicated `ragas-eval@local` user with a dedicated subject, so it is segregated from any real user data sharing the same database.

The harness is intentionally LLM-budget-aware. The retrieval evaluation consumes only one embedding call per question. The Ragas and TutorBench evaluations run serially with configurable inter-call pacing (twenty seconds by default) and support checkpoint resume, so a partial run can be continued without re-paying for answers already generated. All evaluations write per-row CSV outputs alongside their aggregated stdout summaries, so results can be diffed across commits as a regression signal. Run artifacts (corpus map, checkpoints, CSV outputs) are deliberately gitignored: the source of truth is the dataset and the code, not the regenerable output.

*Reranker A/B at n=100.* Because the cross-encoder reranker is presented as the project's retrieval-quality story, both the retrieval-only and Ragas evaluations were run twice on the same 100-row BioASQ corpus — once with vector-only retrieval (`RAG_RERANKER_ENABLED=false`) and once with the LangSearch cross-encoder enabled — so that the architectural decision is backed by an empirical delta rather than an asserted improvement.

| Metric                | Baseline (vector-only) | Reranker | Δ      |
|-----------------------|------------------------|----------|--------|
| `recall@1`            | 0.140                  | 0.144    | +0.004 |
| `recall@5`            | 0.463                  | 0.473    | +0.010 |
| `recall@10`           | 0.612                  | 0.624    | +0.012 |
| `precision@1`         | 0.950                  | 0.970    | +0.020 |
| `precision@5`         | 0.834                  | 0.852    | +0.018 |
| `mrr`                 | 0.965                  | 0.980    | +0.015 |
| `faithfulness`        | 0.962                  | 0.957    | −0.005 |
| `answer_relevancy`    | 0.819                  | 0.853    | +0.034 |
| `context_precision`   | 0.847                  | 0.873    | +0.026 |
| `context_recall`      | 0.828                  | 0.839    | +0.011 |
| `factual_correctness` | 0.456                  | 0.456    | +0.000 |

The reranker improves every retrieval-side metric, and the gains propagate exactly where the two-stage architecture predicts they should: `context_precision` increases by 0.026 because the cross-encoder pushes the single most relevant passage above its near-neighbors, and `answer_relevancy` increases by 0.034 because a more focused prompt produces a more on-topic generation. `mrr` reaches 0.980, indicating that the first relevant passage is at rank 1 in essentially every case where any relevant passage is in the candidate pool.

To distinguish real effects from LLM-judge variance, every paired delta was tested for statistical significance using a Wilcoxon signed-rank test and a paired bootstrap with 10,000 resamples over the 100-row sample. The cleanest results sit on the retrieval side and on `answer_relevancy`: `precision@5` improves by 0.018 with a 95% confidence interval of `[+0.002, +0.038]` that excludes zero, and `answer_relevancy` improves by 0.034 (Wilcoxon `p=0.030`, 95% CI `[−0.004, +0.076]`). The remaining retrieval-side metrics (`recall@5`, `recall@10`, `precision@1`, `mrr`) all move in the predicted direction with effect sizes between +0.010 and +0.020 but with confidence intervals that include zero at this sample size, so they are best read as directionally consistent rather than individually decisive. The Ragas-side `context_precision` and `context_recall` gains are similarly directional. The `faithfulness` movement of −0.005 has a 95% CI of `[−0.027, +0.018]` and a Wilcoxon `p=0.563`, which is firmly inside judge noise. The honest summary is that the reranker produces a *consistent positive bundle* across eleven metrics — every metric whose value changes does so in the predicted direction — but the per-metric effect sizes are mostly at the edge of detectability at n=100, and a larger sample would be required to call each individual delta significant on its own.

Two of the eleven metrics move in directions that initially look counterintuitive and are worth explaining explicitly. **`faithfulness` drops by 0.005.** Faithfulness is computed as the fraction of statements in the generated answer that are supported by *the retrieved context the model was shown*. The reranker is a precision-leaning operation: it concentrates the top-K on the single best chunk and discards weaker candidates that the vector-only path would have kept. When the model writes a fluent answer that extends slightly beyond what any one chunk says, a tighter context window gives the judge fewer surrounding sentences to anchor each statement to, and statement-level support is a strict binary check, so a 0.005 movement on 100 rows is consistent with one or two borderline statements per row being reclassified. The magnitude is within the LLM-judge variance that the writeup already attributes to this family of metrics, and the *direction* is the expected precision-vs-coverage trade-off, not a real regression in answer quality. **`factual_correctness` does not move at all.** Unlike faithfulness, factual_correctness compares the generated answer's claims to the dataset's *ground-truth* answer rather than to the retrieved context. Reranking can only reorder what is already in the candidate pool; it cannot add ground-truth content the corpus does not contain. A flat 0.456 on this metric across both configurations therefore reads as a coverage ceiling rather than a ranking ceiling — the bottleneck on this benchmark sits in what the indexed corpus contains, not in how candidates are ordered. The A/B accordingly validates the two-stage architecture (consistent gains where ranking matters) while clarifying which class of result the cross-encoder is and is not expected to move.

*Failure-mode analysis.* Reading the lowest-scoring rows in each evaluation is more informative than the aggregate means. On the Ragas side, the rows with `factual_correctness=0.00` are not actually wrong answers in the colloquial sense — they are dominated by two patterns. The first is *verbose-but-correct expansion*: a question like "Has Denosumab (Prolia) been approved by FDA?" has a one-sentence ground truth ("Yes, Denosumab was approved by the FDA in 2010") and the generated answer correctly opens with "Yes" and then enumerates the conditions it is approved for, which adds claims the ground truth never makes. Claim-level F1 penalizes these additional claims even though they are accurate and grounded in the retrieved context. The second pattern is *honest hedging under inconsistent context*: when retrieval returns chunks that disagree, the tutor sometimes responds with "the context provides conflicting information" rather than committing to an answer. That behavior is desirable for a tutoring system but reads to claim-level F1 as a missing claim. Together, these two patterns explain most of the 0.456 score on this metric — it is more a feature of how the metric is computed than a coverage failure of the corpus, and is the kind of trade-off the writeup would expect a follow-on study to investigate by replacing claim-level F1 with a semantic-overlap metric. On the TutorBench side, the lowest-scoring scenarios are concentrated in long quantitative word problems (Physics inclined-plane, Statistics diagnostic-test base-rate, Calculus differential-equation derivations); the dimension that pulls the mean down most consistently across all subjects is `connections` (4.41 over 100 rows), which scores the tutor on how often it reaches for analogies and prior topics — a real pedagogical opportunity rather than a metric artifact. Per-subject overall means range from 4.42 (Computer Science, `n=11`) to 4.79 (Chemistry, `n=21`, and Statistics, `n=20`), and 78% of scenarios score at or above 4.5 overall, so the tutor's pedagogical floor is high and the variance is concentrated in the lower 22% of scenarios rather than spread across the dataset.

*Limitations.* The biomedical benchmark exercises retrieval and faithfulness but does not measure educational quality; TutorBench closes that gap for response-level teaching behaviors but introduces its own caveats. Some TutorBench rows are multimodal, while the current eval harness is text-first, so image-backed rows are skipped by default unless explicitly enabled. The judge is from a different model family than the Gemini tutor, which reduces self-judging bias but does not eliminate LLM-as-judge variance, and the entire eval suite is judged by a single OpenAI model family — running the same prompts under a second judge (e.g., Claude on a small subset) would be the obvious robustness check that a follow-up project could add cheaply. On factual_correctness specifically, the 0.456 score is partly a property of the metric (claim-level F1 penalizes verbose-but-correct expansion and honest hedging) rather than purely a corpus-coverage signal; a richer follow-up would re-score those rows with a semantic-overlap metric. Beyond automated evaluation, two informal read-aloud studies were conducted in which student volunteers used the deployed application and narrated their reasoning while interacting with it; the observations from those sessions directly informed iterations on the chat UI, the lecture-mode controls, and the way sources are presented inline. This is intentionally lightweight rather than a formal user study: as a student building a system explicitly for the way I myself study, I treated my own first-person experience as a primary design source and used the read-aloud sessions to surface frictions I had already adapted around. A formal between-subjects study with retention metrics and a control condition is the right next step for a follow-on project but was outside the scope of this one. Expanding the judge ensemble and adding a multimodal path for image-backed TutorBench rows remain natural extensions on the automated side.

## 12. Discussion

The project has several architectural strengths:

- it separates conversational tutoring from project-level learning memory
- it treats generated artifacts as first-class data
- it grounds answers in user-owned materials
- it uses explicit tools for public web search, images, and resources instead of hiding outside context in plain text
- it models student knowledge with BKT rather than only aggregate quiz accuracy
- it connects study planning to deadlines through calendar-backed assignments
- it has deploy, observability, security-header, and rate-limiting paths that are credible beyond a local demo
- it supports multiple study modes without changing the core backend
- it uses a production-friendly object storage flow instead of proxying uploads through the API server

The central finding is that the system becomes more educationally meaningful when chat is treated as one interface into a larger learning state, rather than as the product itself. Sessions feed notes, quizzes, resources, progress, mastery estimates, reminders, and review systems rather than disappearing after the answer is delivered. This directly addresses RQ1 by converting transient interactions into durable artifacts, and RQ2 by pairing conversational convenience with retrieval practice, source cards, lecture controls, and student-visible study memory.

The evaluation design also clarifies an important distinction: retrieval quality, factual grounding, and pedagogical helpfulness are related but separate properties. A system can retrieve the right passage and still produce a weak tutor response if it does not scaffold, check understanding, or adapt depth. Conversely, a warm and engaging answer is not acceptable if it is not grounded in the student's material when grounding is available. Sapient therefore needs both RAG metrics and tutoring-quality metrics to be evaluated honestly.

## 13. Limitations and Future Work

The current implementation is strong as a prototype and early product foundation, but several areas remain open for expansion:

- export flows for summaries, notes, or session transcripts
- stronger mobile optimization and accessibility review
- richer analytics and retention metrics
- deeper material parsing and citation fidelity, especially for tables, slides, and scanned PDFs
- persistence for session diagrams if long-term diagram history becomes important
- Redis-backed rate limiting before horizontal backend scaling
- migration from localStorage bearer tokens to HttpOnly cookie auth with CSRF protection
- migration paths for newer OpenAI speech models (`gpt-4o-mini-tts`, `gpt-4o-transcribe`) if latency or transcription quality become priority issues
- stronger evaluation workflows for tutoring quality, retrieval relevance, BKT calibration, and resource-recommendation usefulness

## 14. AI-Assisted Development Methodology

A major part of this project was also methodological: it was an experiment in building substantial software with AI development tools under realistic constraints. Because the project was completed independently, it could not simulate one central part of professional software engineering: team communication. There were no product managers, designers, reviewers, QA partners, or other engineers to negotiate requirements with. However, within the constraints of personal funding, the development process used Claude Code, Codex, Gemini, and Claude Design as development collaborators with different strengths.

The most useful workflow was Claude Code through the VS Code extension, with the Codex extension becoming especially useful when Claude Code credits ran out or when a second implementation path was useful. Gemini was useful for additional ideation and cross-checking. Claude Design, still in beta, was useful for quickly exploring interface direction, but it also made the risks of AI-generated UI clear: a visually plausible design is not automatically coherent with the existing product model, data model, or interaction constraints.

This experience matched observations from work as a Quality Assurance Intern at a newer AI startup: speed is often valued above everything else, and quality can become a downstream correction step. The cost of that mindset is familiar in product work. Features ship quickly, then have to be redesigned because the UX does not match the real workflow, or because the implementation does not fit cleanly with the rest of the system. Sapient suggests a more useful frame: AI tools can help one person produce more and move faster, but only when the human supplies product judgment, constraints, verification, and continuity.

The first lesson is that AI does not automatically ground itself in the builder's reality. The tool does not know the time limit, budget, deployment target, evaluation standard, product taste, or intended user unless those are made explicit. Sapient had a specific product intent: a serious study workspace, not a generic chatbot, and not a decorative edtech landing page. The models did not reliably infer that from a few prompts. They had to be given the budget constraints, the intended product feel, the need for durable learning artifacts, the importance of source grounding, and the reason speed alone was not the goal.

The second lesson is that context and documentation are the real control surface. This became especially important when switching between agents. Before an agent implemented a feature, its understanding of the core problem, surrounding architecture, and product constraint had to be checked. The most productive workflow was to ask for a plan, inspect the reasoning, challenge weak assumptions, and only then let it edit. This costs more tokens, but it prevents more expensive mistakes: duplicated abstractions, UI that does not fit the system, or features that work locally but break deployment assumptions. Project files such as `features.md`, implementation notes, and future agent-guidance files such as `CLAUDE.md` or `Featuremap.md` are not just documentation for humans; they are memory and alignment infrastructure for AI agents.

The third lesson is that an AI development tool works best when it has bounded tools and a clear feedback loop. Anthropic's work on effective agents describes the augmented LLM as an LLM with retrieval, tools, and memory, and emphasizes that agents need ground truth from their environment during execution [3]. That matched this project directly: agents were more useful when they could inspect the repository, run tests, read logs, use MCP servers or skills, and see concrete errors rather than operating only from natural-language requests. Slack's 2026 overview of agentic AI platforms similarly emphasizes goal-directed behavior, tool integration, adaptation to context, and human-in-the-loop oversight [4]. In practice, the "human-in-the-loop" part was not optional. It was the mechanism that kept the project coherent.

For Sapient specifically, this process shaped both the app and the engineering approach. The app itself pushes against passive AI consumption by adding sources, quizzes, flashcards, BKT mastery, reminders, and lecture-mode interruption. The development workflow followed the same principle: do not accept fluent output as sufficient. Ask for evidence, inspect the plan, test the result, preserve context, and make the model interact with the actual system rather than an imagined one.

## 15. Conclusion

Sapient demonstrates a practical architecture for an educational AI system that goes beyond generic chat. By combining conversational tutoring, retrieval grounding, structured artifact generation, BKT-based mastery modeling, spaced repetition, calendar-aware reminders, feedback personalization, and voice interaction, the platform creates a more complete study environment. Its main contribution is not any single feature in isolation, but the way those features are connected: tutoring sessions generate reusable learning artifacts, those artifacts drive review and progress, quiz evidence updates the student model, deadlines influence study priority, and the system gradually builds a personalized study workspace for the learner over time.

## References

[1] N. Kosmyna et al., ["Your Brain on ChatGPT: Accumulation of Cognitive Debt when Using an AI Assistant for Essay Writing Task,"](https://arxiv.org/abs/2506.08872) arXiv:2506.08872, 2025.

[2] A. Barcaui, ["ChatGPT as a cognitive crutch: Evidence from a randomized controlled trial on knowledge retention,"](https://www.sciencedirect.com/science/article/pii/S2590291125010186) *Social Sciences & Humanities Open*, 2025.

[3] Anthropic, ["Building Effective AI Agents,"](https://www.anthropic.com/engineering/building-effective-agents) 2024.

[4] Slack, ["Best Agentic AI Platforms for 2026: What They Are and How to Choose One,"](https://slack.com/blog/productivity/best-agentic-ai-platforms-for-2026-what-they-are-and-how-to-choose-one) 2026.

[5] Google, ["Gemini API model documentation,"](https://ai.google.dev/gemini-api/docs/models/gemini) accessed May 2026.

[6] OpenAI, ["Text to speech,"](https://platform.openai.com/docs/guides/text-to-speech) and ["Speech to text,"](https://platform.openai.com/docs/guides/speech-to-text) accessed May 2026.

[7] Cloudflare, ["R2 pricing,"](https://developers.cloudflare.com/r2/pricing/) accessed May 2026.

[8] Fly.io, ["Pricing,"](https://fly.io/docs/about/pricing/) and ["Autostop/autostart Machines,"](https://fly.io/docs/launch/autostop-autostart/) accessed May 2026.
