from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse




# Constants
USER_AGENT = (
    "Mozilla/5.0 (compatible; OpportunitySearcherBot/0.1; "
    "+https://github.com/ShahzaibMaq/Opportunity_Searcher_Website)"
)

EXTRACURRICULARS_API_KEY = "L9EJr1spJTxXQ7zEpN22t64YIForeUiX"

ALLOWED_CATEGORIES = {
    "Internship",
    "Summer Program",
    "Scholarship",
    "Research",
    "Competition",
    "Activity",
    "Volunteering",
}


@dataclass(frozen=True)
class Opportunity:
    title: str
    organization: str
    category: str
    location: str
    subject_area: str
    deadline: str
    grade_level: str
    description: str
    link: str
    source: str
    source_url: str
    scraped_at: str
    timeline: str = ""
    deadline_date: str = ""
    is_active: bool = True


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


def strip_numbered_prefix(title: str) -> str:
    return clean_text(re.sub(r"^\d+\.\s*", "", title))


def normalize_link(link: str, page_url: str) -> str:
    """Normalize and validate a link URL."""
    if not link:
        return ""
    
    absolute_url = urljoin(page_url, link)
    parsed = urlparse(absolute_url)
    
    if parsed.scheme not in {"http", "https"}:
        return ""
    
    return absolute_url.rstrip("/")


def normalize_location(location: str | None) -> str:
    """Normalize location to extract just the location string, not full description."""
    if not location:
        return ""
    
    location = clean_text(location).strip()
    
    # Extract just the first line or first sentence for location
    # This prevents long descriptions from being stored in the location field
    lines = location.split("\n")
    first_line = clean_text(lines[0]).strip()
    
    # If it looks like it contains extra information (very long), truncate
    if len(first_line) > 100:
        # Try to extract just the location part (usually at the beginning)
        sentences = first_line.split(".")
        first_sentence = clean_text(sentences[0]).strip()
        if len(first_sentence) > 80:
            # Last resort: take first 50 characters
            first_sentence = first_sentence[:50].rsplit(" ", 1)[0]
        return first_sentence
    
    return first_line


def normalize_category(
    category: str,
    title: str,
    description: str,
    fallback: str = "Activity",
) -> str:
    """Normalize category to one of the allowed categories."""
    if not category:
        category = infer_category(title, description, fallback)
    
    normalized = category.strip().title()
    if normalized in ALLOWED_CATEGORIES:
        return normalized
    
    return fallback


def infer_category(title: str, description: str, fallback: str = "Activity") -> str:
    title_lower = title.lower()
    checks = [
        ("Scholarship", ["scholarship", "grant", "financial aid"]),
        ("Competition", ["competition", "challenge", "contest", "prize", "essay"]),
        ("Research", ["research", "laboratory", "lab ", "science research"]),
        ("Internship", ["internship", "intern ", "apprenticeship"]),
        ("Summer Program", ["summer", "program"]),
        ("Volunteering", ["volunteer", "volunteering"]),
    ]

    # Check title first for stronger signals
    for category, keywords in checks:
        if any(keyword in title_lower for keyword in keywords):
            return category

    haystack = f"{title} {description}".lower()
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


def infer_timeline(description: str) -> str:
    """Infer program timeline from description."""
    description_lower = description.lower()
    
    patterns = [
        ("Full Year", r"\bfull.?year\b"),
        ("Academic Year", r"\bacademic.?year\b"),
        ("Spring", r"\bspring\b"),
        ("Summer", r"\bsummer\b"),
        ("Fall", r"\bfall\b"),
        ("Winter", r"\bwinter\b"),
        ("4 weeks", r"\b4.?weeks?\b"),
        ("6 weeks", r"\b6.?weeks?\b"),
        ("8 weeks", r"\b8.?weeks?\b"),
        ("10 weeks", r"\b10.?weeks?\b"),
    ]
    
    for timeline, pattern in patterns:
        if re.search(pattern, description_lower):
            return timeline
    
    return ""


DATE_PATTERN = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b",
    re.IGNORECASE,
)


def infer_deadline(description: str) -> str:
    text = clean_text(description)
    if not text:
        return ""

    labeled_deadline = re.search(
        r"\b(?:application\s+)?deadline(?:\s+is)?\s*:\s*([^.;|\n]+)",
        text,
        re.IGNORECASE,
    )
    if labeled_deadline:
        return clean_text(labeled_deadline.group(1))

    phrase_deadline = re.search(
        r"\b(?:applications?\s+(?:are\s+)?(?:due|close)|apply\s+by|submit(?:ted)?\s+by)\s+([^.;|\n]+)",
        text,
        re.IGNORECASE,
    )
    if phrase_deadline:
        return clean_text(phrase_deadline.group(1))

    special_deadline = re.search(
        r"\b(rolling|various|tba|tbd|to be announced|contact for deadline|not yet announced)\b",
        text,
        re.IGNORECASE,
    )
    if special_deadline:
        return clean_text(special_deadline.group(1)).title()

    match = DATE_PATTERN.search(text)
    return clean_text(match.group(0)) if match else ""


