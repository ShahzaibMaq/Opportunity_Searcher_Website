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


def _strip_metadata_from_description(text: str) -> str:
    """Remove all structured field metadata from description text.
    
    Handles both inline metadata (e.g., "Format: Summer", "Cost: Free")
    and prefix metadata (e.g., "Ages: X Location: Y Timeline: Z Description here...")
    """
    if not text:
        return text
    
    cleaned = clean_text(text)
    
    # First, try to find where actual description content starts
    # by looking for the first substantial sentence (after metadata prefix)
    
    # Split by newlines and spaces to find metadata sections
    lines = cleaned.split("\n")
    result = cleaned
    
    # Pattern for prefix metadata: "Field: value Field2: value2 ... Description starts here"
    # Remove all consecutive "Field: value" patterns from the start
    prefix_pattern = r"^(?:(?:Ages|Location|Timeline|Deadline|Format|Length|Cost|Eligibility|Application Deadline|Best for|What you do):\s*[^\n]*?\s+)*"
    result = re.sub(prefix_pattern, "", result, flags=re.IGNORECASE)
    
    # Second, remove inline metadata fields that appear in the middle/end of text
    # These look like "... content Eligibility: something Best for: something Description continues..."
    inline_pattern = r"\s+(?:Best for|What you do|Eligibility|Format|Length|Cost):\s*[^\n.!?]*(?=[A-Z][a-z]|\s+[A-Z]{2,}|$)"
    result = re.sub(inline_pattern, " ", result, flags=re.IGNORECASE)
    
    # Clean up extra whitespace
    result = re.sub(r"\s+", " ", result).strip()
    
    # Safety check: if we removed too much, return original
    if len(result) < 15 and len(cleaned) > 50:
        return cleaned
    
    return result if result else cleaned


def _fix_data_errors(opportunity: Opportunity) -> Opportunity:
    """Fix common data entry errors."""
    title = opportunity.title
    description = opportunity.description
    organization = opportunity.organization
    
    # Fix: Congressman -> Senator for Cory Booker
    if "congressman" in title.lower() and "cory booker" in title.lower():
        title = re.sub(r"Congressman", "Senator", title)
        organization = re.sub(r"Congressman", "Senator", organization)
    
    # Fix character encoding issues using raw string patterns
    # Smart quotes and dashes from web content
    patterns = [
        (r"[\u201c\u201d]", '"'),   # Curly quotes to straight quotes
        (r"[\u2018\u2019]", "'"),   # Curly apostrophes to straight
        (r"[\u2013\u2014]", "-"),   # En/em dashes to hyphen
    ]
    
    for pattern, replacement in patterns:
        title = re.sub(pattern, replacement, title)
        description = re.sub(pattern, replacement, description)
        organization = re.sub(pattern, replacement, organization)
    
    # Fix missing spaces after commas in locations
    title = re.sub(r"(\w),(\w)", r"\1, \2", title)
    
    if (title != opportunity.title or 
        description != opportunity.description or 
        organization != opportunity.organization):
        return replace(opportunity, title=title, description=description, organization=organization)
    
    return opportunity


def enrich_opportunity_fields(opportunity: Opportunity) -> Opportunity:
    """Fill missing fields from structured description text and clean up data errors."""
    # First, fix data errors
    opportunity = _fix_data_errors(opportunity)
    
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
    
    # Clean up description by removing redundant metadata
    cleaned_description = _strip_metadata_from_description(description)

    return replace(
        opportunity,
        deadline=deadline,
        timeline=timeline,
        grade_level=grade_level,
        location=location,
        description=cleaned_description,
    )


def opportunity_richness(opportunity: Opportunity) -> int:
    """Score opportunity for data completeness. Higher score = better data."""
    score = 0
    
    # Core fields (all have equal weight now)
    if clean_text(opportunity.deadline) and opportunity.deadline != "Contact for deadline":
        score += 2  # Boost for real deadlines
    else:
        score += 1
    
    if clean_text(opportunity.timeline):
        score += 1
        
    if clean_text(opportunity.description) and len(opportunity.description) > 100:
        score += 2  # Boost for longer, more detailed descriptions
    elif clean_text(opportunity.description):
        score += 1
        
    if clean_text(opportunity.subject_area):
        score += 1
        
    if clean_text(opportunity.grade_level):
        score += 1
        
    if clean_text(opportunity.organization) and opportunity.organization != opportunity.title:
        score += 1  # Different org means better data
    
    return score


def _normalize_title(title: str) -> str:
    """Normalize title for similarity matching."""
    return re.sub(r"\s+", " ", title.lower()).strip()


def dedupe(opportunities: Iterable[Opportunity]) -> list[Opportunity]:
    """Remove duplicates, preferring entries with richer data."""
    best: dict[tuple[str, str], Opportunity] = {}
    by_title: dict[str, list[Opportunity]] = {}
    
    # First pass: exact match on title + link
    for opportunity in opportunities:
        key = (opportunity.title.lower(), opportunity.link.lower())
        existing = best.get(key)
        if existing is None or opportunity_richness(opportunity) > opportunity_richness(existing):
            best[key] = opportunity
        
        # Track by normalized title for fuzzy matching
        norm_title = _normalize_title(opportunity.title)
        if norm_title not in by_title:
            by_title[norm_title] = []
        by_title[norm_title].append(opportunity)
    
    # Second pass: find near-duplicates with same title but different sources
    deduplicated = list(best.values())
    seen_titles: dict[str, Opportunity] = {}
    
    final_list = []
    for opp in deduplicated:
        norm_title = _normalize_title(opp.title)
        
        if norm_title in seen_titles:
            existing = seen_titles[norm_title]
            # Keep the one with richer data
            if opportunity_richness(opp) > opportunity_richness(existing):
                # Replace existing with this one
                final_list = [o for o in final_list if _normalize_title(o.title) != norm_title]
                final_list.append(opp)
                seen_titles[norm_title] = opp
        else:
            final_list.append(opp)
            seen_titles[norm_title] = opp
    
    return final_list


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
