import logging
import re
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
from app.models.resource import Resource
from app.services import retriever
from app.services.conversation_service import get_conversation_for_user
from app.services.llm_service import LLMService
from app.services.prompt_builder import ChatTurn, build_responses_input
from app.services.resource_service import YouTubeResourceProvider
from app.services.web_image_service import WebImageError, WebImageService
from app.services.web_search_service import LangSearchWebSearch, WebSearchResult

logger = logging.getLogger(__name__)

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "generate_quiz",
            "description": (
                "Generate a structured quiz question to formally assess student understanding. "
                "Use this when you want a tracked knowledge check, not just a conversational question. "
                "Prefer multiple_choice for concept checks; short_answer for applied or open-ended questions. "
                "IMPORTANT: do NOT also write the question text, the answer options, or the explanation in "
                "your message — the quiz card renders all of that. Your accompanying message should at most "
                "set up the quiz in one short sentence ('Here's a quick check:'); the card is the source of "
                "truth and repeating it produces duplicate content."
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
                "- ALWAYS wrap node labels in double quotes: `A[\"Fine Art\"]`. Never write unquoted "
                "labels — parentheses, colons, commas, equals signs, single quotes, or any non-alphanumeric "
                "character inside `[]` will break the parser unless the whole label is quoted.\n"
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
    {
        "type": "function",
        "function": {
            "name": "find_resource",
            "description": (
                "Recommend ONE external learning resource (YouTube tutorial or web article) to the student. "
                "MUST call this when the student asks for resources, recommendations, links, a video, an "
                "article, a tutorial, a textbook, or 'where can I learn more' — do not just describe categories "
                "of resources in prose; actually call the tool so the student gets a clickable card. Also call "
                "it when the student is clearly struggling with a concept and a different explanation from "
                "outside would help, even if they did not explicitly ask. "
                "Call this tool at most twice per turn, and only if the second call is meaningfully different "
                "from the first — e.g. one video + one article, or two clearly different sub-topics. Do NOT "
                "call it twice with near-identical queries; the deduper will skip duplicates and the student "
                "will see nothing the second time. "
                "IMPORTANT: do NOT also write the URL, the resource title, or a description of the resource "
                "in your message — the resource card renders the title, link, and reason. Your accompanying "
                "message should focus on teaching content, not on summarizing what the card already shows."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": (
                            "Concept the resource should cover, e.g. 'integration by parts derivation' "
                            "or 'CRISPR Cas9 mechanism'. Used as the search query."
                        ),
                    },
                    "kind": {
                        "type": "string",
                        "enum": ["video", "article"],
                        "description": (
                            "'video' fetches a YouTube tutorial — best for visual or procedural topics. "
                            "'article' fetches a web article — best for definitions, deep dives, or "
                            "when the student wants to read."
                        ),
                    },
                    "reason": {
                        "type": "string",
                        "description": (
                            "Short student-facing caption explaining WHY this resource will help them right now."
                        ),
                    },
                },
                "required": ["topic", "kind", "reason"],
            },
        },
    },
]

WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the public web for outside or current information. "
            "Use this when the student explicitly asks to search the web, asks for current/latest facts, "
            "or asks for examples or references beyond uploaded study materials. "
            "Do not use this for questions fully answered by the student's study materials or conversation context."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A focused search query.",
                },
                "freshness": {
                    "type": "string",
                    "enum": ["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"],
                    "description": "Optional time filter. Use noLimit unless recency matters.",
                },
            },
            "required": ["query"],
        },
    },
}


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


def _format_web_search_results(results: list[WebSearchResult]) -> str:
    if not results:
        return "No web search results were found. Say that clearly and answer from study materials or general knowledge only if appropriate."

    lines = [
        "Web search results. Use only these results for web-sourced claims, cite sources inline as [Web 1], [Web 2], etc., and do not overstate snippets as complete evidence.",
    ]
    for index, result in enumerate(results, start=1):
        content = result.summary or result.snippet
        date_bits = []
        if result.published_at:
            date_bits.append(f"published {result.published_at}")
        if result.crawled_at:
            date_bits.append(f"crawled {result.crawled_at}")
        dates = f" ({'; '.join(date_bits)})" if date_bits else ""
        lines.append(
            f"[Web {index}] {result.title}{dates}\n"
            f"URL: {result.url}\n"
            f"Snippet: {content}"
        )
    return "\n\n".join(lines)


