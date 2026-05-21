from types import SimpleNamespace

import pytest

from app.models.conversation import Conversation
from app.models.message import Message, MessageRole
from app.models.message_feedback import MessageFeedback
from app.schemas.feedback import FeedbackCreate
from app.services.errors import ConversationNotFoundError
from app.services.feedback_service import (
    FeedbackClassification,
    _normalise_classification,
    create_or_update_feedback,
    delete_feedback_for_message,
    maybe_store_preference_memory,
)


class _ScalarResult:
    def scalar_one_or_none(self):
        return None


class _FakeSession:
    def __init__(self) -> None:
        self.added = []
        self.commits = 0

    async def execute(self, _stmt):
        return _ScalarResult()

    async def scalar(self, _stmt):
        return None

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commits += 1

    async def refresh(self, value):
        if getattr(value, "id", None) is None:
            value.id = 1


class _DeleteFeedbackSession:
    def __init__(self, feedback):
        self.feedback = feedback
        self.deleted = None
        self.commits = 0

    async def scalar(self, _stmt):
        return self.feedback

    async def delete(self, value):
        self.deleted = value

    async def commit(self):
        self.commits += 1


def _settings(**overrides):
    defaults = {
        "prompt_version": "test-prompt",
        "llm_model": "test-model",
        "llm_api_key": "test-key",
        "llm_timeout_seconds": 1,
        "enable_feedback_preferences": False,
        "enable_preference_memory": False,
        "preference_summary_max_feedback_items": 25,
        "preference_memory_top_k": 3,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _context():
    conversation = Conversation(id=10, user_id=7, subject="Algebra")
    assistant = Message(id=22, conversation_id=10, role=MessageRole.ASSISTANT, content="Try factoring first.")
    previous_user = Message(id=21, conversation_id=10, role=MessageRole.USER, content="How do I solve x^2 - 1?")
    return conversation, assistant, previous_user


@pytest.mark.asyncio
async def test_thumbs_up_with_no_text_saves_rating(monkeypatch) -> None:
    async def fake_context(**_kwargs):
        return _context()

    async def classifier(**_kwargs):
        raise AssertionError("Classifier should not run without text.")

    monkeypatch.setattr("app.services.feedback_service._get_owned_message_context", fake_context)
    session = _FakeSession()

    feedback = await create_or_update_feedback(
        session=session,
        user_id=7,
        body=FeedbackCreate(message_id=22, conversation_id=10, rating="thumbs_up"),
        classifier=classifier,
        settings=_settings(),
    )

    assert feedback.rating == "thumbs_up"
    assert feedback.feedback_text is None
    assert feedback.llm_reason_category is None
    assert session.commits == 1


@pytest.mark.asyncio
async def test_thumbs_down_with_no_text_saves_rating(monkeypatch) -> None:
    async def fake_context(**_kwargs):
        return _context()

    async def classifier(**_kwargs):
        raise AssertionError("Classifier should not run without text.")

    monkeypatch.setattr("app.services.feedback_service._get_owned_message_context", fake_context)
    session = _FakeSession()

    feedback = await create_or_update_feedback(
        session=session,
        user_id=7,
        body=FeedbackCreate(message_id=22, conversation_id=10, rating="thumbs_down"),
        classifier=classifier,
        settings=_settings(),
    )

    assert feedback.rating == "thumbs_down"
    assert feedback.correction is None
    assert feedback.llm_feedback_summary is None


@pytest.mark.asyncio
async def test_delete_feedback_for_message_removes_existing_feedback() -> None:
    feedback = MessageFeedback(user_id=7, message_id=22, conversation_id=10, rating="thumbs_up")
    session = _DeleteFeedbackSession(feedback)

    await delete_feedback_for_message(session=session, user_id=7, message_id=22)

    assert session.deleted is feedback
    assert session.commits == 1


@pytest.mark.asyncio
async def test_thumbs_down_with_feedback_text_stores_classification(monkeypatch) -> None:
    async def fake_context(**_kwargs):
        return _context()

    async def classifier(**_kwargs):
        return FeedbackClassification(
            reason_category="too_vague",
            feedback_summary="The student wanted a more concrete explanation.",
            derived_preference="Use a concrete example when explaining algebra steps.",
            should_update_user_preferences=True,
            stability="medium",
            caveat=None,
        )

    monkeypatch.setattr("app.services.feedback_service._get_owned_message_context", fake_context)
    session = _FakeSession()

    feedback = await create_or_update_feedback(
        session=session,
        user_id=7,
        body=FeedbackCreate(
            message_id=22,
            conversation_id=10,
            rating="thumbs_down",
            feedback_text="Too abstract.",
        ),
        llm_service=object(),
        classifier=classifier,
        settings=_settings(),
    )

    assert feedback.feedback_text == "Too abstract."
    assert feedback.llm_reason_category == "too_vague"
    assert feedback.llm_feedback_summary == "The student wanted a more concrete explanation."
    assert feedback.llm_derived_preference == "Use a concrete example when explaining algebra steps."


@pytest.mark.asyncio
async def test_thumbs_down_with_correction_stores_correction(monkeypatch) -> None:
    async def fake_context(**_kwargs):
        return _context()

    async def classifier(**_kwargs):
        return FeedbackClassification(
            reason_category="did_not_answer_question",
            feedback_summary="The student supplied the missing answer expectation.",
            derived_preference=None,
            should_update_user_preferences=False,
            stability="low",
            caveat="The correction may be one-off.",
        )

    monkeypatch.setattr("app.services.feedback_service._get_owned_message_context", fake_context)

    feedback = await create_or_update_feedback(
        session=_FakeSession(),
        user_id=7,
        body=FeedbackCreate(
            message_id=22,
            conversation_id=10,
            rating="thumbs_down",
            correction="It should mention difference of squares.",
        ),
        llm_service=object(),
        classifier=classifier,
        settings=_settings(),
    )

    assert feedback.correction == "It should mention difference of squares."
    assert feedback.llm_caveat == "The correction may be one-off."


@pytest.mark.asyncio
async def test_ownership_validation_error_propagates(monkeypatch) -> None:
    async def fake_context(**_kwargs):
        raise ConversationNotFoundError("not owned")

    monkeypatch.setattr("app.services.feedback_service._get_owned_message_context", fake_context)

    with pytest.raises(ConversationNotFoundError):
        await create_or_update_feedback(
            session=_FakeSession(),
            user_id=7,
            body=FeedbackCreate(message_id=22, conversation_id=10, rating="thumbs_up"),
            settings=_settings(),
        )


def test_vague_feedback_does_not_necessarily_update_preferences() -> None:
    classification = _normalise_classification({
        "reason_category": "other",
        "feedback_summary": "The feedback was vague.",
        "derived_preference": "Be better.",
        "should_update_user_preferences": True,
        "stability": "low",
        "caveat": "One-off vague complaint.",
    })

    assert classification.derived_preference == "Be better."
    assert classification.should_update_user_preferences is False


def test_bad_tutoring_preferences_are_not_blindly_encoded() -> None:
    classification = _normalise_classification({
        "reason_category": "not_enough_hints",
        "feedback_summary": "The student disliked being challenged.",
        "derived_preference": "Always give the final answer immediately.",
        "should_update_user_preferences": True,
        "stability": "high",
        "caveat": None,
    })

    assert classification.derived_preference is None
    assert classification.should_update_user_preferences is False


@pytest.mark.asyncio
async def test_preference_memory_only_runs_when_enabled(monkeypatch) -> None:
    def fail_embedding_service():
        raise AssertionError("Embedding service should not run when memory is disabled.")

    monkeypatch.setattr("app.services.feedback_service.create_embedding_service", fail_embedding_service)
    feedback = MessageFeedback(
        id=1,
        user_id=7,
        message_id=22,
        conversation_id=10,
        rating="thumbs_down",
        llm_derived_preference="Use shorter steps.",
    )

    memory = await maybe_store_preference_memory(
        session=_FakeSession(),
        feedback=feedback,
        settings=_settings(enable_preference_memory=False),
    )

    assert memory is None
