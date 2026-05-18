from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import make_asgi_app
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.llm_errors import is_llm_quota_error, retry_after_from_message

from app.api.routes.artifacts import router as artifacts_router
from app.api.routes.assignments import router as assignments_router
from app.api.routes.auth import router as auth_router
from app.api.routes.chat import router as chat_router
from app.api.routes.conversations import router as conversations_router
from app.api.routes.materials import router as materials_router
from app.api.routes.models import router as models_router
from app.api.routes.projects import router as projects_router
from app.api.routes.quiz import router as quiz_router
from app.api.routes.resources import router as resources_router
from app.api.routes.flashcards import router as flashcards_router
from app.api.routes.feedback import router as feedback_router
from app.api.routes.search import router as search_router
from app.api.routes.stt import router as stt_router
from app.api.routes.tts import router as tts_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.observability import (
    ObservabilityMiddleware,
    init_observability,
    instrument_app,
    instrument_sqlalchemy_engine,
)
from app.db.session import get_engine

settings = get_settings()

init_observability(
    service_name=settings.app_name,
    service_version=settings.app_version,
    environment=settings.environment,
    otlp_endpoint=settings.otel_otlp_endpoint or None,
    otlp_headers=settings.otel_otlp_headers or None,
    metrics_enabled=settings.metrics_enabled,
    console_traces=settings.otel_console_traces,
)
configure_logging(settings.log_level, json_logs=settings.json_logs)

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}
# CSP is path-scoped: docs/redoc need a CDN for Swagger UI assets,
# every other route is JSON and gets the strict policy.
_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")
_CSP_DEFAULT = "default-src 'none'; frame-ancestors 'none'"
_CSP_DOCS = (
    "default-src 'none'; "
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "img-src 'self' data: https://fastapi.tiangolo.com; "
    "font-src 'self' https://cdn.jsdelivr.net; "
    "frame-ancestors 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        for header, value in _SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        path = request.url.path
        csp = _CSP_DOCS if any(path.startswith(p) for p in _DOCS_PATHS) else _CSP_DEFAULT
        response.headers.setdefault("Content-Security-Policy", csp)
        if request.url.scheme == "https":
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response


app = FastAPI(title=settings.app_name)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(ObservabilityMiddleware)

instrument_app(app)
instrument_sqlalchemy_engine(get_engine())

if settings.metrics_enabled:
    app.mount("/metrics", make_asgi_app())

app.include_router(auth_router)
app.include_router(conversations_router)
app.include_router(chat_router)
app.include_router(materials_router)
app.include_router(models_router)
app.include_router(projects_router)
app.include_router(quiz_router)
app.include_router(resources_router)
app.include_router(artifacts_router)
app.include_router(assignments_router)
app.include_router(flashcards_router)
app.include_router(feedback_router)
app.include_router(search_router)
app.include_router(stt_router)
app.include_router(tts_router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.exception_handler(Exception)
async def llm_quota_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    if not is_llm_quota_error(exc):
        raise exc
    retry_after = retry_after_from_message(str(exc))
    return JSONResponse(
        status_code=503,
        content={
            "detail": "This AI feature is rate-limited right now. Please try again in a moment.",
            "retry_after_seconds": retry_after,
            "rate_limited": True,
        },
        headers={"Retry-After": str(retry_after)},
    )