def _extract_explicit_web_search_query(message: str) -> str | None:
    clean = " ".join(message.strip().split())
    lowered = clean.lower()
    prefixes = [
        "search the web for ",
        "search web for ",
        "web search for ",
        "look up ",
        "google ",
    ]
    if lowered in {"search the web", "web search", "look this up"}:
        return clean
    for prefix in prefixes:
        if lowered.startswith(prefix):
            return clean[len(prefix) :].strip() or clean
    if "search the web" in lowered or "look it up" in lowered:
        return clean
    return None


def _freshness_for_query(query: str) -> str:
    lowered = query.lower()
    if any(term in lowered for term in ["latest", "current", "today", "recent", "newest", "now"]):
        return "oneMonth"
    return "noLimit"


def _render_web_search_answer(query: str, results: list[WebSearchResult]) -> str:
    if not results:
        return (
            f"I searched the web for \"{query}\", but I couldn't find usable results from the search provider. "
            "Try a narrower query or check the web-search API key/configuration."
        )

    lines = [f"I searched the web for \"{query}\". The most relevant results I found are:"]
    for index, result in enumerate(results[:3], start=1):
        snippet = result.summary or result.snippet
        snippet = " ".join(snippet.split())
        if len(snippet) > 260:
            snippet = f"{snippet[:257].rstrip()}..."
        lines.append(f"{index}. {result.title} [Web {index}]\n   {snippet}")
    lines.append("Use the Sources panel to open the web results.")
    return "\n\n".join(lines)


