SUPPORTED_TTS_VOICES = (
    "alloy",
    "ash",
    "coral",
    "echo",
    "fable",
    "nova",
    "onyx",
    "sage",
    "shimmer",
)

DEFAULT_TTS_VOICE = "nova"
DEFAULT_TTS_MODEL = "tts-1-hd"


def validate_tutor_voice(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in SUPPORTED_TTS_VOICES:
        raise ValueError(
            "Unsupported tutor voice. Choose one of: "
            + ", ".join(SUPPORTED_TTS_VOICES)
            + "."
        )
    return normalized


def normalize_tutor_voice(value: str | None, *, fallback: str = DEFAULT_TTS_VOICE) -> str:
    candidate = (value or "").strip().lower()
    if candidate in SUPPORTED_TTS_VOICES:
        return candidate

    safe_fallback = (fallback or "").strip().lower()
    if safe_fallback in SUPPORTED_TTS_VOICES:
        return safe_fallback

    return DEFAULT_TTS_VOICE
