from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urljoin

import requests
import yaml
from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / ".env")

from common import (  # noqa: E402
    USER_AGENT,
    Opportunity,
    clean_text,
    dedupe,
    enrich_opportunity_fields,
    infer_category,
    infer_deadline,
    infer_grade_level,
    infer_subject,
    infer_timeline,
    truncate,
)
from llm_parser import (  # noqa: E402
    enrich_opportunities,
    extract_opportunities_from_page,
    is_ollama_available,
    normalize_category,
)

try:
    from supabase import create_client
except ImportError:  # Supabase upload is optional.
    create_client = None


SOURCES_CONFIG = ROOT_DIR / "sources.yaml"
OUTPUT_DIR = ROOT_DIR / "output"
DEFAULT_CSV = OUTPUT_DIR / "opportunities.csv"
DEFAULT_JSON = OUTPUT_DIR / "opportunities.json"
DEFAULT_FRONTEND_JSON = (
    ROOT_DIR.parent / "frontend" / "opportunity_searcher" / "public" / "data" / "opportunities.json"
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


def strip_numbered_prefix(title: str) -> str:
    return clean_text(re.sub(r"^\d+\.\s*", "", title))


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
            enrich_opportunity_fields(
                Opportunity(
                    title=title,
                    organization=title,
                    category=category,
                    location=default_location,
                    subject_area=subject,
                    deadline=infer_deadline(description),
                    timeline=infer_timeline(description),
                    grade_level=infer_grade_level(description, "High School"),
                    description=description,
                    link=link,
                    source=source,
                    source_url=url,
                    scraped_at=scraped_at,
                )
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
                enrich_opportunity_fields(
                    Opportunity(
                        title=title,
                        organization=title,
                        category=pick_extracurriculars_category(types),
                        location=location,
                        subject_area=", ".join(interests[:3]) or infer_subject(title, description),
                        deadline=clean_text(doc.get("deadline")),
                        timeline=infer_timeline(description),
                        grade_level=", ".join(grades) or "High School",
                        description=description,
                        link=clean_text(doc.get("website"))
                        or f"https://extracurriculars.org/extracurricular/{doc.get('id', '')}",
                        source="Extracurriculars.org",
                        source_url="https://extracurriculars.org/",
                        scraped_at=scraped_at,
                    )
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


def load_llm_sources(path: Path = SOURCES_CONFIG) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    with path.open(encoding="utf-8") as file:
        config = yaml.safe_load(file) or {}

    sources = config.get("llm_sources") or []
    if not isinstance(sources, list):
        raise RuntimeError(f"Invalid llm_sources in {path}")

    valid: list[dict[str, Any]] = []
    for entry in sources:
        if not isinstance(entry, dict):
            continue
        if not entry.get("url") or not entry.get("source"):
            continue
        valid.append(entry)
    return valid


def llm_item_to_opportunity(
    item: dict[str, str],
    *,
    page_url: str,
    source: str,
    scraped_at: str,
    default_category: str,
    default_location: str,
    default_subject: str,
) -> Opportunity:
    title = item["title"]
    description = truncate(item.get("description", ""), 500)
    category = item.get("category") or infer_category(title, description, default_category)

    return enrich_opportunity_fields(
        Opportunity(
            title=title,
            organization=item.get("organization") or title,
            category=normalize_category(category, title, description, default_category),
            location=item.get("location") or default_location,
            subject_area=item.get("subject_area") or infer_subject(title, description, default_subject),
            deadline=item.get("deadline") or infer_deadline(description),
            timeline=item.get("timeline") or infer_timeline(description),
            grade_level=item.get("grade_level") or infer_grade_level(description, "High School"),
            description=description,
            link=item["link"],
            source=source,
            source_url=page_url,
            scraped_at=scraped_at,
        )
    )


def parse_llm_sources(scraped_at: str, sources: list[dict[str, Any]]) -> list[Opportunity]:
    opportunities: list[Opportunity] = []

    for entry in sources:
        defaults = entry.get("defaults") or {}
        url = str(entry["url"])
        source = str(entry["source"])
        try:
            extracted = extract_opportunities_from_page(url=url, source=source)
        except Exception as error:  # noqa: BLE001 - keep scraping other sources
            print(f"LLM source failed ({source}): {error}", file=sys.stderr)
            continue

        for item in extracted:
            opportunities.append(
                llm_item_to_opportunity(
                    item,
                    page_url=url,
                    source=source,
                    scraped_at=scraped_at,
                    default_category=str(defaults.get("category", "Activity")),
                    default_location=str(defaults.get("location", "United States")),
                    default_subject=str(defaults.get("subject", "General")),
                )
            )

    return opportunities


def scrape(
    limit_extracurriculars: int | None,
    *,
    use_llm: bool | None = None,
    enrich_with_llm: bool | None = None,
) -> list[Opportunity]:
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

    llm_sources = load_llm_sources()
    ollama_up = is_ollama_available()
    should_use_llm = use_llm if use_llm is not None else ollama_up

    if llm_sources and should_use_llm:
        if not ollama_up:
            print(
                "LLM sources configured but Ollama is not reachable. "
                "Start Ollama or set OLLAMA_BASE_URL.",
                file=sys.stderr,
            )
        else:
            records.extend(parse_llm_sources(scraped_at, llm_sources))
    elif llm_sources and use_llm is False:
        print("Skipping LLM page sources (--skip-llm).")
    elif llm_sources and not ollama_up:
        print(
            f"Skipping {len(llm_sources)} LLM page source(s); Ollama is not running. "
            "Use --enable-llm after starting Ollama.",
        )

    records = dedupe(records)

    should_enrich = enrich_with_llm if enrich_with_llm is not None else ollama_up
    if should_enrich and ollama_up:
        try:
            records = enrich_opportunities(records)
        except Exception as error:  # noqa: BLE001
            print(f"LLM enrichment failed: {error}", file=sys.stderr)
    elif enrich_with_llm and not ollama_up:
        print("LLM enrichment skipped; Ollama is not running.", file=sys.stderr)

    return records


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
    llm_group = parser.add_mutually_exclusive_group()
    llm_group.add_argument(
        "--enable-llm",
        action="store_true",
        help="Scrape sources listed in scraper/sources.yaml with a local Ollama model.",
    )
    llm_group.add_argument(
        "--skip-llm",
        action="store_true",
        help="Skip LLM page scraping and enrichment even when Ollama is available.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    extra_limit = None if args.limit_extracurriculars < 0 else args.limit_extracurriculars

    use_llm = True if args.enable_llm else False if args.skip_llm else None
    enrich_with_llm = False if args.skip_llm else use_llm
    records = scrape(
        limit_extracurriculars=extra_limit,
        use_llm=use_llm,
        enrich_with_llm=enrich_with_llm,
    )
    write_csv(records, args.csv)
    write_json(records, args.json)
    write_json(records, args.frontend_json)

    if args.upload_supabase:
        upload_to_supabase(records)

    with_deadline = sum(1 for record in records if record.deadline)
    with_timeline = sum(1 for record in records if record.timeline)
    print(f"Scraped {len(records)} opportunities")
    print(f"With deadline: {with_deadline}/{len(records)}")
    print(f"With timeline: {with_timeline}/{len(records)}")
    print(f"CSV: {args.csv}")
    print(f"JSON: {args.json}")
    print(f"Frontend JSON: {args.frontend_json}")


if __name__ == "__main__":
    main()
