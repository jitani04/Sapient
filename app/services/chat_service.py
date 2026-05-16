import logging
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import ToolMessage as LCToolMessage
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.key_idea import KeyIdea
from app.models.message import Message, MessageRole
from app.models.quiz import Quiz
from app.services import retriever
from app.services.conversation_service import get_conversation_for_user
from app.services.llm_service import LLMService
from app.services.prompt_builder import ChatTurn, build_responses_input
from app.services.web_image_service import WebImageError, WebImageService

logger = logging.getLogger(__name__)

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "generate_quiz",
            "description": (
                "Generate a structured quiz question to formally assess student understanding. "
                "Use this when you want a tracked knowledge check, not just a conversational question. "
                "Prefer multiple_choice for concept checks; short_answer for applied or open-ended questions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The quiz question.",
                    },
                    "concept": {
                        "type": "string",
                        "description": "The specific concept being assessed, e.g. 'CSS Box Model' or 'Binary Search'.",
                    },
                    "quiz_type": {
                        "type": "string",
                        "enum": ["multiple_choice", "short_answer"],
                    },
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "3-4 choices for multiple_choice. Omit for short_answer.",
                    },
                    "correct_answer": {
                        "type": "string",
                        "description": "The correct answer. For multiple_choice, must match one option exactly.",
                    },
                    "explanation": {
                        "type": "string",
                        "description": "Explanation shown to the student after they answer.",
                    },
                },
                "required": ["question", "concept", "quiz_type", "correct_answer", "explanation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_key_idea",
            "description": (
                "Save an important concept or insight to the student's session notes. "
                "Call this when you've explained something the student now understands, corrected a misconception, "
                "or identified a definition worth keeping. Keep concept short (3-6 words) and summary to 1-2 sentences."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "concept": {
                        "type": "string",
                        "description": "Short name for the concept, e.g. 'SQL LEFT JOIN' or 'Null Hypothesis'.",
                    },
                    "summary": {
                        "type": "string",
                        "description": "1-2 sentence plain-English explanation the student should keep.",
                    },
                },
                "required": ["concept", "summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_diagram",
            "description": (
                "Generate a Mermaid diagram to illustrate a concept. "
                "Use this whenever a concept is spatial, structural, or relational — "
                "e.g. flowcharts, hierarchies, process steps, sequences, state machines, "
                "ER diagrams, or anything better shown than described. "
                "Output valid Mermaid source code that mermaid.js can render directly.\n\n"
                "SUPPORTED DIAGRAM TYPES (pick the simplest one that fits):\n"
                "- `flowchart TD` / `flowchart LR`: trees, hierarchies, processes, decision flows.\n"
                "- `sequenceDiagram`: interactions over time between named actors.\n"
                "- `stateDiagram-v2`: state machines.\n"
                "- `classDiagram`: class/relationship structure.\n"
                "- `erDiagram`: entity-relationship.\n"
                "- `mindmap`: brainstormed concept clusters.\n\n"
                "RULES:\n"
                "- Output ONLY the Mermaid source. Do NOT wrap it in ``` fences or markdown.\n"
                "- Keep it small: aim for 4–12 nodes. Bigger diagrams overwhelm students.\n"
                "- Quote node labels that contain spaces or punctuation: `A[\"Fine Art\"]`.\n"
                "- Use short, descriptive labels — no full sentences.\n"
                "- Prefer top-down (`TD`) for hierarchies, left-right (`LR`) for processes.\n\n"
                "EXAMPLE (hierarchy):\n"
                "flowchart TD\n"
                "  Art[\"Art\"]\n"
                "  Art --> Fine[\"Fine Art\"]\n"
                "  Art --> Applied[\"Applied Art\"]\n"
                "  Art --> Crafts[\"Crafts\"]\n\n"
                "EXAMPLE (process):\n"
                "flowchart LR\n"
                "  A[\"Client SYN\"] --> B[\"Server SYN-ACK\"] --> C[\"Client ACK\"] --> D[\"Connection Open\"]"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "source": {
                        "type": "string",
                        "description": "Raw Mermaid source code, no fences.",
                    },
                    "title": {
                        "type": "string",
                        "description": "Short diagram title, e.g. 'TCP Three-Way Handshake'.",
                    },
                },
                "required": ["source", "title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_image",
            "description": (
                "Find a real-world educational stock/web image to show the student. "
                "Use this when the student asks for a picture/photo, when a real visual reference would help "
                "more than a generated diagram, or when a lecture asks to show a concrete object, organism, "
                "historical artifact, place, lab setup, graph-like visual, or visual analogy. "
                "Do not use this for abstract relationships better represented by create_diagram."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for the image provider, e.g. 'mitosis microscope slide'.",
                    },
                    "caption": {
                        "type": "string",
                        "description": "Short student-facing caption explaining why this image is useful.",
                    },
                },
                "required": ["query", "caption"],
            },
        },
    },
]


