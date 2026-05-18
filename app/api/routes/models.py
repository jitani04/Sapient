from fastapi import APIRouter

from app.services.llm_service import SUPPORTED_MODELS

router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
async def list_models_endpoint() -> list[dict[str, str]]:
    return SUPPORTED_MODELS
