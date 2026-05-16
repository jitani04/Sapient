from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.db.session import get_db_session
from app.models.assignment import Assignment, CalendarFeed
from app.schemas.assignment import (
    AssignmentCreate,
    AssignmentRead,
    AssignmentUpdate,
    CalendarFeedCreate,
    CalendarFeedRead,
    CalendarFeedSyncResponse,
    SmartReminderRead,
)
from app.services.calendar_service import build_smart_reminders, fetch_ical_events, sync_calendar_feed

router = APIRouter(tags=["assignments"])

DbDep = Annotated[AsyncSession, Depends(get_db_session)]
UserDep = Annotated[int, Depends(get_user_id)]


def _clean_optional(value: str | None) -> str | None:
    return value.strip() if value and value.strip() else None


def _normalize_feed_url(url: str) -> str:
    clean = url.strip()
    if clean.startswith("webcal://"):
        clean = f"https://{clean.removeprefix('webcal://')}"
    if not clean.startswith(("http://", "https://")):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Calendar URL must be http(s) or webcal.")
    return clean


def _ensure_timezone(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def _get_assignment(session: AsyncSession, user_id: int, assignment_id: int) -> Assignment:
    result = await session.execute(select(Assignment).where(Assignment.id == assignment_id, Assignment.user_id == user_id))
    assignment = result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")
    return assignment


async def _get_feed(session: AsyncSession, user_id: int, feed_id: int) -> CalendarFeed:
    result = await session.execute(select(CalendarFeed).where(CalendarFeed.id == feed_id, CalendarFeed.user_id == user_id))
    feed = result.scalar_one_or_none()
    if feed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar feed not found.")
    return feed


@router.get("/assignments", response_model=list[AssignmentRead])
async def list_assignments(
    user_id: UserDep,
    session: DbDep,
    subject: str | None = Query(None),
    include_completed: bool = Query(False),
) -> list[AssignmentRead]:
    stmt = select(Assignment).where(Assignment.user_id == user_id)
    if subject and subject.strip():
        stmt = stmt.where(func.lower(Assignment.subject) == subject.strip().lower())
    if not include_completed:
        stmt = stmt.where(Assignment.completed.is_(False))
    stmt = stmt.order_by(Assignment.due_at.asc(), Assignment.id.asc())
    result = await session.execute(stmt)
    return [AssignmentRead.model_validate(item) for item in result.scalars()]


@router.post("/assignments", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
async def create_assignment(
    payload: AssignmentCreate,
    user_id: UserDep,
    session: DbDep,
) -> AssignmentRead:
    assignment = Assignment(
        user_id=user_id,
        subject=_clean_optional(payload.subject),
        title=payload.title.strip(),
        description=_clean_optional(payload.description),
        due_at=_ensure_timezone(payload.due_at),
        source="manual",
        source_url=_clean_optional(payload.source_url),
    )
    session.add(assignment)
    await session.commit()
    await session.refresh(assignment)
    return AssignmentRead.model_validate(assignment)


@router.patch("/assignments/{assignment_id}", response_model=AssignmentRead)
async def update_assignment(
    assignment_id: int,
    payload: AssignmentUpdate,
    user_id: UserDep,
    session: DbDep,
) -> AssignmentRead:
    assignment = await _get_assignment(session, user_id, assignment_id)
    update = payload.model_dump(exclude_unset=True)
    if "title" in update and payload.title is not None:
        assignment.title = payload.title.strip()
    if "subject" in update:
        assignment.subject = _clean_optional(payload.subject)
    if "description" in update:
        assignment.description = _clean_optional(payload.description)
    if "source_url" in update:
        assignment.source_url = _clean_optional(payload.source_url)
    if payload.due_at is not None:
        assignment.due_at = _ensure_timezone(payload.due_at)
    if payload.completed is not None:
        assignment.completed = payload.completed
    await session.commit()
    await session.refresh(assignment)
    return AssignmentRead.model_validate(assignment)


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment(
    assignment_id: int,
    user_id: UserDep,
    session: DbDep,
) -> Response:
    assignment = await _get_assignment(session, user_id, assignment_id)
    await session.delete(assignment)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/calendar-feeds", response_model=list[CalendarFeedRead])
async def list_calendar_feeds(user_id: UserDep, session: DbDep) -> list[CalendarFeedRead]:
    result = await session.execute(
        select(CalendarFeed)
        .where(CalendarFeed.user_id == user_id)
        .order_by(CalendarFeed.created_at.desc(), CalendarFeed.id.desc())
    )
    return [CalendarFeedRead.model_validate(feed) for feed in result.scalars()]


@router.post("/calendar-feeds", response_model=CalendarFeedSyncResponse, status_code=status.HTTP_201_CREATED)
async def create_calendar_feed(
    payload: CalendarFeedCreate,
    user_id: UserDep,
    session: DbDep,
) -> CalendarFeedSyncResponse:
    feed = CalendarFeed(
        user_id=user_id,
        name=payload.name.strip(),
        url=_normalize_feed_url(payload.url),
        subject=_clean_optional(payload.subject),
        source="canvas",
    )
    session.add(feed)
    await session.flush()
    total, imported = await _fetch_and_sync_feed(session=session, user_id=user_id, feed=feed)
    await session.refresh(feed)
    return CalendarFeedSyncResponse(feed=CalendarFeedRead.model_validate(feed), imported_count=imported, total_events=total)


@router.post("/calendar-feeds/{feed_id}/sync", response_model=CalendarFeedSyncResponse)
async def sync_calendar_feed_endpoint(
    feed_id: int,
    user_id: UserDep,
    session: DbDep,
) -> CalendarFeedSyncResponse:
    feed = await _get_feed(session, user_id, feed_id)
    total, imported = await _fetch_and_sync_feed(session=session, user_id=user_id, feed=feed)
    await session.refresh(feed)
    return CalendarFeedSyncResponse(feed=CalendarFeedRead.model_validate(feed), imported_count=imported, total_events=total)


@router.delete("/calendar-feeds/{feed_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_calendar_feed(feed_id: int, user_id: UserDep, session: DbDep) -> Response:
    feed = await _get_feed(session, user_id, feed_id)
    await session.delete(feed)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/assignments/reminders", response_model=list[SmartReminderRead])
async def list_smart_reminders(user_id: UserDep, session: DbDep) -> list[SmartReminderRead]:
    reminders = await build_smart_reminders(session=session, user_id=user_id)
    return [SmartReminderRead(**item) for item in reminders]


async def _fetch_and_sync_feed(*, session: AsyncSession, user_id: int, feed: CalendarFeed) -> tuple[int, int]:
    try:
        events = await fetch_ical_events(feed.url)
    except httpx.HTTPError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not fetch that calendar feed.") from exc
    imported = await sync_calendar_feed(session=session, user_id=user_id, feed=feed, events=events)
    return len(events), imported
