from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_user_id
from app.core.config import get_settings
from app.core.rate_limit import rate_limit_ip
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db_session as get_db
from app.models.user import User
from app.services.tts_service import validate_tutor_voice

router = APIRouter(prefix="/auth", tags=["auth"])

_auth_settings = get_settings()
_auth_rate_limit = Depends(rate_limit_ip("auth", _auth_settings.rate_limit_auth_per_min))

DbDep = Annotated[AsyncSession, Depends(get_db)]


def display_tutor_name(value: str | None) -> str:
    clean = (value or "").strip()
    if clean.lower() == "knowledgepal":
        return "Sapient"
    return clean or "Sapient"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleAuthRequest(BaseModel):
    credential: str


class OnboardingRequest(BaseModel):
    name: str
    use_case: str


class TutorPreferencesRequest(BaseModel):
    tutor_name: str
    tutor_tone: str
    tutor_style: str
    tutor_instructions: str = ""
    tutor_voice: str = "nova"


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    name: str | None
    use_case: str | None
    onboarding_complete: bool
    tutor_name: str
    tutor_tone: str
    tutor_style: str
    tutor_instructions: str
    tutor_voice: str

    @classmethod
    def from_user(cls, user: User) -> "UserResponse":
        return cls(
            id=user.id,
            email=user.email,
            name=user.name,
            use_case=user.use_case,
            onboarding_complete=user.onboarding_complete,
            tutor_name=display_tutor_name(user.tutor_name),
            tutor_tone=user.tutor_tone,
            tutor_style=user.tutor_style,
            tutor_instructions=user.tutor_instructions,
            tutor_voice=user.tutor_voice,
        )


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_auth_rate_limit],
)
async def register(body: RegisterRequest, db: DbDep) -> TokenResponse:
    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered.")

    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return TokenResponse(access_token=create_access_token(user.id), user=UserResponse.from_user(user))


@router.post("/login", response_model=TokenResponse, dependencies=[_auth_rate_limit])
async def login(body: LoginRequest, db: DbDep) -> TokenResponse:
    user = await db.scalar(select(User).where(User.email == body.email))
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

    return TokenResponse(access_token=create_access_token(user.id), user=UserResponse.from_user(user))


@router.post("/google", response_model=TokenResponse, dependencies=[_auth_rate_limit])
async def login_with_google(body: GoogleAuthRequest, db: DbDep) -> TokenResponse:
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google sign-in is not configured.")

    try:
        payload = await run_in_threadpool(
            id_token.verify_oauth2_token,
            body.credential,
            google_requests.Request(),
            settings.google_client_id,
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google credential.")

    google_id = payload.get("sub")
    email = payload.get("email")
    email_verified = payload.get("email_verified")
    display_name = payload.get("name")

    if not google_id or not email or email_verified is not True:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google account could not be verified.")

    user = await db.scalar(select(User).where(User.google_id == google_id))
    if not user:
        user = await db.scalar(select(User).where(User.email == email))

    if user:
        user.google_id = user.google_id or google_id
        user.name = user.name or display_name
    else:
        user = User(email=email, google_id=google_id, name=display_name)
        db.add(user)

    await db.commit()
    await db.refresh(user)

    return TokenResponse(access_token=create_access_token(user.id), user=UserResponse.from_user(user))


@router.get("/me", response_model=UserResponse)
async def me(user_id: Annotated[int, Depends(get_user_id)], db: DbDep) -> UserResponse:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return UserResponse.from_user(user)


@router.post("/tutor", response_model=UserResponse)
async def update_tutor_preferences(
    body: TutorPreferencesRequest,
    user_id: Annotated[int, Depends(get_user_id)],
    db: DbDep,
) -> UserResponse:
    tutor_name = body.tutor_name.strip()
    tutor_tone = body.tutor_tone.strip()
    tutor_style = body.tutor_style.strip()
    tutor_instructions = body.tutor_instructions.strip()
    try:
        tutor_voice = validate_tutor_voice(body.tutor_voice)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if not tutor_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tutor name is required.")
    if not tutor_tone:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tutor tone is required.")
    if not tutor_style:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tutor style is required.")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    user.tutor_name = display_tutor_name(tutor_name)[:80]
    user.tutor_tone = tutor_tone[:80]
    user.tutor_style = tutor_style[:120]
    user.tutor_instructions = tutor_instructions[:1000]
    user.tutor_voice = tutor_voice
    await db.commit()
    await db.refresh(user)

    return UserResponse.from_user(user)


@router.post("/onboarding", response_model=UserResponse)
async def complete_onboarding(
    body: OnboardingRequest,
    user_id: Annotated[int, Depends(get_user_id)],
    db: DbDep,
) -> UserResponse:
    name = body.name.strip()
    use_case = body.use_case.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required.")
    if not use_case:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use case is required.")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    user.name = name[:255]
    user.use_case = use_case[:100]
    user.onboarding_complete = True
    await db.commit()
    await db.refresh(user)

    return UserResponse.from_user(user)
