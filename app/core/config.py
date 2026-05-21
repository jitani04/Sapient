from functools import lru_cache

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = Field(default="Sapient", alias="APP_NAME")
    environment: str = Field(default="development", alias="ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    database_url: str = Field(alias="DATABASE_URL")

    llm_api_key: str = Field(validation_alias=AliasChoices("LLM_API_KEY", "OPENAI_API_KEY"))
    llm_model: str = Field(
        default="gemini-2.5-flash",
        validation_alias=AliasChoices("LLM_MODEL", "OPENAI_MODEL"),
    )
    llm_timeout_seconds: float = Field(
        default=60.0,
        validation_alias=AliasChoices("LLM_TIMEOUT_SECONDS", "OPENAI_TIMEOUT_SECONDS"),
    )
    embedding_api_key: str = Field(default="", alias="EMBEDDING_API_KEY")
    embedding_model: str = Field(default="models/gemini-embedding-001", alias="EMBEDDING_MODEL")
    embedding_dimensions: int = Field(default=768, alias="EMBEDDING_DIMENSIONS")

    system_prompt: str = Field(default="You are a helpful assistant.", alias="SYSTEM_PROMPT")

    @field_validator("system_prompt", mode="before")
    @classmethod
    def expand_newlines(cls, v: str) -> str:
        return v.replace("\\n", "\n")

    keepalive_seconds: int = Field(default=15, alias="KEEPALIVE_SECONDS")
    upload_max_bytes: int = Field(default=10 * 1024 * 1024, alias="UPLOAD_MAX_BYTES")
    upload_url_expires_seconds: int = Field(default=300, alias="UPLOAD_URL_EXPIRES_SECONDS")
    preview_url_expires_seconds: int = Field(default=3600, alias="PREVIEW_URL_EXPIRES_SECONDS")

    s3_bucket: str = Field(default="", alias="S3_BUCKET")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    s3_endpoint_url: str = Field(default="", alias="S3_ENDPOINT_URL")
    aws_access_key_id: str = Field(default="", alias="AWS_ACCESS_KEY_ID")
    aws_secret_access_key: str = Field(default="", alias="AWS_SECRET_ACCESS_KEY")
    rag_top_k: int = Field(default=4, alias="RAG_TOP_K")
    rag_candidate_k: int = Field(default=50, alias="RAG_CANDIDATE_K")
    rag_chunk_size: int = Field(default=1200, alias="RAG_CHUNK_SIZE")
    rag_chunk_overlap: int = Field(default=200, alias="RAG_CHUNK_OVERLAP")
    rag_reranker_enabled: bool = Field(default=True, alias="RAG_RERANKER_ENABLED")
    rag_reranker_timeout_seconds: float = Field(default=8.0, alias="RAG_RERANKER_TIMEOUT_SECONDS")
    langsearch_api_key: str = Field(default="", alias="LANGSEARCH_API_KEY")
    langsearch_api_base_url: str = Field(default="https://api.langsearch.com", alias="LANGSEARCH_API_BASE_URL")
    langsearch_rerank_model: str = Field(default="langsearch-reranker-v1", alias="LANGSEARCH_RERANK_MODEL")
    web_search_enabled: bool = Field(default=True, alias="WEB_SEARCH_ENABLED")
    web_search_result_count: int = Field(default=5, alias="WEB_SEARCH_RESULT_COUNT")
    web_search_timeout_seconds: float = Field(default=8.0, alias="WEB_SEARCH_TIMEOUT_SECONDS")

    enable_feedback_preferences: bool = Field(default=False, alias="ENABLE_FEEDBACK_PREFERENCES")
    enable_preference_memory: bool = Field(default=False, alias="ENABLE_PREFERENCE_MEMORY")
    preference_summary_max_feedback_items: int = Field(default=25, alias="PREFERENCE_SUMMARY_MAX_FEEDBACK_ITEMS")
    preference_memory_top_k: int = Field(default=3, alias="PREFERENCE_MEMORY_TOP_K")
    prompt_version: str = Field(default="default", alias="PROMPT_VERSION")

    jwt_secret: str = Field(alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expire_minutes: int = Field(default=10080, alias="JWT_EXPIRE_MINUTES")
    openai_tts_api_key: str = Field(default="", alias="OPENAI_TTS_API_KEY")
    openai_tts_voice: str = Field(default="nova", alias="OPENAI_TTS_VOICE")
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    pexels_api_key: str = Field(default="", alias="PEXELS_API_KEY")
    youtube_api_key: str = Field(default="", alias="YOUTUBE_API_KEY")
    email_provider: str = Field(default="noop", alias="EMAIL_PROVIDER")
    email_from_address: str = Field(default="", alias="EMAIL_FROM_ADDRESS")
    resend_api_key: str = Field(default="", alias="RESEND_API_KEY")
    app_base_url: str = Field(default="http://127.0.0.1:5173", alias="APP_BASE_URL")
    internal_job_token: str = Field(default="", alias="INTERNAL_JOB_TOKEN")

    google_client_id: str = Field(default="", alias="GOOGLE_CLIENT_ID")

    cors_allow_origins_raw: str = Field(
        default="http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173",
        alias="CORS_ALLOW_ORIGINS",
    )

    @property
    def cors_allow_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allow_origins_raw.split(",") if origin.strip()]

    metrics_enabled: bool = Field(default=True, alias="METRICS_ENABLED")
    json_logs: bool = Field(default=True, alias="JSON_LOGS")
    app_version: str = Field(default="dev", alias="APP_VERSION")
    otel_otlp_endpoint: str = Field(default="", alias="OTEL_EXPORTER_OTLP_ENDPOINT")
    otel_otlp_headers: str = Field(default="", alias="OTEL_EXPORTER_OTLP_HEADERS")
    otel_console_traces: bool = Field(default=False, alias="OTEL_CONSOLE_TRACES")

    rate_limit_enabled: bool = Field(default=True, alias="RATE_LIMIT_ENABLED")
    rate_limit_chat_per_min: int = Field(default=30, alias="RATE_LIMIT_CHAT_PER_MIN")
    rate_limit_stt_per_min: int = Field(default=20, alias="RATE_LIMIT_STT_PER_MIN")
    rate_limit_tts_per_min: int = Field(default=30, alias="RATE_LIMIT_TTS_PER_MIN")
    rate_limit_auth_per_min: int = Field(default=10, alias="RATE_LIMIT_AUTH_PER_MIN")
    rate_limit_summary_per_min: int = Field(default=10, alias="RATE_LIMIT_SUMMARY_PER_MIN")
    rate_limit_upload_per_min: int = Field(default=30, alias="RATE_LIMIT_UPLOAD_PER_MIN")


@lru_cache
def get_settings() -> Settings:
    return Settings()
