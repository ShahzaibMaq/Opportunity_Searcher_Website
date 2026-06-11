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
from typing import Any
from urllib.parse import urljoin

import requests
import yaml
from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv

from common import (
    ALLOWED_CATEGORIES,
    EXTRACURRICULARS_API_KEY,
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
    is_scope_filtered,
    normalize_category,
    normalize_grade_level,
    normalize_link,
    normalize_location,
    strip_numbered_prefix,
    truncate,
)
from llm_parser import (
    extract_opportunities_from_page,
    enrich_opportunities,
    is_ollama_available,
)

try:
    from supabase import create_client
except ImportError:  # Supabase upload is optional.
    create_client = None


ROOT_DIR = Path(__file__).resolve().parent
SOURCES_CONFIG = ROOT_DIR / "sources.config.yaml"
OUTPUT_DIR = ROOT_DIR / "output"
DEFAULT_CSV = OUTPUT_DIR / "opportunities.csv"
DEFAULT_JSON = OUTPUT_DIR / "opportunities.json"
DEFAULT_FRONTEND_JSON = (
    ROOT_DIR.parent / "frontend" / "opportunity_searcher" / "public" / "data" / "opportunities.json"
)
DEEP_DEADLINE_LIMIT = int(os.getenv("DEEP_DEADLINE_LIMIT", "50"))

SOURCE_TYPES_REQUIRING_LLM = {"llm_page"}


def fetch_html(url: str) -> BeautifulSoup:
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser")


def fetch_detail_text(url: str) -> str:
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        tag.decompose()
    return clean_text(soup.get_text(" ", strip=True))


def enrich_missing_details_from_links(records: list[Opportunity]) -> list[Opportunity]:
    enriched: list[Opportunity] = []
    checked = 0

    for record in records:
        needs_deadline = not record.deadline
        needs_grade = not record.grade_level or record.grade_level == "High School"
        if checked >= DEEP_DEADLINE_LIMIT or not record.link or not (needs_deadline or needs_grade):
            enriched.append(record)
            continue

        checked += 1
        try:
            detail_text = truncate(fetch_detail_text(record.link), 3000)
        except Exception as error:  # noqa: BLE001 - keep the scrape resilient
            print(f"Detail page failed ({record.title}): {error}", file=sys.stderr)
            enriched.append(record)
            continue

        combined_text = clean_text(f"{record.description} {detail_text}")
        enriched.append(
            Opportunity(
                title=record.title,
                organization=record.organization,
                category=record.category,
                location=record.location,
                subject_area=record.subject_area,
                deadline=record.deadline or infer_deadline(combined_text),
                timeline=record.timeline or infer_timeline(combined_text),
                grade_level=normalize_grade_level(record.grade_level, combined_text),
                description=record.description,
                link=record.link,
                source=record.source,
                source_url=record.source_url,
                scraped_at=record.scraped_at,
                deadline_date=record.deadline_date,
                is_active=record.is_active,
            )
        )

    if checked:
        print(f"Checked {checked} detail page(s) for missing deadlines/grades", file=sys.stderr)
    return enriched


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


def source_defaults(entry: dict[str, Any]) -> dict[str, str]:
    """Return source defaults with stable fallbacks."""
    defaults = entry.get("defaults") or {}
    return {
        "category": str(defaults.get("category", "Activity")),
        "location": str(defaults.get("location", "United States")),
        "subject": str(defaults.get("subject", "General")),
    }


def source_name(entry: dict[str, Any]) -> str:
    """Read the configured source name with backward-compatible fallback."""
    return str(entry.get("name") or entry.get("source") or "Unknown source")


def selector_text(parent: Tag | BeautifulSoup, selector: str | None) -> str:
    """Extract text for an optional CSS selector without crashing on missing fields."""
    if not selector:
        return ""

    selected = parent.select_one(selector)
    return clean_text(selected.get_text(" ", strip=True)) if selected else ""


def selector_link(parent: Tag | BeautifulSoup, selector: str | None, page_url: str) -> str:
    """Extract and resolve an optional link selector."""
    if not selector:
        return ""

    selected = parent.select_one(selector)
    if not selected or not isinstance(selected, Tag):
        return ""

    href = selected.get("href")
    return urljoin(page_url, str(href)) if href else ""


