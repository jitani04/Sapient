# Deployment Guide

This document describes how to deploy the current Sapient implementation. It focuses on what the codebase actually expects today: a FastAPI backend, a static React frontend, PostgreSQL with `pgvector`, and S3-compatible object storage for uploaded materials.

## What Must Be Deployed

| Piece | Tech | Why it exists |
|-------|------|---------------|
| Backend API | FastAPI + Uvicorn | Auth, chat streaming, retrieval, summaries, quizzes, flashcards, search |
| Frontend SPA | React + Vite build | Main user interface |
| Database | PostgreSQL + `pgvector` | Relational data + vector retrieval |
| Object storage | S3-compatible bucket | Original uploaded study materials |
| External AI services | Google Gemini + Google embeddings + OpenAI speech APIs | Tutor generation, embeddings, STT, TTS |

## Current Runtime Assumptions

The codebase currently assumes:

- chat responses are streamed over SSE from `/chat/{conversation_id}`
- uploaded materials are sent directly from the browser to object storage using presigned URLs
- the backend stores only metadata and storage keys for those materials
- file ingestion happens asynchronously after `POST /materials`
- ready materials are previewed with presigned GET URLs

Any deployment setup has to preserve those behaviors.

## Recommended Stack

The current repo is well-suited to:

- Docker for packaging
- Fly.io or a similar container host for backend and frontend
- Neon or another managed PostgreSQL provider
- Cloudflare R2, AWS S3, or another S3-compatible provider for materials

The important requirement is not the vendor itself. It is that the deployment supports:

- long-lived SSE connections
- PostgreSQL extensions
- presigned object-storage uploads
- environment-based secret management

## Environment Variables

### Backend

These variables match the current application settings in `app/core/config.py`.

```bash
APP_NAME=Sapient
ENVIRONMENT=production
LOG_LEVEL=INFO

DATABASE_URL=postgresql+asyncpg://...

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
S3_REGION=us-east-1
S3_ENDPOINT_URL=
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
PEXELS_API_KEY=

EMAIL_PROVIDER=resend
EMAIL_FROM_ADDRESS=Sapient <review@your-verified-domain.com>
RESEND_API_KEY=your_resend_api_key
APP_BASE_URL=https://your-frontend.example.com
INTERNAL_JOB_TOKEN=replace_with_a_long_random_secret_for_scheduled_jobs

CORS_ALLOW_ORIGINS=https://your-frontend.example.com
```

Notes:

- `LLM_API_KEY` is used for both tutor generation and embeddings in the current implementation.
- `OPENAI_TTS_API_KEY` is used for **both** `/tts` and `/stt`.
- `RAG_RERANKER_ENABLED=true` is the expected production setting; configure `LANGSEARCH_API_KEY` so retrieved material chunks are reranked before prompt injection.
- `S3_ENDPOINT_URL` should be blank for AWS S3 and set explicitly for R2, B2, MinIO, or another compatible provider.
- `EMAIL_PROVIDER=noop` disables real review digest sends. Use `EMAIL_PROVIDER=resend` with a verified sender/domain for production email.
- `INTERNAL_JOB_TOKEN` protects the scheduled review digest endpoint.

### Frontend

```bash
VITE_API_BASE_URL=https://your-api.example.com
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id.apps.googleusercontent.com
```

If `VITE_API_BASE_URL` is not set, the frontend falls back to the current hostname on port `8000`. That is convenient locally but usually too implicit for production.

## Database Requirements

The database must support:

- standard PostgreSQL features used by SQLAlchemy/Alembic
- the `vector` extension for material embeddings

Typical setup step:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then run migrations:

```bash
alembic upgrade head
```

## Object Storage Requirements

The material workflow depends on presigned URLs and object existence checks. The storage provider must support:

- presigned `PUT` uploads
- object metadata lookup / `HEAD`
- presigned `GET` URLs for preview
- object deletion

### Minimum bucket CORS for browser uploads

