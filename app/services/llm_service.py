from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from app.core.observability import record_llm_call, record_llm_tokens, tracer as _tracer


@dataclass(slots=True)
class LLMStreamEvent:
    type: Literal["token", "tool_call_ready", "completed"]
    delta: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    ai_message: Any | None = None  # accumulated AIMessageChunk, passed back for second-pass context
    usage: dict[str, Any] | None = None


class LLMService:
    def __init__(self, *, api_key: str, model: str, timeout_seconds: float) -> None:
        self._model = model
        self._llm = ChatGoogleGenerativeAI(
            model=model,
            google_api_key=api_key,
            timeout=timeout_seconds,
            convert_system_message_to_human=True,
        )

    def _record_usage(self, span: trace.Span, usage: dict[str, Any] | None) -> None:
        if not usage:
            return
        prompt_tokens = int(usage.get("input_tokens") or 0)
        completion_tokens = int(usage.get("output_tokens") or 0)
        if prompt_tokens:
            span.set_attribute("gen_ai.usage.input_tokens", prompt_tokens)
            record_llm_tokens(self._model, "prompt", prompt_tokens)
        if completion_tokens:
            span.set_attribute("gen_ai.usage.output_tokens", completion_tokens)
            record_llm_tokens(self._model, "completion", completion_tokens)

    @staticmethod
    def _to_langchain_messages(input_messages: list[dict[str, Any]]) -> list[BaseMessage]:
        messages: list[BaseMessage] = []
        for msg in input_messages:
            role = msg["role"]
            content = msg["content"]
            if role == "system":
                messages.append(SystemMessage(content=content))
            elif role == "user":
                messages.append(HumanMessage(content=content))
            elif role == "assistant":
                messages.append(AIMessage(content=content))
            else:
                raise ValueError(f"Unsupported message role: {role}")
        return messages

    def to_langchain_messages(self, input_messages: list[dict[str, Any]]) -> list[BaseMessage]:
        return self._to_langchain_messages(input_messages)

    async def _stream_lc(self, lc_messages: list[BaseMessage]) -> AsyncIterator[LLMStreamEvent]:
        usage_dict: dict[str, Any] | None = None
        with _tracer.start_as_current_span(
            "llm.stream",
            attributes={
                "gen_ai.system": "google.gemini",
                "gen_ai.request.model": self._model,
                "gen_ai.operation.name": "chat",
            },
        ) as span:
            try:
                async for chunk in self._llm.astream(lc_messages):
                    if isinstance(chunk.content, str) and chunk.content:
                        yield LLMStreamEvent(type="token", delta=chunk.content)
                    elif isinstance(chunk.content, list):
                        for part in chunk.content:
                            if isinstance(part, str) and part:
                                yield LLMStreamEvent(type="token", delta=part)
                            elif isinstance(part, dict) and part.get("type") == "text" and part.get("text"):
                                yield LLMStreamEvent(type="token", delta=part["text"])
                    chunk_usage = getattr(chunk, "usage_metadata", None)
                    if chunk_usage is not None:
                        usage_dict = dict(chunk_usage)
            except Exception as exc:
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                record_llm_call(self._model, "error")
                raise
            self._record_usage(span, usage_dict)
            record_llm_call(self._model, "ok")
        yield LLMStreamEvent(type="completed", usage=usage_dict)

    async def stream_response(self, *, input_messages: list[dict[str, Any]]) -> AsyncIterator[LLMStreamEvent]:
        async for event in self._stream_lc(self._to_langchain_messages(input_messages)):
            yield event

    async def generate_text(self, *, input_messages: list[dict[str, Any]]) -> str:
        usage_dict: dict[str, Any] | None = None
        with _tracer.start_as_current_span(
            "llm.generate_text",
            attributes={
                "gen_ai.system": "google.gemini",
                "gen_ai.request.model": self._model,
                "gen_ai.operation.name": "chat",
            },
        ) as span:
            try:
                response = await self._llm.ainvoke(self._to_langchain_messages(input_messages))
                usage = getattr(response, "usage_metadata", None)
                if usage is not None:
                    usage_dict = dict(usage)
            except Exception as exc:
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                record_llm_call(self._model, "error")
                raise
            self._record_usage(span, usage_dict)
            record_llm_call(self._model, "ok")

        if isinstance(response.content, str):
            return response.content
        if isinstance(response.content, list):
            parts: list[str] = []
            for part in response.content:
                if isinstance(part, str):
                    parts.append(part)
                elif isinstance(part, dict) and part.get("type") == "text" and part.get("text"):
                    parts.append(str(part["text"]))
            return "".join(parts)
        return str(response.content)

    async def stream_lc(self, *, lc_messages: list[BaseMessage]) -> AsyncIterator[LLMStreamEvent]:
        async for event in self._stream_lc(lc_messages):
            yield event

    async def stream_with_tools(
        self,
        *,
        input_messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> AsyncIterator[LLMStreamEvent]:
        lc_messages = self._to_langchain_messages(input_messages)
        llm_with_tools = self._llm.bind_tools(tools)

        accumulated = None
        text_buffer: list[str] = []
        has_tool_calls = False
        usage_dict: dict[str, Any] | None = None

        with _tracer.start_as_current_span(
            "llm.stream_with_tools",
            attributes={
                "gen_ai.system": "google.gemini",
                "gen_ai.request.model": self._model,
                "gen_ai.operation.name": "chat",
                "gen_ai.tool.count": len(tools),
            },
        ) as span:
            try:
                async for chunk in llm_with_tools.astream(lc_messages):
                    accumulated = chunk if accumulated is None else accumulated + chunk

                    if getattr(chunk, "tool_call_chunks", None):
                        has_tool_calls = True

                    if isinstance(chunk.content, str) and chunk.content:
                        text_buffer.append(chunk.content)
                    elif isinstance(chunk.content, list):
                        for part in chunk.content:
                            if isinstance(part, dict) and part.get("type") == "text" and part.get("text"):
                                text_buffer.append(part["text"])

                    chunk_usage = getattr(chunk, "usage_metadata", None)
                    if chunk_usage is not None:
                        usage_dict = dict(chunk_usage)
            except Exception as exc:
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                record_llm_call(self._model, "error")
                raise
            span.set_attribute("gen_ai.response.tool_calls", bool(has_tool_calls))
            self._record_usage(span, usage_dict)
            record_llm_call(self._model, "ok")

        if has_tool_calls and accumulated and accumulated.tool_calls:
            # Discard text_buffer — it was the model previewing the question before
            # calling the tool. The second pass will stream the real intro text.
            yield LLMStreamEvent(
                type="tool_call_ready",
                tool_calls=list(accumulated.tool_calls),
                ai_message=accumulated,
            )
        else:
            for token in text_buffer:
                yield LLMStreamEvent(type="token", delta=token)

        yield LLMStreamEvent(type="completed", usage=usage_dict)