@dataclass(slots=True)
class SseEvent:
    event: str
    data: dict[str, Any]


def _clean_generated_title(value: str) -> str:
    title = " ".join(value.strip().strip("\"'`").split())
    title = title.removeprefix("Title:").strip()
    return title[:120].rstrip(" .,:;-") or "Study session"


async def _generate_conversation_title(
    *,
    llm_service: LLMService,
    subject: str | None,
    user_message: str,
    assistant_message: str,
) -> str | None:
    prompt = (
        "Create a concise title for a student tutoring session.\n"
        "- Return only the title, no quotes, markdown, or explanation.\n"
        "- Use title case unless the title includes code terms.\n"
        "- Keep it under 7 words and under 60 characters.\n"
        "- Do not copy the student's first message verbatim.\n"
        "- Make it specific to the topic or task.\n\n"
        f"Subject: {subject or 'General'}\n"
        f"Student first message: {user_message[:1200]}\n"
        f"Tutor first response: {assistant_message[:1200]}"
    )
    try:
        title = await llm_service.generate_text(
            input_messages=[
                {"role": "system", "content": "You write short, useful study-session titles."},
                {"role": "user", "content": prompt},
            ]
        )
        return _clean_generated_title(title)
    except Exception as exc:  # noqa: BLE001 - title generation should never block tutoring.
        logger.warning("Conversation title generation failed", extra={"error": str(exc)})
        return None


async def _save_key_idea(
    *,
    session: AsyncSession,
    user_id: int,
    conversation_id: int,
    subject: str | None,
    concept: str,
    summary: str,
) -> KeyIdea:
    idea = KeyIdea(
        user_id=user_id,
        conversation_id=conversation_id,
        subject=subject,
        concept=concept,
        summary=summary,
    )
    session.add(idea)
    await session.commit()
    await session.refresh(idea)
    return idea


async def _save_quiz(
    *,
    session: AsyncSession,
    conversation_id: int,
    question: str,
    concept: str | None,
    quiz_type: str,
    correct_answer: str,
    explanation: str,
    options: list[str] | None = None,
) -> Quiz:
    quiz = Quiz(
        conversation_id=conversation_id,
        question=question,
        concept=concept,
        quiz_type=quiz_type,
        options=options,
        correct_answer=correct_answer,
        explanation=explanation,
    )
    session.add(quiz)
    await session.commit()
    await session.refresh(quiz)
    return quiz


