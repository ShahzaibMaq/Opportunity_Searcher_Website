from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (compatible; OpportunitySearcherBot/0.1; "
    "+https://github.com/ShahzaibMaq/Opportunity_Searcher_Website)"
)

DATE_PATTERN = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b",
    re.IGNORECASE,
)

STANDOUT_FIELD_ORDER = ("Ages", "Location", "Timeline", "Deadline")
COLLEGE_TRANSITIONS_FIELD_ORDER = (
    "Location",
    "Format",
    "Length",
    "Cost",
    "Eligibility",
    "Application Deadline",
    "Deadline",
    "Best for",
    "What you do",
)
DESCRIPTION_START = re.compile(
    r"\s+(?=[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,3}\s+"
    r"(?:is|are|was|were|provides|offers|helps|pairs|introduces|allows|participants|students)\b)",
    re.IGNORECASE,
)

ALLOWED_CATEGORIES = frozenset(
    {
        "Internship",
        "Research",
        "Scholarship",
        "Competition",
        "Summer Program",
        "Volunteering",
        "Activity",
    }
)


@dataclass(frozen=True)
class Opportunity:
    title: str
    organization: str
    category: str
    location: str
    subject_area: str
    deadline: str
    timeline: str
    grade_level: str
    description: str
    link: str
    source: str
    source_url: str
    scraped_at: str


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"\s+", " ", value).strip()
    return text.replace("T he ", "The ")


def truncate(text: str, max_length: int = 500) -> str:
    text = clean_text(text)
    if len(text) <= max_length:
        return text
    return text[:max_length].rsplit(" ", 1)[0] + "..."


def fetch_html(url: str) -> BeautifulSoup:
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser")


KNOWN_DEADLINE_PHRASES = (
    "Contact for Deadline",
    "Contact for deadline",
    "Open until filled",
    "Rolling",
    "Various",
)


def trim_field_tail(value: str) -> str:
    if not value:
        return ""

    cleaned = clean_text(value)
    for phrase in KNOWN_DEADLINE_PHRASES:
        if cleaned.lower().startswith(phrase.lower()):
            return phrase

    date_match = DATE_PATTERN.match(cleaned)
    if date_match:
        return clean_text(date_match.group(0))

    split = DESCRIPTION_START.split(cleaned, maxsplit=1)
    return clean_text(split[0])


def _field_marker_pattern(field_names: tuple[str, ...]) -> re.Pattern[str]:
    labels = "|".join(re.escape(name) for name in field_names)
    return re.compile(rf"\b({labels}):\s*", re.IGNORECASE)


def _extract_fields_from_text(text: str, field_names: tuple[str, ...]) -> dict[str, str]:
    marker_pattern = _field_marker_pattern(field_names)
    markers = list(marker_pattern.finditer(text))
    if not markers:
        return {}

    fields: dict[str, str] = {}
    for index, match in enumerate(markers):
        key = match.group(1).lower()
        if key in fields:
            continue

        start = match.end()
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        value = text[start:end].strip()
        if index + 1 == len(markers):
            value = trim_field_tail(value)
        fields[key] = clean_text(value)

    return fields


def extract_listing_metadata(text: str) -> dict[str, str]:
    """Parse structured listing prefixes from StandOut- and College Transitions-style pages."""
    fields = _extract_fields_from_text(text, STANDOUT_FIELD_ORDER)
    for key, value in _extract_fields_from_text(text, COLLEGE_TRANSITIONS_FIELD_ORDER).items():
        fields.setdefault(key, value)

    if fields.get("format") and not fields.get("timeline"):
        timeline = fields["format"]
        if fields.get("length"):
            timeline = f"{timeline} ({fields['length']})"
        fields["timeline"] = timeline

    if fields.get("eligibility") and not fields.get("ages"):
        fields["ages"] = fields["eligibility"]

    if fields.get("application deadline") and not fields.get("deadline"):
        fields["deadline"] = fields["application deadline"]

    return fields


def infer_category(title: str, description: str, fallback: str) -> str:
    haystack = f"{title} {description}".lower()
    checks = [
        ("Scholarship", ["scholarship", "grant", "financial aid"]),
        ("Competition", ["competition", "challenge", "contest", "prize"]),
        ("Research", ["research", "laboratory", "lab ", "science research"]),
        ("Internship", ["internship", "intern ", "apprenticeship"]),
        ("Summer Program", ["summer", "program"]),
    ]

    for category, keywords in checks:
        if any(keyword in haystack for keyword in keywords):
            return category

    return fallback


