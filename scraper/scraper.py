from __future__ import annotations

import argparse
import csv
import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv

try:
    from supabase import create_client
except ImportError:  # Supabase upload is optional.
    create_client = None


ROOT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT_DIR / "output"
DEFAULT_CSV = OUTPUT_DIR / "opportunities.csv"
DEFAULT_JSON = OUTPUT_DIR / "opportunities.json"
DEFAULT_FRONTEND_JSON = (
    ROOT_DIR.parent / "frontend" / "opportunity_searcher" / "public" / "data" / "opportunities.json"
)

USER_AGENT = (
    "Mozilla/5.0 (compatible; OpportunitySearcherBot/0.1; "
    "+https://github.com/ShahzaibMaq/Opportunity_Searcher_Website)"
)

STANDOUT_URL = (
    "https://www.standoutconnect.org/post/"
    "20-internships-for-high-school-students-in-new-jersey"
)
COLLEGE_TRANSITIONS_URL = (
    "https://www.collegetransitions.com/blog/"
    "research-opportunities-for-high-school-students/"
)
EXTRACURRICULARS_SEARCH_URL = (
    "https://typesense.extracurriculars.org/collections/"
    "extracurriculars/documents/search"
)
EXTRACURRICULARS_API_KEY = "L9EJr1spJTxXQ7zEpN22t64YIForeUiX"

DATE_PATTERN = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b",
    re.IGNORECASE,
)


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


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"\s+", " ", value).strip()
    return text.replace("T he ", "The ")


def strip_numbered_prefix(title: str) -> str:
    return clean_text(re.sub(r"^\d+\.\s*", "", title))


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


def listing_description(heading: Tag) -> str:
    chunks: list[str] = []
    block_tags = {"div", "p", "li"}
    nested_block_tags = {"div", "p", "li", "ul", "ol", "h2", "h3", "h4"}
    title = clean_text(heading.get_text(" ", strip=True))

    for element in heading.next_elements:
        if element is heading:
            continue
        if isinstance(element, Tag) and element.name in {"h2", "h3"}:
            break
        if not isinstance(element, Tag) or element.name not in block_tags:
            continue

        if element.find(list(nested_block_tags)):
            continue

        text = clean_text(element.get_text(" ", strip=True))
        if not text or text == title or text in chunks:
            continue

        chunks.append(text)
        if len(" ".join(chunks)) > 650:
            break

    return truncate(" ".join(chunks), 500)


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
    match = DATE_PATTERN.search(description)
    return clean_text(match.group(0)) if match else ""


def parse_numbered_article(
    *,
    url: str,
    source: str,
    default_category: str,
    default_location: str,
    default_subject: str,
    scraped_at: str,
) -> list[Opportunity]:
    soup = fetch_html(url)
    opportunities: list[Opportunity] = []

    for heading in soup.find_all("h3"):
        raw_title = clean_text(heading.get_text(" ", strip=True))
        if not re.match(r"^\d+\.\s+", raw_title):
            continue

        title = strip_numbered_prefix(raw_title)
        link_tag = heading.find("a", href=True)
        link = urljoin(url, link_tag["href"]) if link_tag else url
        description = listing_description(heading)
        category = infer_category(title, description, default_category)
        subject = infer_subject(title, description, default_subject)

        opportunities.append(
            Opportunity(
                title=title,
                organization=title,
                category=category,
                location=default_location,
                subject_area=subject,
                deadline=infer_deadline(description),
                grade_level="High School",
                description=description,
                link=link,
                source=source,
                source_url=url,
                scraped_at=scraped_at,
            )
        )

    return opportunities