def parse_generic_css_source(entry: dict[str, Any], scraped_at: str) -> list[Opportunity]:
    """Scrape a source from declarative CSS selectors."""
    url = str(entry["url"])
    defaults = source_defaults(entry)
    selectors = entry.get("css_selectors") or {}
    soup = fetch_html(url)
    item_selector = selectors.get("item")
    items: list[Tag | BeautifulSoup] = soup.select(item_selector) if item_selector else [soup]
    opportunities: list[Opportunity] = []

    for item in items:
        title = selector_text(item, selectors.get("title"))
        if not title:
            continue

        description = truncate(selector_text(item, selectors.get("description")), 500)
        category = selector_text(item, selectors.get("category"))
        subject = selector_text(item, selectors.get("subject_area"))
        link = selector_link(item, selectors.get("link"), url) or url

        opportunities.append(
            enrich_opportunity_fields(
                Opportunity(
                    title=title,
                    organization=selector_text(item, selectors.get("organization")) or title,
                    category=normalize_category(
                        category or defaults["category"],
                        title,
                        description,
                        defaults["category"],
                    ),
                    location=selector_text(item, selectors.get("location")) or defaults["location"],
                    subject_area=subject or infer_subject(title, description, defaults["subject"]),
                    deadline=selector_text(item, selectors.get("deadline")),
                    timeline=selector_text(item, selectors.get("timeline")) or infer_timeline(description),
                    grade_level=selector_text(item, selectors.get("grade_level"))
                    or infer_grade_level(description, "High School"),
                    description=description,
                    link=link,
                    source=source_name(entry),
                    source_url=url,
                    scraped_at=scraped_at,
                )
            )
        )

    return opportunities


def parse_extracurriculars(
    scraped_at: str,
    limit: int | None,
    entry: dict[str, Any],
) -> list[Opportunity]:
    opportunities: list[Opportunity] = []
    per_page = 50
    page = 1
    url = str(entry["url"])

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
            url,
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
                        source=source_name(entry),
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


def load_sources_config(path: Path = SOURCES_CONFIG) -> list[dict[str, Any]]:
    """Load the single editable source registry."""
    if not path.exists():
        return []

    with path.open(encoding="utf-8") as file:
        config = yaml.safe_load(file) or {}

    sources = config.get("sources") or []
    if not isinstance(sources, list):
        raise RuntimeError(f"Invalid sources in {path}")

    valid: list[dict[str, Any]] = []
    for entry in sources:
        if not isinstance(entry, dict):
            continue
        if not entry.get("url") or not source_name(entry):
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
    title = clean_text(item.get("title"))
    if not title:
        raise ValueError("LLM item is missing a title")

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
            link=item.get("link") or page_url,
            source=source,
            source_url=page_url,
            scraped_at=scraped_at,
        )
    )


def parse_llm_sources(scraped_at: str, sources: list[dict[str, Any]]) -> list[Opportunity]:
    opportunities: list[Opportunity] = []

    for entry in sources:
        defaults = source_defaults(entry)
        url = str(entry["url"])
        source = source_name(entry)
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
                    default_category=defaults["category"],
                    default_location=defaults["location"],
                    default_subject=defaults["subject"],
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
    sources = load_sources_config()

    llm_sources: list[dict[str, Any]] = []
    for entry in sources:
        if entry.get("auth_required"):
            print(f"Skipping {source_name(entry)}; auth_required is true.", file=sys.stderr)
            continue

        scraper_type = str(entry.get("scraper_type", "generic_css"))
        defaults = source_defaults(entry)
        try:
            if scraper_type == "numbered_article":
                records.extend(
                    parse_numbered_article(
                        url=str(entry["url"]),
                        source=source_name(entry),
                        default_category=defaults["category"],
                        default_location=defaults["location"],
                        default_subject=defaults["subject"],
                        scraped_at=scraped_at,
                    )
                )
            elif scraper_type == "extracurriculars_api":
                configured_limit = entry.get("limit", limit_extracurriculars)
                limit = limit_extracurriculars if limit_extracurriculars is not None else configured_limit
                records.extend(parse_extracurriculars(scraped_at, limit, entry))
            elif scraper_type in SOURCE_TYPES_REQUIRING_LLM:
                llm_sources.append(entry)
            elif scraper_type == "generic_css":
                records.extend(parse_generic_css_source(entry, scraped_at))
            else:
                print(
                    f"Skipping {source_name(entry)}; unknown scraper_type '{scraper_type}'.",
                    file=sys.stderr,
                )
        except Exception as error:  # noqa: BLE001 - keep scraping other configured sources
            print(f"Source failed ({source_name(entry)}): {error}", file=sys.stderr)

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
    records = enrich_missing_details_from_links(records)
    
    # Filter out-of-scope locations (e.g., CA, FL, TX programs when targeting NJ)
    filtered_count = 0
    filtered_records = []
    for record in records:
        if is_scope_filtered(record.location):
            filtered_count += 1
        else:
            filtered_records.append(record)
    
    if filtered_count > 0:
        print(f"Filtered out {filtered_count} out-of-scope location opportunity(ies)", file=sys.stderr)
        records = filtered_records

    should_enrich = enrich_with_llm if enrich_with_llm is not None else ollama_up
    if should_enrich and ollama_up:
        try:
            records = enrich_opportunities(records)
        except Exception as error:  # noqa: BLE001
            print(f"LLM enrichment failed: {error}", file=sys.stderr)
    elif enrich_with_llm and not ollama_up:
        print("LLM enrichment skipped; Ollama is not running.", file=sys.stderr)

    return [enrich_opportunity_fields(record) for record in records]


