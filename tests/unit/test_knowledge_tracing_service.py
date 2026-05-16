from app.services.knowledge_tracing_service import (
    mastery_to_learning_status,
    update_bkt_mastery,
)


def test_bkt_mastery_increases_after_correct_observation() -> None:
    mastery = update_bkt_mastery(0.25, True)

    assert mastery > 0.25


def test_bkt_mastery_drops_after_incorrect_observation() -> None:
    mastery = update_bkt_mastery(0.80, False)

    assert mastery < 0.80


def test_mastery_status_thresholds() -> None:
    assert mastery_to_learning_status(0.20, 0) == "not_started"
    assert mastery_to_learning_status(0.40, 2) == "needs_review"
    assert mastery_to_learning_status(0.60, 2) == "in_progress"
    assert mastery_to_learning_status(0.90, 2) == "mastered"
