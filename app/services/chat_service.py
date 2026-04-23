import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import ToolMessage as LCToolMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.key_idea import KeyIdea
from app.models.message import Message, MessageRole
from app.models.quiz import Quiz
from app.services import retriever
from app.services.conversation_service import get_conversation_for_user
from app.services.llm_service import LLMService
from app.services.prompt_builder import ChatTurn, build_responses_input

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
                "required": ["question", "quiz_type", "correct_answer", "explanation"],
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
                "Generate a visual Excalidraw diagram to illustrate a concept. "
                "Use this whenever a concept is spatial, structural, or relational — "
                "e.g. system architectures, flowcharts, process steps, hierarchies, "
                "comparisons, cause-and-effect, geometry, or anything better shown than described. "
                "Keep diagrams simple: 4-10 elements.\n\n"
                "Each element in the JSON array requires these fields:\n"
                '{ "id": "<unique 8-char string>", '
                '"type": "rectangle"|"ellipse"|"diamond"|"arrow"|"line"|"text", '
                '"x": <number>, "y": <number>, "width": <number>, "height": <number>, '
                '"angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", '
                '"fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid", '
                '"roughness": 1, "opacity": 100, "groupIds": [], "frameId": null, '
                '"roundness": null, "seed": <random int>, "version": 1, "versionNonce": 0, '
                '"isDeleted": false, "boundElements": null, "updated": 0, "link": null, "locked": false }\n'
                'Text elements also need: "text": "label", "fontSize": 16, "fontFamily": 1, '
                '"textAlign": "center", "verticalAlign": "middle", "containerId": null, "lineHeight": 1.25\n'
                'Arrow elements also need: "points": [[0,0],[dx,dy]], "startBinding": null, '
                '"endBinding": null, "startArrowhead": null, "endArrowhead": "arrow", "elbowed": false\n\n'
                "Place elements starting around x:100, y:80. Space them 150-200px apart. "
                "Use separate text elements as labels, centered over shapes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "elements": {
                        "type": "string",
                        "description": "JSON array string of Excalidraw elements.",
                    },
                    "title": {
                        "type": "string",
                        "description": "Short diagram title, e.g. 'TCP Three-Way Handshake'.",
                    },
                },
                "required": ["elements", "title"],
            },
        },
    },
]


@dataclass(slots=True)
class SseEvent:
    event: str
    data: dict[str, Any]


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
    quiz_type: str,
    correct_answer: str,
    explanation: str,
    options: list[str] | None = None,
) -> Quiz:
    quiz = Quiz(
        conversation_id=conversation_id,
        question=question,
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
) -> AsyncIterator[SseEvent]:
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
    )

    history_turns: list[ChatTurn] = [
        {"role": msg.role.value, "content": msg.content}
        for msg in history_messages
        if msg.id != user_msg.id
    ]

    input_messages = build_responses_input(
        system_prompt=system_prompt,
        history=history_turns,
        user_query=user_message,
        retrieved_context=retrieved_context,
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
                        quiz_type=args["quiz_type"],
                        options=args.get("options"),
                        correct_answer=args["correct_answer"],
                        explanation=args["explanation"],
                    )
                    lc_tool_messages.append(
                        LCToolMessage(
                            content=f"Quiz (ID: {quiz.id}) saved and displayed to the student.",
                            tool_call_id=tc["id"],
                        )
                    )
                    pending_quiz_events.append({
                        "quiz_id": quiz.id,
                        "question": quiz.question,
                        "quiz_type": quiz.quiz_type,
                        "options": quiz.options,
                    })

                elif tc["name"] == "create_diagram":
                    args = tc["args"]
                    raw = args.get("elements", "[]")
                    try:
                        elements = json.loads(raw) if isinstance(raw, str) else raw
                        for el in elements:
                            if not el.get("id"):
                                el["id"] = str(uuid.uuid4())[:8]
                    except (json.JSONDecodeError, TypeError, AttributeError):
                        elements = []
                    lc_tool_messages.append(
                        LCToolMessage(
                            content="Diagram created and displayed to the student.",
                            tool_call_id=tc["id"],
                        )
                    )
                    if elements:
                        yield SseEvent(event="diagram", data={
                            "id": str(uuid.uuid4())[:8],
                            "elements": elements,
                            "title": args.get("title"),
                        })

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

        yield SseEvent(
            event="end",
            data={"assistant_message_id": assistant_msg.id, "usage": usage},
        )

    except Exception as exc:
        logger.exception("Streaming chat failed", extra={"conversation_id": conversation_id, "user_id": user_id})
        await session.rollback()
        yield SseEvent(event="error", data={"error": str(exc)})
