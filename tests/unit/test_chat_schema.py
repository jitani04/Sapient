import pytest
from pydantic import ValidationError

from app.schemas.chat import ChatRequest


def test_chat_request_accepts_valid_message() -> None:
    request = ChatRequest(message="Help me solve this equation.")
    assert request.message == "Help me solve this equation."


def test_chat_request_rejects_empty_message() -> None:
    with pytest.raises(ValidationError):
        ChatRequest(message="")


def test_chat_request_accepts_retry_without_message() -> None:
    request = ChatRequest(retry_message_id=42)
    assert request.retry_message_id == 42
    assert request.message is None


def test_chat_request_requires_message_when_editing() -> None:
    with pytest.raises(ValidationError):
        ChatRequest(edit_message_id=42)


def test_chat_request_rejects_retry_and_edit_together() -> None:
    with pytest.raises(ValidationError):
        ChatRequest(message="Try this instead.", retry_message_id=1, edit_message_id=2)