def infer_subject(title: str, description: str, fallback: str = "General") -> str:
    haystack = f"{title} {description}".lower()
    subjects = [
        ("Computer Science", ["computer science", "coding", "software", "cyber", "data"]),
        ("Medicine", ["medical", "medicine", "health", "hospital", "cancer"]),
        ("Engineering", ["engineering", "engineer"]),
        ("STEM", ["science", "stem", "biology", "chemistry", "physics", "math"]),
        ("Journalism", ["journalism", "writing", "newspaper"]),
        ("Law", ["law", "legal", "court", "justice"]),
        ("Business", ["business", "finance", "marketing", "entrepreneur"]),
        ("Environment", ["climate", "environment", "sustainability"]),
        ("Humanities", ["history", "arts", "museum", "humanities"]),
    ]

    for subject, keywords in subjects:
        if any(keyword in haystack for keyword in keywords):
            return subject

    return fallback


def infer_deadline(description: str) -> str:
    metadata = extract_listing_metadata(description)
    if metadata.get("deadline"):
        return metadata["deadline"]

    match = DATE_PATTERN.search(description)
    return clean_text(match.group(0)) if match else ""


def infer_timeline(description: str) -> str:
    metadata = extract_listing_metadata(description)
    return metadata.get("timeline", "")


def infer_grade_level(description: str, fallback: str = "High School") -> str:
    metadata = extract_listing_metadata(description)
    ages = metadata.get("ages", "")
    if not ages:
        return fallback

    ages_lower = ages.lower()
    if any(token in ages_lower for token in ("high school", "9", "10", "11", "12", "teen")):
        return "High School"
    return ages


def infer_location_from_metadata(description: str, fallback: str) -> str:
    metadata = extract_listing_metadata(description)
    return metadata.get("location") or fallback


def _strip_metadata_prefix(text: str) -> str:
    """Remove structured field metadata from the beginning of description text.
    
    Metadata appears as "Field: value" patterns at the start and should be removed.
    Example: "Ages: 15-19 Location: Virtual Timeline: Summer Deadline: Various Main text here..."
    becomes: "Main text here..."
    """
    if not text:
        return text
    
    cleaned = clean_text(text)
    
    # First, try extracting metadata to understand what's there
    metadata = extract_listing_metadata(cleaned)
    
    # If we found metadata, look for where the actual description content starts
    # by searching for common sentence openers/verbs that indicate content start
    content_indicators = [
        r"provides",
        r"offers",
        r"helps",
        r"is a",
        r"are",
        r"was",
        r"were",
        r"participat",
        r"student",
        r"program",
        r"opportunity",
        r"include",
        r"feature",
        r"allow",
        r"pairs",
        r"introduce",
    ]
    
    # Find the earliest position of any content indicator
    earliest_pos = len(cleaned)
    for indicator in content_indicators:
        match = re.search(indicator, cleaned, re.IGNORECASE)
        if match:
            earliest_pos = min(earliest_pos, match.start())
    
    # If we found a content indicator, cut everything before it
    if earliest_pos > 0 and earliest_pos < len(cleaned):
        result = cleaned[earliest_pos:].lstrip()
        # Make sure we're not cutting off important text
        if len(result) > 20:  # At least some meaningful content
            return clean_text(result)
    
    return clean_text(cleaned)


def enrich_opportunity_fields(opportunity: Opportunity) -> Opportunity:
    """Fill missing fields from structured description text."""
    description = opportunity.description
    metadata = extract_listing_metadata(description)

    deadline = opportunity.deadline or metadata.get("deadline") or infer_deadline(description)
    timeline = opportunity.timeline or metadata.get("timeline") or infer_timeline(description)
    grade_level = (
        opportunity.grade_level
        if opportunity.grade_level and opportunity.grade_level != "High School"
        else metadata.get("ages")
        or infer_grade_level(description, opportunity.grade_level or "High School")
    )
    location = metadata.get("location") or opportunity.location
    
    # Clean up description by removing redundant metadata prefix
    cleaned_description = _strip_metadata_prefix(description)

    return replace(
        opportunity,
        deadline=deadline,
        timeline=timeline,
        grade_level=grade_level,
        location=location,
        description=cleaned_description,
    )


def opportunity_richness(opportunity: Opportunity) -> int:
    score = 0
    for value in (
        opportunity.deadline,
        opportunity.timeline,
        opportunity.description,
        opportunity.subject_area,
        opportunity.grade_level,
        opportunity.organization,
    ):
        if clean_text(value):
            score += 1
    return score


def dedupe(opportunities: Iterable[Opportunity]) -> list[Opportunity]:
    best: dict[tuple[str, str], Opportunity] = {}

    for opportunity in opportunities:
        key = (opportunity.title.lower(), opportunity.link.lower())
        existing = best.get(key)
        if existing is None or opportunity_richness(opportunity) > opportunity_richness(existing):
            best[key] = opportunity

    return list(best.values())


def normalize_category(value: str, title: str, description: str, fallback: str) -> str:
    cleaned = clean_text(value)
    if cleaned in ALLOWED_CATEGORIES:
        return cleaned
    return infer_category(title, description, fallback)


def normalize_link(link: str, page_url: str) -> str:
    cleaned = clean_text(link)
    if not cleaned:
        return ""
    return urljoin(page_url, cleaned)
