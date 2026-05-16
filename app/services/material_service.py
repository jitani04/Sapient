import asyncio
import re
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

from pypdf import PdfReader
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models.material import Material, MaterialStatus
from app.models.material_chunk import MaterialChunk
from app.services import s3_client
from app.services.embedding_service import create_embedding_service
from app.services.errors import MaterialNotFoundError

SUPPORTED_SUFFIXES = {".pdf", ".pptx", ".docx", ".txt", ".md"}


@dataclass(slots=True)
class ExtractedBlock:
    text: str
    page_number: int | None = None


@dataclass(slots=True)
class ChunkPayload:
    chunk_index: int
    content: str
    char_start: int
    char_end: int
    page_number: int | None


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def sanitize_filename(filename: str) -> str:
    candidate = Path(filename or "upload").name.strip()
    return candidate or "upload"


def validate_material_filename(filename: str) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ValueError("Only PDF, PPTX, DOCX, TXT, and MD uploads are supported.")


def build_user_key_prefix(user_id: int) -> str:
    return f"user-{user_id}/"


def build_upload_key(*, user_id: int, filename: str) -> str:
    clean = sanitize_filename(filename)
    return f"{build_user_key_prefix(user_id)}uploads/{uuid.uuid4()}/{clean}"


def key_belongs_to_user(*, user_id: int, key: str) -> bool:
    return key.startswith(build_user_key_prefix(user_id))


async def list_materials_for_user(
    *,
    session: AsyncSession,
    user_id: int,
    subject: str | None = None,
) -> list[Material]:
    query = select(Material).where(Material.user_id == user_id)
    if subject and subject.strip():
        query = query.where(func.lower(Material.subject) == subject.strip().lower())
    result = await session.execute(query.order_by(Material.created_at.desc(), Material.id.desc()))
    return list(result.scalars())


async def get_material_for_user(*, session: AsyncSession, user_id: int, material_id: int) -> Material:
    result = await session.execute(
        select(Material).where(Material.id == material_id, Material.user_id == user_id)
    )
    material = result.scalar_one_or_none()
    if material is None:
        raise MaterialNotFoundError
    return material


async def create_material_from_key(
    *,
    session: AsyncSession,
    user_id: int,
    filename: str,
    mime_type: str,
    subject: str | None,
    key: str,
) -> Material:
    settings = get_settings()
    clean_filename = sanitize_filename(filename)
    validate_material_filename(clean_filename)

    if not key_belongs_to_user(user_id=user_id, key=key):
        raise ValueError("Upload key does not belong to the current user.")

    head = await s3_client.head_object(key=key)
    if head is None:
        raise ValueError("Uploaded object not found. Please retry the upload.")

    content_length = int(head.get("ContentLength", 0))
    if content_length <= 0:
        raise ValueError("Uploaded object is empty.")
    if content_length > settings.upload_max_bytes:
        await s3_client.delete_object(key=key)
        raise ValueError(f"Upload exceeds the {settings.upload_max_bytes} byte limit.")

    material = Material(
        user_id=user_id,
        filename=clean_filename,
        storage_path=key,
        mime_type=mime_type or "application/octet-stream",
        subject=(subject or "").strip() or None,
        status=MaterialStatus.PROCESSING,
        error_message=None,
    )
    session.add(material)
    await session.commit()
    await session.refresh(material)
    return material


async def delete_material(*, session: AsyncSession, user_id: int, material_id: int) -> None:
    material = await get_material_for_user(session=session, user_id=user_id, material_id=material_id)
    key = material.storage_path
    await session.delete(material)
    await session.commit()
    if key:
        try:
            await s3_client.delete_object(key=key)
        except Exception:
            pass


async def process_material_ingestion(material_id: int) -> None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(select(Material).where(Material.id == material_id))
        material = result.scalar_one_or_none()
        if material is None:
            return

        try:
            chunks = await build_chunks_for_material(material)
            if not chunks:
                raise ValueError("No readable text found in the uploaded material.")

            embedding_service = create_embedding_service()
            embeddings = await embedding_service.embed_documents([chunk.content for chunk in chunks])
            await session.execute(delete(MaterialChunk).where(MaterialChunk.material_id == material.id))
            session.add_all(
                [
                    MaterialChunk(
                        material_id=material.id,
                        chunk_index=chunk.chunk_index,
                        content=chunk.content,
                        embedding=embedding,
                        char_start=chunk.char_start,
                        char_end=chunk.char_end,
                        page_number=chunk.page_number,
                    )
                    for chunk, embedding in zip(chunks, embeddings, strict=True)
                ]
            )
            material.status = MaterialStatus.READY
            material.error_message = None
            material.processed_at = datetime.now(timezone.utc)
            await session.commit()
        except Exception as exc:
            await session.rollback()
            await mark_material_failed(material_id=material_id, error_message=str(exc))