def normalize_grade_level(value: str | None, description: str = "") -> str:
    text = clean_text(value)
    context = clean_text(f"{text} {description}")
    normalized = context.lower()
    grades: set[int] = set()

    grade_words = {
        9: ["freshman", "freshmen", "9th", "grade 9", "rising 9"],
        10: ["sophomore", "sophomores", "10th", "grade 10", "rising 10"],
        11: ["junior", "juniors", "11th", "grade 11", "rising 11"],
        12: ["senior", "seniors", "12th", "grade 12", "rising 12", "graduating senior"],
    }
    for grade, words in grade_words.items():
        if any(re.search(rf"\b{re.escape(word)}\b", normalized) for word in words):
            grades.add(grade)

    for match in re.finditer(r"\bgrades?\s*(\d{1,2})\s*(?:-|to|through)\s*(\d{1,2})\b", normalized):
        start, end = int(match.group(1)), int(match.group(2))
        grades.update(range(max(1, start), min(12, end) + 1))

    for match in re.finditer(r"\bgrades?\s*((?:\d{1,2}\s*,?\s*(?:and\s*)?)+)\b", normalized):
        for number in re.findall(r"\d{1,2}", match.group(1)):
            grade = int(number)
            if 1 <= grade <= 12:
                grades.add(grade)

    if grades:
        high_school_grades = [grade for grade in sorted(grades) if 9 <= grade <= 12]
        if high_school_grades:
            return ", ".join(str(grade) for grade in high_school_grades)

    if re.search(r"\bhigh school\b", normalized):
        return "High School"
    if text:
        return text
    return "High School"


def infer_grade_level(description: str, fallback: str = "High School") -> str:
    """Infer grade level from description."""
    inferred = normalize_grade_level("", description)
    if inferred != "High School":
        return inferred

    description_lower = description.lower()
    patterns = [
        ("High School", r"\b(?:high school|9th|10th|11th|12th|grades 9-12)\b"),
        ("Middle School", r"\b(?:middle school|6th|7th|8th|grades 6-8)\b"),
        ("College", r"\b(?:college|undergraduate)\b"),
    ]

    for grade_level, pattern in patterns:
        if re.search(pattern, description_lower):
            return grade_level

    return fallback


def enrich_opportunity_fields(opp: Opportunity) -> Opportunity:
    """Ensure all fields have sensible defaults and are cleaned."""
    return Opportunity(
        title=clean_text(opp.title) or "Untitled",
        organization=clean_text(opp.organization) or opp.title or "Unknown Organization",
        category=normalize_category(opp.category, opp.title, opp.description),
        location=normalize_location(opp.location),
        subject_area=clean_text(opp.subject_area),
        deadline=clean_text(opp.deadline) or infer_deadline(opp.description),
        timeline=clean_text(opp.timeline) or infer_timeline(opp.description),
        grade_level=normalize_grade_level(opp.grade_level, opp.description),
        description=truncate(opp.description, 500),
        link=normalize_link(opp.link, "") or opp.link,
        source=clean_text(opp.source),
        source_url=opp.source_url,
        scraped_at=opp.scraped_at,
        deadline_date=opp.deadline_date,
        is_active=opp.is_active,
    )


def is_scope_filtered(location: str) -> bool:
    """Check if a location should be filtered out (e.g., CA, FL, TX specific programs when targeting NJ)."""
    location_lower = (location or "").lower()
    
    # Keep anything that's national, remote, or general
    if any(keyword in location_lower for keyword in ["national", "united states", "usa", "remote", "virtual", "online", "global"]):
        return False
    
    # Keep anything in the target region (NJ/NY area)
    if any(keyword in location_lower for keyword in ["new jersey", "nj", "new york", "ny", "pennsylvania", "pa", "connecticut", "ct"]):
        return False
    
    # Filter out specific out-of-scope states (CA, FL, TX, etc)
    out_of_scope = [
        "california", "ca ", "florida", "fl ", "texas", "tx ", 
        "washington", "seattle", "illinois", "chicago", "boston", "massachusetts"
    ]
    if any(keyword in location_lower for keyword in out_of_scope):
        return True
    
    # Default: keep it
    return False


def dedupe(opportunities: list[Opportunity]) -> list[Opportunity]:
    """Remove duplicate opportunities based on title and link."""
    from dedupe import is_duplicate_listing
    
    seen: set[str] = set()
    unique: list[Opportunity] = []

    for opportunity in opportunities:
        key = (opportunity.title.lower(), opportunity.link.lower())
        
        # Check against previously seen opportunities for duplicates
        is_dup = False
        for unique_opp in unique:
            if is_duplicate_listing(
                opportunity.title,
                opportunity.link,
                unique_opp.title,
                unique_opp.link,
            ):
                is_dup = True
                break
        
        if not is_dup:
            unique.append(opportunity)

    return unique
