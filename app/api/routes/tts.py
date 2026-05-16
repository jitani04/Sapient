import logging
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from openai import AsyncOpenAI
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.core.config import get_settings
from app.core.rate_limit import rate_limit_user
from app.db.session import get_db_session
from app.models.user import User
from app.services.tts_service import DEFAULT_TTS_MODEL, normalize_tutor_voice

logger = logging.getLogger(__name__)
_settings = get_settings()
router = APIRouter(
    tags=["tts"],
    dependencies=[Depends(rate_limit_user("tts", _settings.rate_limit_tts_per_min))],
)

UserDep = Annotated[int, Depends(get_user_id)]
DbDep = Annotated[AsyncSession, Depends(get_db_session)]

_MD_PATTERN = re.compile(r"\*{1,2}([^*]+)\*{1,2}|`([^`]+)`|#{1,6}\s+")


def _strip_markdown(text: str) -> str:
    text = re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"#{1,6}\s+", "", text)
    return text.strip()


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None


@router.post("/tts")
async def text_to_speech(
    body: TTSRequest,
    user_id: UserDep,
    session: DbDep,
) -> Response:
    settings = get_settings()
    if not settings.openai_tts_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Audio mode is not configured on this server.",
        )

    clean = _strip_markdown(body.text)
    if not clean:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Text is empty.")

    # OpenAI TTS max input is 4096 characters
    clean = clean[:4096]
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    voice_source = body.voice or user.tutor_voice
    voice = normalize_tutor_voice(voice_source, fallback=settings.openai_tts_voice)

    client = AsyncOpenAI(api_key=settings.openai_tts_api_key)
    try:
        tts_response = await client.audio.speech.create(
            model=DEFAULT_TTS_MODEL,
            voice=voice,  # type: ignore[arg-type]
            input=clean,
            response_format="mp3",
        )
        audio_bytes = tts_response.content
    except Exception:
        logger.exception("OpenAI TTS request failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Audio generation failed.")

    return Response(content=audio_bytes, media_type="audio/mpeg")
