import pytest

from app.services.tts_service import (
    DEFAULT_TTS_VOICE,
    SUPPORTED_TTS_VOICES,
    normalize_tutor_voice,
    validate_tutor_voice,
)


def test_validate_tutor_voice_accepts_supported_voice_case_insensitively() -> None:
    assert validate_tutor_voice("Nova") == "nova"


def test_validate_tutor_voice_rejects_unsupported_voice() -> None:
    with pytest.raises(ValueError, match="Unsupported tutor voice"):
        validate_tutor_voice("ballad")


def test_normalize_tutor_voice_falls_back_to_supported_fallback() -> None:
    assert normalize_tutor_voice("invalid", fallback="sage") == "sage"


def test_normalize_tutor_voice_uses_default_when_voice_and_fallback_are_invalid() -> None:
    assert normalize_tutor_voice(None, fallback="invalid") == DEFAULT_TTS_VOICE
    assert DEFAULT_TTS_VOICE in SUPPORTED_TTS_VOICES