async def stream_chat(
    *,
    session: AsyncSession,
    llm_service: LLMService,
    conversation_id: int,
    user_id: int,
    user_message: str,
    system_prompt: str,
    image_service: WebImageService | None = None,
    preference_summary: str | None = None,
    preference_memories: list[str] | None = None,
) -> AsyncIterator[SseEvent]:
    turn_start_ms = time.monotonic() * 1000
    conv = await get_conversation_for_user(session=session, conversation_id=conversation_id, user_id=user_id)
    subject = conv.subject

    user_msg = Message(conversation_id=conversation_id, role=MessageRole.USER, content=user_message)
    session.add(user_msg)
    await session.commit()
    await session.refresh(user_msg)

    history_result = await session.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    )
    history_messages = list(history_result.scalars())

    retrieved_context = await retriever.retrieve_context(
        session=session,
        user_id=user_id,
        conversation_id=conversation_id,
        query=user_message,
        subject=subject,
    )

    history_turns: list[ChatTurn] = [
        {"role": msg.role.value, "content": msg.content}
        for msg in history_messages
        if msg.id != user_msg.id
    ]
    should_generate_title = (
        not conv.is_lecture
        and not conv.title
        and not conv.title_manually_edited
        and not any(msg.role == MessageRole.USER and msg.id != user_msg.id for msg in history_messages)
    )

    input_messages = build_responses_input(
        system_prompt=system_prompt,
        history=history_turns,
        user_query=user_message,
        retrieved_context=retrieved_context,
        preference_summary=preference_summary,
        preference_memories=preference_memories,
    )

    yield SseEvent(event="start", data={"conversation_id": conversation_id, "message_id": None})
    yield SseEvent(
        event="sources",
        data={
            "sources": [
                {
                    "chunk_id": c.chunk_id,
                    "material_id": c.material_id,
                    "material_filename": c.material_filename,
                    "subject": c.subject,
                    "page_number": c.page_number,
                    "snippet": c.snippet,
                    "similarity_score": round(c.similarity_score, 4),
                }
                for c in retrieved_context
            ]
        },
    )

    assistant_parts: list[str] = []
    usage: dict[str, Any] | None = None
    ai_message_chunk = None
    tool_calls_data: list[dict[str, Any]] = []
    quiz_ids_this_turn: list[int] = []

    try:
        async for event in llm_service.stream_with_tools(input_messages=input_messages, tools=AGENT_TOOLS):
            if event.type == "token" and event.delta:
                assistant_parts.append(event.delta)
                yield SseEvent(event="token", data={"delta": event.delta})
            elif event.type == "tool_call_ready":
                tool_calls_data = event.tool_calls or []
                ai_message_chunk = event.ai_message
            elif event.type == "completed":
                usage = event.usage

        if tool_calls_data and ai_message_chunk is not None:
            lc_tool_messages = []
            pending_quiz_events: list[dict[str, Any]] = []

            for tc in tool_calls_data:
                if tc["name"] == "generate_quiz":
                    args = tc["args"]
                    quiz = await _save_quiz(
                        session=session,
                        conversation_id=conversation_id,
                        question=args["question"],
                        concept=args.get("concept"),
                        quiz_type=args["quiz_type"],
                        options=args.get("options"),
                        correct_answer=args["correct_answer"],
                        explanation=args["explanation"],
                    )
                    quiz_ids_this_turn.append(quiz.id)
                    lc_tool_messages.append(
                        LCToolMessage(
                            content=f"Quiz (ID: {quiz.id}) saved and displayed to the student.",
                            tool_call_id=tc["id"],
                        )
                    )
                    pending_quiz_events.append({
                        "quiz_id": quiz.id,
                        "question": quiz.question,
                        "concept": quiz.concept,
                        "quiz_type": quiz.quiz_type,
                        "options": quiz.options,
                    })

                elif tc["name"] == "create_diagram":
                    args = tc["args"]
                    raw_source = args.get("source", "")
                    source = raw_source.strip() if isinstance(raw_source, str) else ""
                    # Strip accidental markdown fences the model sometimes emits anyway.
                    if source.startswith("```"):
                        source = source.split("\n", 1)[1] if "\n" in source else ""
                        if source.endswith("```"):
                            source = source[: -3].rstrip()
                    lc_tool_messages.append(
                        LCToolMessage(
                            content="Diagram created and displayed to the student.",
                            tool_call_id=tc["id"],
                        )
                    )
                    if source:
                        yield SseEvent(event="diagram", data={
                            "id": str(uuid.uuid4())[:8],
                            "source": source,
                            "title": args.get("title"),
                        })

                elif tc["name"] == "find_image":
                    args = tc["args"]
                    query = str(args.get("query", "")).strip()
                    caption = str(args.get("caption", "")).strip()
                    image_result: dict[str, str] | None = None

                    if image_service is not None and query:
                        try:
                            results = await image_service.search_images(query, per_page=1)
                            image_result = results[0] if results else None
                        except WebImageError as exc:
                            logger.info(
                                "Image search unavailable",
                                extra={"conversation_id": conversation_id, "user_id": user_id, "error": str(exc)},
                            )
                        except Exception as exc:  # noqa: BLE001 - image search must not break tutoring.
                            logger.warning(
                                "Image search failed",
                                extra={"conversation_id": conversation_id, "user_id": user_id, "error": str(exc)},
                            )

                    if image_result:
                        artifact_id = str(uuid.uuid4())[:8]
                        yield SseEvent(event="image", data={
                            "id": artifact_id,
                            "provider_id": image_result["id"],
                            "query": query,
                            "caption": caption or query,
                            "image_url": image_result["image_url"],
                            "thumbnail_url": image_result["thumbnail_url"],
                            "creator": image_result["creator"],
                            "creator_url": image_result["creator_url"],
                            "license": image_result["license"],
                            "license_url": image_result["license_url"],
                            "source_url": image_result["source_url"],
                            "source": image_result["source"],
                        })
                        tool_content = f"Image for '{query}' found and displayed to the student."
                    else:
                        tool_content = (
                            f"No suitable image could be displayed for '{query}'."
                            if query else "No image query was provided, so no image was displayed."
                        )

                    lc_tool_messages.append(
                        LCToolMessage(
                            content=tool_content,
                            tool_call_id=tc["id"],
                        )
                    )

                elif tc["name"] == "save_key_idea":
                    args = tc["args"]
                    idea = await _save_key_idea(
                        session=session,
                        user_id=user_id,
                        conversation_id=conversation_id,
                        subject=subject,
                        concept=args["concept"],
                        summary=args["summary"],
                    )
                    lc_tool_messages.append(
                        LCToolMessage(
                            content=f"Key idea '{idea.concept}' saved to student's notes.",
                            tool_call_id=tc["id"],
                        )
                    )
                    yield SseEvent(event="key_idea", data={
                        "id": idea.id,
                        "concept": idea.concept,
                        "summary": idea.summary,
                    })

            # Second pass: stream follow-up text, then emit quiz cards
            original_lc = llm_service.to_langchain_messages(input_messages)
            second_pass = original_lc + [ai_message_chunk] + lc_tool_messages

            async for event in llm_service.stream_lc(lc_messages=second_pass):
                if event.type == "token" and event.delta:
                    assistant_parts.append(event.delta)
                    yield SseEvent(event="token", data={"delta": event.delta})
                elif event.type == "completed":
                    usage = event.usage

            for quiz_data in pending_quiz_events:
                yield SseEvent(event="quiz", data=quiz_data)

        assistant_content = "".join(assistant_parts).strip() or "(No response content)"

        assistant_msg = Message(
            conversation_id=conversation_id,
            role=MessageRole.ASSISTANT,
            content=assistant_content,
        )
        session.add(assistant_msg)
        await session.commit()
        await session.refresh(assistant_msg)

        # Backfill the message_id link onto any quizzes created during this turn,
        # so they render inline below the assistant message instead of in a
        # separate artifacts pile.
        if quiz_ids_this_turn:
            await session.execute(
                sa_update(Quiz)
                .where(Quiz.id.in_(quiz_ids_this_turn))
                .values(message_id=assistant_msg.id)
            )
            await session.commit()

        generated_title: str | None = None
        if should_generate_title:
            generated_title = await _generate_conversation_title(
                llm_service=llm_service,
                subject=subject,
                user_message=user_message,
                assistant_message=assistant_content,
            )
            if generated_title:
                conv.title = generated_title
                await session.commit()
                yield SseEvent(event="conversation_title", data={"title": generated_title})

        latency_ms = int(time.monotonic() * 1000 - turn_start_ms)
        retrieved_chunk_ids = [c.chunk_id for c in retrieved_context]
        tool_trace = [
            {
                "name": tc.get("name"),
                "args": tc.get("args"),
            }
            for tc in tool_calls_data
        ]

        yield SseEvent(
            event="end",
            data={
                "assistant_message_id": assistant_msg.id,
                "usage": usage,
                "latency_ms": latency_ms,
                "retrieved_chunk_ids": retrieved_chunk_ids,
                "tool_trace": tool_trace,
            },
        )

    except Exception as exc:
        logger.exception("Streaming chat failed", extra={"conversation_id": conversation_id, "user_id": user_id})
        await session.rollback()
        yield SseEvent(event="error", data={"error": str(exc)})
