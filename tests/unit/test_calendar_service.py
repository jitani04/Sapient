from datetime import timezone

import pytest

from app.services.calendar_service import UnsafeFeedURLError, _assert_public_url, parse_ical_events


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost/cal.ics",
        "http://127.0.0.1/cal.ics",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/cal.ics",
        "http://192.168.1.10/cal.ics",
        "http://[::1]/cal.ics",
        "ftp://example.com/cal.ics",
        "file:///etc/passwd",
    ],
)
def test_assert_public_url_blocks_unsafe_hosts(url: str) -> None:
    with pytest.raises(UnsafeFeedURLError):
        _assert_public_url(url)


def test_assert_public_url_allows_public_hosts() -> None:
    _assert_public_url("https://example.com/cal.ics")


def test_parse_ical_events_reads_canvas_style_assignment() -> None:
    raw = """BEGIN:VCALENDAR
BEGIN:VEVENT
UID:assignment-123
SUMMARY:Fine Art Essay
DESCRIPTION:Write about composition\\, medium\\, and technique.
DTSTART:20260522T235900Z
URL:https://canvas.example.edu/courses/1/assignments/123
END:VEVENT
END:VCALENDAR
"""

    events = parse_ical_events(raw)

    assert len(events) == 1
    assert events[0].uid == "assignment-123"
    assert events[0].title == "Fine Art Essay"
    assert events[0].description == "Write about composition, medium, and technique."
    assert events[0].due_at.tzinfo == timezone.utc
    assert events[0].source_url == "https://canvas.example.edu/courses/1/assignments/123"


def test_parse_ical_events_handles_folded_lines_and_all_day_dates() -> None:
    raw = """BEGIN:VCALENDAR
BEGIN:VEVENT
UID:exam-1
SUMMARY:Comprehensive 
 Examination
DTSTART;VALUE=DATE:20260528
END:VEVENT
END:VCALENDAR
"""

    events = parse_ical_events(raw)

    assert len(events) == 1
    assert events[0].title == "Comprehensive Examination"
    assert events[0].due_at.hour == 23
    assert events[0].due_at.minute == 59