```json
[
  {
    "AllowedOrigins": ["https://your-frontend.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3000
  }
]
```

For local development against a live bucket, also allow:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

## Backend Packaging Notes

The backend image needs:

- Python 3.11
- build support for Python dependencies
- access to `requirements.txt`
- the `app/` package and `alembic/`

Typical startup command:

```bash
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The application must expose SSE without proxy buffering problems.

## Frontend Packaging Notes

The frontend is a standard Vite static build:

```bash
cd frontend
npm ci
npm run build
```

It can be served by nginx, a static file host, or a CDN-backed SPA host. If the frontend and backend live on different origins, make sure:

- `VITE_API_BASE_URL` points at the backend
- `CORS_ALLOW_ORIGINS` includes the frontend origin
- Google OAuth redirect settings include the deployed frontend URL

## Reverse Proxy Requirements

If you place nginx or another reverse proxy in front of the backend, it must preserve streaming behavior for `/chat/*`.

Important settings:

- disable buffering for the chat route
- allow long read timeouts
- forward standard proxy headers

Conceptually:

```nginx
location /chat/ {
    proxy_pass http://backend:8000;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}
```

## Smart Review Digest Scheduler

Automatic Smart Review Digest emails are driven by a GitHub Actions schedule in `.github/workflows/review-digests.yml`.

Set these GitHub configuration values:

- Secret: `INTERNAL_JOB_TOKEN` should match the backend `INTERNAL_JOB_TOKEN`.
- Variable or secret: `REVIEW_DIGEST_API_URL` should be the production backend URL, for example `https://your-api.example.com`.

If `REVIEW_DIGEST_API_URL` is not set, the workflow falls back to `VITE_API_BASE_URL` if that already points at the production backend.

The workflow calls:

```http
POST /internal/review-digests/run
X-Internal-Job-Token: ...
```

Manual digest sends do not need this scheduler. The scheduler only powers automatic opt-in reminders.

## Deployment Checklist

- Provision PostgreSQL and enable `vector`
- Provision an S3-compatible bucket
- Configure bucket CORS for browser `PUT` uploads
- Set backend secrets and frontend environment variables
- Run `alembic upgrade head`
- Verify `/health`
- Verify login or Google sign-in
- Verify material upload end-to-end:
  - `POST /materials/presign`
  - browser `PUT`
  - `POST /materials`
  - ingestion reaches `ready`
- Verify `GET /materials/{id}/preview-url`
- Verify `/chat/{conversation_id}` SSE streaming
- Verify `/stt` and `/tts` if speech features are enabled

## Common Failure Points

### 1. SSE appears to hang or batch responses

Cause:

- reverse proxy buffering
- platform timeouts

Fix:

- disable buffering on the chat route
- increase read timeout

### 2. Material upload succeeds but ingestion fails

Cause:

- bad object storage credentials
- missing object permissions
- unsupported file type
- empty or oversized upload

Fix:

- confirm bucket/key access
- verify `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`, and optional `S3_ENDPOINT_URL`
- verify the file is PDF, TXT, or MD

### 3. Materials upload from the browser fails before hitting the backend

Cause:

- bucket CORS not configured

Fix:

- add the deployed frontend origin to the bucket CORS policy

### 4. Google sign-in fails in production

Cause:

- missing or mismatched `GOOGLE_CLIENT_ID`
- missing production redirect/origin settings in Google Cloud Console

Fix:

- update both backend and frontend config
- verify deployed origin settings in the Google app configuration

### 5. Speech routes return 503

Cause:

- `OPENAI_TTS_API_KEY` is missing

Fix:

- set `OPENAI_TTS_API_KEY`

## Suggested First Production Path

If deploying this repo today, a reasonable first production setup is:

- backend container on Fly.io or Render
- frontend static build on Fly.io, Render, or Vercel
- PostgreSQL on Neon
- object storage on Cloudflare R2 or AWS S3

That matches the current architecture with minimal adaptation.