def parse_extracurriculars(scraped_at: str, limit: int | None) -> list[Opportunity]:
    opportunities: list[Opportunity] = []
    per_page = 50
    page = 1

    while True:
        remaining = None if limit is None else limit - len(opportunities)
        if remaining is not None and remaining <= 0:
            break

        params = {
            "q": "*",
            "query_by": "title,description,type,interest,state,grade",
            "per_page": min(per_page, remaining or per_page),
            "page": page,
        }
        response = requests.get(
            EXTRACURRICULARS_SEARCH_URL,
            params=params,
            headers={
                "User-Agent": USER_AGENT,
                "X-TYPESENSE-API-KEY": EXTRACURRICULARS_API_KEY,
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        hits = payload.get("hits", [])
        if not hits:
            break

        for hit in hits:
            doc = hit.get("document", {})
            title = clean_text(doc.get("title"))
            description = truncate(doc.get("description", ""), 500)
            types = doc.get("type") or []
            interests = doc.get("interest") or []
            states = doc.get("state") or []
            grades = doc.get("grade") or []

            if len(states) == 0:
                location = "Global"
            elif len(states) > 12:
                location = "United States"
            else:
                location = ", ".join(states)

            opportunities.append(
                Opportunity(
                    title=title,
                    organization=title,
                    category=pick_extracurriculars_category(types),
                    location=location,
                    subject_area=", ".join(interests[:3]) or infer_subject(title, description),
                    deadline=clean_text(doc.get("deadline")),
                    grade_level=", ".join(grades) or "High School",
                    description=description,
                    link=clean_text(doc.get("website"))
                    or f"https://extracurriculars.org/extracurricular/{doc.get('id', '')}",
                    source="Extracurriculars.org",
                    source_url="https://extracurriculars.org/",
                    scraped_at=scraped_at,
                )
            )

        found = int(payload.get("found") or 0)
        if page * per_page >= found:
            break
        page += 1

    return opportunities


def pick_extracurriculars_category(types: Iterable[str]) -> str:
    values = {value.lower() for value in types}
    if "internship" in values:
        return "Internship"
    if "competition" in values:
        return "Competition"
    if "research" in values:
        return "Research"
    if "volunteering" in values:
        return "Volunteering"
    if "summer" in values:
        return "Summer Program"
    return "Activity"


def dedupe(opportunities: Iterable[Opportunity]) -> list[Opportunity]:
    seen: set[tuple[str, str]] = set()
    unique: list[Opportunity] = []

    for opportunity in opportunities:
        key = (opportunity.title.lower(), opportunity.link.lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(opportunity)

    return unique


def scrape(limit_extracurriculars: int | None) -> list[Opportunity]:
    scraped_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    records: list[Opportunity] = []

    records.extend(
        parse_numbered_article(
            url=STANDOUT_URL,
            source="StandOut Connect",
            default_category="Internship",
            default_location="New Jersey",
            default_subject="General",
            scraped_at=scraped_at,
        )
    )
    records.extend(
        parse_numbered_article(
            url=COLLEGE_TRANSITIONS_URL,
            source="College Transitions",
            default_category="Research",
            default_location="United States",
            default_subject="STEM",
            scraped_at=scraped_at,
        )
    )
    records.extend(parse_extracurriculars(scraped_at, limit_extracurriculars))

    return dedupe(records)


def write_csv(records: list[Opportunity], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [asdict(record) for record in records]
    fieldnames = list(asdict(records[0]).keys()) if records else list(Opportunity.__dataclass_fields__)

    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_json(records: list[Opportunity], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump([asdict(record) for record in records], file, indent=2, ensure_ascii=False)


def upload_to_supabase(records: list[Opportunity]) -> None:
    if create_client is None:
        raise RuntimeError("Install supabase from scraper/requirements.txt before uploading.")

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    table = os.getenv("SUPABASE_TABLE", "opportunities")

    if not url or not key:
        raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in scraper/.env.")

    client = create_client(url, key)
    payload = [asdict(record) for record in records]
    client.table(table).upsert(payload, on_conflict="link").execute()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scrape high school opportunity listings.")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="CSV output path.")
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON, help="JSON output path.")
    parser.add_argument(
        "--frontend-json",
        type=Path,
        default=DEFAULT_FRONTEND_JSON,
        help="JSON path served by the Next.js frontend.",
    )
    parser.add_argument(
        "--limit-extracurriculars",
        type=int,
        default=120,
        help="Maximum records to pull from extracurriculars.org. Use 0 to skip it.",
    )
    parser.add_argument(
        "--upload-supabase",
        action="store_true",
        help="Upload scraped records to Supabase using scraper/.env credentials.",
    )
    return parser


def main() -> None:
    load_dotenv(ROOT_DIR / ".env")
    args = build_parser().parse_args()
    extra_limit = None if args.limit_extracurriculars < 0 else args.limit_extracurriculars

    records = scrape(limit_extracurriculars=extra_limit)
    write_csv(records, args.csv)
    write_json(records, args.json)
    write_json(records, args.frontend_json)

    if args.upload_supabase:
        upload_to_supabase(records)

    print(f"Scraped {len(records)} opportunities")
    print(f"CSV: {args.csv}")
    print(f"JSON: {args.json}")
    print(f"Frontend JSON: {args.frontend_json}")


if __name__ == "__main__":
    main()