def write_csv(records: list[Opportunity], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [asdict(record) for record in records]
    
    # Minimalist CSV: kept subject_area and timeline for functionality,
    # removed source, source_url, scraped_at
    fieldnames = [
        "title",
        "organization",
        "category",
        "location",
        "grade_level",
        "deadline",
        "deadline_date",
        "is_active",
        "description",
        "link",
        "subject_area",
        "timeline",
    ]
    
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_json(records: list[Opportunity], path: Path, *, active_only: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    
    # Create minimalist JSON with essential fields
    # Removed: source, source_url, scraped_at (not needed in frontend)
    # Kept: subject_area (for filtering), timeline (for display)
    minimal_records = []
    for record in records:
        if active_only and not record.is_active:
            continue
        minimal_records.append({
            "title": record.title,
            "organization": record.organization,
            "category": record.category,
            "location": record.location,
            "grade_level": record.grade_level,
            "deadline": record.deadline,
            "deadline_date": record.deadline_date,
            "is_active": record.is_active,
            "description": record.description,
            "link": record.link,
            "subject_area": record.subject_area or "",
            "timeline": record.timeline or "",
        })
    
    with path.open("w", encoding="utf-8") as file:
        json.dump(minimal_records, file, indent=2, ensure_ascii=False)


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
    client.rpc("archive_expired_opportunities").execute()
    response = client.table(table).upsert(payload, on_conflict="link").execute()
    if getattr(response, "error", None):
        raise RuntimeError(f"Supabase upload failed: {response.error}")
    client.rpc("archive_expired_opportunities").execute()


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
        help="Scrape llm_page sources listed in scraper/sources.config.yaml with a local Ollama model.",
    )
    llm_group.add_argument(
        "--skip-llm",
        action="store_true",
        help="Skip LLM page scraping and enrichment even when Ollama is available.",
    )
    return parser


def main() -> None:
    load_dotenv(ROOT_DIR / ".env")
    args = build_parser().parse_args()
    extra_limit = None if args.limit_extracurriculars < 0 else args.limit_extracurriculars

    use_llm = True if args.enable_llm else False if args.skip_llm else None
    records = scrape(
        limit_extracurriculars=extra_limit,
        use_llm=use_llm,
        enrich_with_llm=use_llm,
    )
    write_csv(records, args.csv)
    write_json(records, args.json)
    write_json(records, args.frontend_json, active_only=True)

    if args.upload_supabase:
        upload_to_supabase(records)

    with_deadline = sum(1 for record in records if record.deadline)
    with_timeline = sum(1 for record in records if record.timeline)
    archived = sum(1 for record in records if not record.is_active)
    print(f"Scraped {len(records)} opportunities")
    print(f"With deadline: {with_deadline}/{len(records)}")
    print(f"With timeline: {with_timeline}/{len(records)}")
    print(f"Archived inactive: {archived}/{len(records)}")
    print(f"CSV: {args.csv}")
    print(f"JSON: {args.json}")
    print(f"Frontend JSON: {args.frontend_json}")


if __name__ == "__main__":
    main()