async def mark_material_failed(*, material_id: int, error_message: str) -> None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(select(Material).where(Material.id == material_id))
        material = result.scalar_one_or_none()
        if material is None:
            return

        material.status = MaterialStatus.FAILED
        material.error_message = error_message[:500]
        material.processed_at = datetime.now(timezone.utc)
        await session.commit()


async def build_chunks_for_material(material: Material) -> list[ChunkPayload]:
    settings = get_settings()
    suffix = Path(material.filename).suffix.lower() or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        await s3_client.download_to_file(key=material.storage_path, destination=str(tmp_path))
        blocks = await extract_material_blocks(tmp_path)
    finally:
        await asyncio.to_thread(tmp_path.unlink, True)

    return chunk_blocks(
        blocks,
        chunk_size=settings.rag_chunk_size,
        chunk_overlap=settings.rag_chunk_overlap,
    )


async def extract_material_blocks(path: Path) -> list[ExtractedBlock]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return await asyncio.to_thread(_extract_pdf_blocks, path)
    if suffix == ".pptx":
        return await asyncio.to_thread(_extract_pptx_blocks, path)
    if suffix == ".docx":
        return await asyncio.to_thread(_extract_docx_blocks, path)

    content = await asyncio.to_thread(path.read_bytes)
    text = content.decode("utf-8", errors="ignore")
    normalized = _normalize_text(text)
    if not normalized:
        return []
    return [ExtractedBlock(text=normalized)]


def chunk_blocks(blocks: list[ExtractedBlock], *, chunk_size: int, chunk_overlap: int) -> list[ChunkPayload]:
    if chunk_size <= 0:
        raise ValueError("Chunk size must be positive.")
    if chunk_overlap < 0 or chunk_overlap >= chunk_size:
        raise ValueError("Chunk overlap must be between 0 and chunk size - 1.")

    chunks: list[ChunkPayload] = []
    chunk_index = 0
    step = chunk_size - chunk_overlap

    for block in blocks:
        if not block.text:
            continue

        start = 0
        text_length = len(block.text)
        while start < text_length:
            end = min(text_length, start + chunk_size)
            content = block.text[start:end].strip()
            if content:
                chunks.append(
                    ChunkPayload(
                        chunk_index=chunk_index,
                        content=content,
                        char_start=start,
                        char_end=end,
                        page_number=block.page_number,
                    )
                )
                chunk_index += 1

            if end >= text_length:
                break
            start += step

    return chunks


def _extract_pdf_blocks(path: Path) -> list[ExtractedBlock]:
    reader = PdfReader(str(path))
    blocks: list[ExtractedBlock] = []
    for index, page in enumerate(reader.pages, start=1):
        normalized = _normalize_text(page.extract_text() or "")
        if normalized:
            blocks.append(ExtractedBlock(text=normalized, page_number=index))
    return blocks


def _zip_member_sort_key(name: str) -> tuple[str, int]:
    match = re.search(r"(\d+)(?=\.xml$)", name)
    return (name.rsplit("/", 1)[0], int(match.group(1)) if match else 0)


def _extract_text_from_xml(xml_bytes: bytes) -> str:
    try:
        root = ElementTree.fromstring(xml_bytes)
    except ElementTree.ParseError:
        return ""

    text_parts = [
        element.text or ""
        for element in root.iter()
        if element.tag.endswith("}t") and element.text
    ]
    return _normalize_text(" ".join(text_parts))


def _extract_pptx_blocks(path: Path) -> list[ExtractedBlock]:
    blocks: list[ExtractedBlock] = []
    try:
        with zipfile.ZipFile(path) as archive:
            slide_names = sorted(
                (
                    name
                    for name in archive.namelist()
                    if name.startswith("ppt/slides/slide") and name.endswith(".xml")
                ),
                key=_zip_member_sort_key,
            )
            for slide_number, slide_name in enumerate(slide_names, start=1):
                text = _extract_text_from_xml(archive.read(slide_name))
                if text:
                    blocks.append(ExtractedBlock(text=text, page_number=slide_number))
    except zipfile.BadZipFile as exc:
        raise ValueError("Uploaded PPTX file is not readable.") from exc

    return blocks


def _extract_docx_blocks(path: Path) -> list[ExtractedBlock]:
    try:
        with zipfile.ZipFile(path) as archive:
            try:
                text = _extract_text_from_xml(archive.read("word/document.xml"))
            except KeyError as exc:
                raise ValueError("Uploaded DOCX file is missing document text.") from exc
    except zipfile.BadZipFile as exc:
        raise ValueError("Uploaded DOCX file is not readable.") from exc

    return [ExtractedBlock(text=text)] if text else []
