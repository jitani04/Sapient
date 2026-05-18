from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_user_id
from app.db.session import get_db_session
from app.models.resource import Resource
from app.schemas.resource import ResourceRead

router = APIRouter(tags=["resources"])


@router.get("/projects/{subject}/resources", response_model=list[ResourceRead])
async def list_subject_resources(
    subject: str,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[ResourceRead]:
    result = await session.execute(
        select(Resource)
        .where(Resource.user_id == user_id, Resource.subject == subject)
        .order_by(Resource.created_at.desc(), Resource.id.desc())
    )
    return [ResourceRead.model_validate(r) for r in result.scalars()]


@router.get("/conversations/{conversation_id}/resources", response_model=list[ResourceRead])
async def list_conversation_resources(
    conversation_id: int,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[ResourceRead]:
    result = await session.execute(
        select(Resource)
        .where(Resource.user_id == user_id, Resource.conversation_id == conversation_id)
        .order_by(Resource.created_at.asc(), Resource.id.asc())
    )
    return [ResourceRead.model_validate(r) for r in result.scalars()]


@router.delete("/resources/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resource(
    resource_id: int,
    user_id: Annotated[int, Depends(get_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    result = await session.execute(
        select(Resource).where(Resource.id == resource_id, Resource.user_id == user_id)
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found.")
    await session.execute(delete(Resource).where(Resource.id == resource_id))
    await session.commit()
