import ipaddress
import re
import socket
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from html import unescape
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assignment import Assignment, CalendarFeed

_MAX_FEED_BYTES = 5 * 1024 * 1024
_MAX_REDIRECTS = 3


class UnsafeFeedURLError(httpx.HTTPError):
    """Raised when a feed URL points at a private/loopback host."""


def _ip_is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _assert_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise UnsafeFeedURLError(f"Unsupported scheme: {parsed.scheme!r}")
    host = parsed.hostname
    if not host:
        raise UnsafeFeedURLError("Calendar URL is missing a host.")
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeFeedURLError(f"Could not resolve host: {host}") from exc
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if not _ip_is_public(ip):
            raise UnsafeFeedURLError(f"Calendar host resolves to a non-public address ({ip_str}).")


@dataclass(slots=True)
class CalendarEvent:
    uid: str
    title: str
    due_at: datetime
    description: str | None = None
    source_url: str | None = None


def _unfold_ical_lines(raw: str) -> list[str]:
    lines = raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    unfolded: list[str] = []
    for line in lines:
        if not line:
            continue
        if line.startswith((" ", "\t")) and unfolded:
            unfolded[-1] += line[1:]
        else:
            unfolded.append(line)
    return unfolded


def _unescape_ical_value(value: str) -> str:
    value = value.replace("\\n", "\n").replace("\\N", "\n")
    value = value.replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", unescape(value)).strip()


def _parse_ical_datetime(value: str) -> datetime | None:
    clean = value.strip()
    if not clean:
        return None
    try:
        if len(clean) == 8 and clean.isdigit():
            parsed_date = date(int(clean[0:4]), int(clean[4:6]), int(clean[6:8]))
            return datetime.combine(parsed_date, time(hour=23, minute=59), tzinfo=timezone.utc)
        if clean.endswith("Z"):
            return datetime.strptime(clean, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        parsed = datetime.strptime(clean[:15], "%Y%m%dT%H%M%S")
        return parsed.replace(tzinfo=ZoneInfo("America/Los_Angeles")).astimezone(timezone.utc)
    except ValueError:
        return None


def parse_ical_events(raw: str) -> list[CalendarEvent]:
    events: list[CalendarEvent] = []
    current: dict[str, str] | None = None

    for line in _unfold_ical_lines(raw):
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT":
            if current:
                title = _unescape_ical_value(current.get("SUMMARY", ""))
                due_raw = current.get("DUE") or current.get("DTSTART") or current.get("DTEND")
                due_at = _parse_ical_datetime(due_raw or "")
                if title and due_at:
                    events.append(
                        CalendarEvent(
                            uid=current.get("UID") or f"{title}:{due_at.isoformat()}",
                            title=title,
                            due_at=due_at,
                            description=_unescape_ical_value(current.get("DESCRIPTION", "")) or None,
                            source_url=_unescape_ical_value(current.get("URL", "")) or None,
                        )
                    )
            current = None
            continue
        if current is None or ":" not in line:
            continue
        key_part, value = line.split(":", 1)
        key = key_part.split(";", 1)[0].upper()
        if key in {"UID", "SUMMARY", "DESCRIPTION", "URL", "DUE", "DTSTART", "DTEND"}:
            current[key] = value

    return events


async def fetch_ical_events(url: str) -> list[CalendarEvent]:
    # Manually follow redirects so each hop's target gets re-validated against
    # the public-host allowlist — a public URL that 302s to 169.254.169.254
    # must not be followed.
    current = url
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=False) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            _assert_public_url(current)
            response = await client.get(current)
            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise UnsafeFeedURLError("Redirect with no Location header.")
                current = str(response.url.join(location))
                continue
            response.raise_for_status()
            body = response.content[:_MAX_FEED_BYTES]
            return parse_ical_events(body.decode(response.encoding or "utf-8", errors="replace"))
    raise UnsafeFeedURLError("Too many redirects.")


_COURSE_SUFFIX_RE = re.compile(r'\[([^\]]+)\]\s*$')
_SECTION_RE = re.compile(r'^\d+[A-Z]+-(.+?)-(\d+)-[A-Z]+-\d+')


def extract_course_key(title: str) -> str | None:
    """Extract a normalised course key like 'COM SCI 259' from a Canvas assignment title."""
    m = _COURSE_SUFFIX_RE.search(title)
    if not m:
        return None
    first = m.group(1).split('/')[0].strip()
    m2 = _SECTION_RE.match(first)
    if not m2:
        return None
    return f"{m2.group(1).strip()} {m2.group(2).strip()}"


async def sync_calendar_feed(
    *,
    session: AsyncSession,
    user_id: int,
    feed: CalendarFeed,
    events: list[CalendarEvent],
) -> int:
    imported = 0
    mappings: dict[str, str] = feed.course_mappings or {}
    for event in events:
        result = await session.execute(
            select(Assignment).where(
                Assignment.user_id == user_id,
                Assignment.feed_id == feed.id,
                Assignment.source_uid == event.uid,
            )
        )
        assignment = result.scalar_one_or_none()
        if assignment is None:
            assignment = Assignment(
                user_id=user_id,
                feed_id=feed.id,
                source="canvas",
                source_uid=event.uid,
            )
            session.add(assignment)
            imported += 1

        course_key = extract_course_key(event.title)
        assignment.subject = mappings.get(course_key) if course_key and mappings else feed.subject
        assignment.title = event.title[:255]
        assignment.description = event.description
        assignment.due_at = event.due_at
        assignment.source_url = event.source_url

    feed.last_synced_at = datetime.now(timezone.utc)
    await session.commit()
    return imported