def _strip_tool_markup(text: str) -> str:
    cleaned = re.sub(r"<tool_code>.*?</tool_code>", "", text, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r"</?tool_code>", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<tool_code>.*", "", cleaned, flags=re.DOTALL | re.IGNORECASE)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


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


_MERMAID_UNQUOTED_LABEL = re.compile(r'\[([^"\[\]]*[()<>{}|][^\[\]]*)\]')


def _quote_mermaid_node_labels(source: str) -> str:
    """Auto-quote node labels that contain Mermaid-syntactic characters.

    The model is told to wrap all node labels in double quotes, but it
    occasionally slips on the easier cases like `A[Filtered Data (CS Majors)]`.
    Mermaid then refuses to render the whole card. This pass wraps any
    `[<unquoted content>]` that contains `()`, `<>`, `{}`, or `|` in quotes
    before the diagram SSE event fires.
    """
    def _wrap(match: "re.Match[str]") -> str:
        inner = match.group(1).replace('"', '\\"')
        return f'["{inner}"]'
    return _MERMAID_UNQUOTED_LABEL.sub(_wrap, source)


async def _save_resource(
    *,
    session: AsyncSession,
    user_id: int,
    subject: str | None,
    conversation_id: int,
    hit,
    topic: str,
) -> Resource:
    resource = Resource(
        user_id=user_id,
        subject=subject or "",
        conversation_id=conversation_id,
        kind=hit.kind,
        source=hit.source,
        title=hit.title,
        url=hit.url,
        snippet=hit.snippet,
        thumbnail_url=hit.thumbnail_url,
        topic=topic[:512] if topic else None,
    )
    session.add(resource)
    await session.commit()
    await session.refresh(resource)
    return resource


async def stream_chat(
    *,
    session: AsyncSession,
    llm_service: LLMService,
    conversation_id: int,
    user_id: int,
    user_message: str,
    system_prompt: str,
    user_message_id: int | None = None,
    image_service: WebImageService | None = None,
    web_search_service: LangSearchWebSearch | None = None,
    resource_provider: YouTubeResourceProvider | None = None,
    preference_summary: str | None = None,
    preference_memories: list[str] | None = None,
) -> AsyncIterator[SseEvent]:
    turn_start_ms = time.monotonic() * 1000
    conv = await get_conversation_for_user(session=session, conversation_id=conversation_id, user_id=user_id)
    subject = conv.subject

    if user_message_id is None:
        user_msg = Message(conversation_id=conversation_id, role=MessageRole.USER, content=user_message)
        session.add(user_msg)
        await session.commit()
        await session.refresh(user_msg)
    else:
        user_msg = await session.get(Message, user_message_id)
        if user_msg is None or user_msg.conversation_id != conversation_id or user_msg.role != MessageRole.USER:
            raise ValueError("User message not found.")
        user_message = user_msg.content

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
    resource_ids_this_turn: list[int] = []
    resource_urls_this_turn: set[str] = set()
    explicit_web_query = _extract_explicit_web_search_query(user_message)
    web_search_fallback_query: str | None = None
    web_search_fallback_results: list[WebSearchResult] = []

    try:
        if explicit_web_query and web_search_service is not None and web_search_service.is_configured:
            web_results = await web_search_service.search(
                query=explicit_web_query,
                freshness=_freshness_for_query(explicit_web_query),
            )
            web_search_fallback_query = explicit_web_query
            web_search_fallback_results = web_results
            if web_results:
                yield SseEvent(event="web_sources", data={
                    "query": explicit_web_query,
                    "sources": [
                        {
                            "title": result.title,
                            "url": result.url,
                            "display_url": result.display_url,
                            "snippet": result.snippet,
                            "summary": result.summary,
                            "published_at": result.published_at,
                            "crawled_at": result.crawled_at,
                        }
                        for result in web_results
                    ],
                })

            web_input_messages = [dict(message) for message in input_messages]
            web_input_messages[0]["content"] = (
                f"{web_input_messages[0]['content']}\n\n"
                f"{_format_web_search_results(web_results)}\n\n"
                "The web search has already been performed by the application. "
                "Answer the student's web-search request directly using the results above. "
                "Do not say you are searching, do not write code, and never output <tool_code> or tool-call markup. "
                "Cite web results inline as [Web 1], [Web 2], etc."
            )
            async for event in llm_service.stream_response(input_messages=web_input_messages):
                if event.type == "token" and event.delta:
                    assistant_parts.append(event.delta)
                elif event.type == "completed":
                    usage = event.usage

            assistant_content = _strip_tool_markup("".join(assistant_parts))
            if not assistant_content:
                fallback = _render_web_search_answer(explicit_web_query, web_results)
                assistant_content = _strip_tool_markup(fallback)

            yield SseEvent(event="token", data={"delta": assistant_content})
            assistant_msg = Message(
                conversation_id=conversation_id,
                role=MessageRole.ASSISTANT,
                content=assistant_content,
            )
            session.add(assistant_msg)
            await session.commit()
            await session.refresh(assistant_msg)

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
            yield SseEvent(
                event="end",
                data={
                    "assistant_message_id": assistant_msg.id,
                    "usage": usage,
                    "latency_ms": latency_ms,
                    "retrieved_chunk_ids": [c.chunk_id for c in retrieved_context],
                    "tool_trace": [
                        {
                            "name": "web_search",
                            "args": {
                                "query": explicit_web_query,
                                "freshness": _freshness_for_query(explicit_web_query),
                                "result_count": len(web_results),
                            },
                        }
                    ],
                },
            )
            return

        available_tools = [*AGENT_TOOLS]
        if web_search_service is not None and web_search_service.is_configured:
            available_tools.append(WEB_SEARCH_TOOL)

        async for event in llm_service.stream_with_tools(input_messages=input_messages, tools=available_tools):
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
            quiz_questions_this_turn: set[str] = set()
            diagram_sources_this_turn: set[str] = set()
            image_queries_this_turn: set[str] = set()
            key_idea_concepts_this_turn: set[str] = set()
            web_search_queries_this_turn: set[str] = set()

            for tc in tool_calls_data:
                if tc["name"] == "generate_quiz":
                    args = tc["args"]
                    question_key = (args.get("question") or "").strip().lower()
                    if question_key and question_key in quiz_questions_this_turn:
                        lc_tool_messages.append(
                            LCToolMessage(
                                content=(
                                    "A quiz with the same question was already shown in this turn. "
                                    "Skip this duplicate — either continue teaching, or call "
                                    "generate_quiz with a clearly different question if you want a "
                                    "second concept check."
                                ),
                                tool_call_id=tc["id"],
                            )
                        )
                        continue
                    quiz_questions_this_turn.add(question_key)
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
                            content=(
                                f"Quiz (ID: {quiz.id}) saved and displayed to the student in a card. "
                                "The card already shows the question text, all answer options, and the "
                                "explanation that appears after they answer. STRICT RULE: do NOT re-state "
                                "the question, the options, or the explanation in your reply text — that "
                                "duplicates the card and confuses the student. Your reply should EITHER "
                                "be empty, OR be one short sentence introducing the quiz ('Here's a quick "
                                "check on what we just covered.'), OR continue with the next teaching "
                                "concept. Never list the options A/B/C/D in text."
                            ),
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
                    source = _quote_mermaid_node_labels(source)
                    diagram_key = source.lower()
                    if diagram_key and diagram_key in diagram_sources_this_turn:
                        lc_tool_messages.append(
                            LCToolMessage(
                                content=(
                                    "An identical diagram was already shown in this turn. Skip the "
                                    "duplicate. Call create_diagram again only with meaningfully "
                                    "different Mermaid source."
                                ),
                                tool_call_id=tc["id"],
                            )
                        )
                        continue
                    if diagram_key:
                        diagram_sources_this_turn.add(diagram_key)
                    lc_tool_messages.append(
                        LCToolMessage(
                            content=(
                                "Diagram created and displayed to the student in a rendered card. "
                                "STRICT RULE: do NOT describe the diagram's nodes, edges, or layout in "
                                "your reply text — the rendered diagram speaks for itself. Reference the "
                                "diagram by purpose ('the diagram above shows the lifecycle') if useful, "
                                "but do not re-state its contents."
                            ),
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
                    image_query_key = query.lower()
                    if image_query_key and image_query_key in image_queries_this_turn:
                        lc_tool_messages.append(
                            LCToolMessage(
                                content=(
                                    f"An image for '{query}' was already shown this turn. Skip the "
                                    "duplicate. Call find_image again only with a clearly different "
                                    "query."
                                ),
                                tool_call_id=tc["id"],
                            )
                        )
                        continue
                    if image_query_key:
                        image_queries_this_turn.add(image_query_key)
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
                        tool_content = (
                            f"Image for '{query}' found and displayed to the student in a card with a "
                            "caption. STRICT RULE: do NOT describe what the image looks like or repeat "
                            "the caption in your reply — the card and caption are visible. Continue "
                            "teaching as if the student has seen the image."
                        )
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

                elif tc["name"] == "find_resource":
                    args = tc["args"]
                    topic = str(args.get("topic", "")).strip()
                    kind = str(args.get("kind", "")).strip().lower()
                    reason = str(args.get("reason", "")).strip()
                    resource_hit = None
                    if kind not in {"video", "article"}:
                        tool_content = (
                            f"find_resource called with invalid kind={kind!r}; nothing displayed."
                        )
                    elif not topic:
                        tool_content = "find_resource called without a topic; nothing displayed."
                    else:
                        try:
                            if kind == "video" and resource_provider is not None:
                                hits = await resource_provider.search(query=topic, max_results=1)
                                resource_hit = hits[0] if hits else None
                            elif kind == "article" and web_search_service is not None:
                                results = await web_search_service.search(query=topic, count=1)
                                if results:
                                    r = results[0]
                                    from app.services.resource_service import ResourceHit as _RH
                                    resource_hit = _RH(
                                        kind="article",
                                        source="web",
                                        title=r.title,
                                        url=r.url,
                                        snippet=r.summary or r.snippet or None,
                                        thumbnail_url=None,
                                    )
                        except Exception as exc:  # noqa: BLE001
                            logger.warning(
                                "Resource lookup failed",
                                extra={
                                    "conversation_id": conversation_id,
                                    "user_id": user_id,
                                    "kind": kind,
                                    "topic": topic,
                                    "error": str(exc),
                                },
                            )

                        if resource_hit is not None and resource_hit.url in resource_urls_this_turn:
                            tool_content = (
                                f"Resource for '{topic}' was already recommended this turn — skipping "
                                "the duplicate. Choose a different topic or kind if you want another one."
                            )
                        elif resource_hit is not None:
                            saved = await _save_resource(
                                session=session,
                                user_id=user_id,
                                subject=subject,
                                conversation_id=conversation_id,
                                hit=resource_hit,
                                topic=topic,
                            )
                            resource_ids_this_turn.append(saved.id)
                            resource_urls_this_turn.add(saved.url)
                            yield SseEvent(event="resource", data={
                                "id": saved.id,
                                "kind": saved.kind,
                                "source": saved.source,
                                "title": saved.title,
                                "url": saved.url,
                                "snippet": saved.snippet,
                                "thumbnail_url": saved.thumbnail_url,
                                "topic": saved.topic,
                                "reason": reason or None,
                            })
                            tool_content = (
                                f"{kind.capitalize()} resource for '{topic}' shown to the student and "
                                "saved to their Resources tab. The card already displays the title, the "
                                "URL, the source domain, and your one-line reason. STRICT RULE: do NOT "
                                "re-state the title, the URL, the domain, or the reason in your reply — "
                                "that duplicates the card. Continue teaching or pause for the student to "
                                "click through."
                            )
                        else:
                            tool_content = (
                                f"No {kind} resource could be found for '{topic}'. "
                                "Continue the explanation without an external recommendation."
                            )

                    lc_tool_messages.append(
                        LCToolMessage(content=tool_content, tool_call_id=tc["id"])
                    )

                elif tc["name"] == "save_key_idea":
                    args = tc["args"]
                    concept_key = (args.get("concept") or "").strip().lower()
                    if concept_key and concept_key in key_idea_concepts_this_turn:
                        lc_tool_messages.append(
                            LCToolMessage(
                                content=(
                                    f"Key idea '{args.get('concept')}' was already saved this turn. "
                                    "Skip the duplicate. Continue teaching or save a different concept."
                                ),
                                tool_call_id=tc["id"],
                            )
                        )
                        continue
                    if concept_key:
                        key_idea_concepts_this_turn.add(concept_key)
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

                elif tc["name"] == "web_search":
                    args = tc["args"]
                    query = str(args.get("query", "")).strip()
                    freshness = str(args.get("freshness") or "noLimit")
                    web_query_key = query.lower()
                    if web_query_key and web_query_key in web_search_queries_this_turn:
                        lc_tool_messages.append(
                            LCToolMessage(
                                content=(
                                    f"Web search for '{query}' was already run this turn. Skip the "
                                    "duplicate. Use the prior results or call web_search with a "
                                    "different query."
                                ),
                                tool_call_id=tc["id"],
                            )
                        )
                        continue
                    if web_query_key:
                        web_search_queries_this_turn.add(web_query_key)
                    results = (
                        await web_search_service.search(query=query, freshness=freshness)
                        if web_search_service is not None and query
                        else []
                    )
                    web_search_fallback_query = query
                    web_search_fallback_results = results
                    lc_tool_messages.append(
                        LCToolMessage(
                            content=_format_web_search_results(results),
                            tool_call_id=tc["id"],
                        )
                    )
                    if results:
                        yield SseEvent(event="web_sources", data={
                            "query": query,
                            "sources": [
                                {
                                    "title": result.title,
                                    "url": result.url,
                                    "display_url": result.display_url,
                                    "snippet": result.snippet,
                                    "summary": result.summary,
                                    "published_at": result.published_at,
                                    "crawled_at": result.crawled_at,
                                }
                                for result in results
                            ],
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

        if not "".join(assistant_parts).strip() and web_search_fallback_query:
            fallback = _render_web_search_answer(web_search_fallback_query, web_search_fallback_results)
            assistant_parts.append(fallback)
            yield SseEvent(event="token", data={"delta": fallback})

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

        if resource_ids_this_turn:
            await session.execute(
                sa_update(Resource)
                .where(Resource.id.in_(resource_ids_this_turn))
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
