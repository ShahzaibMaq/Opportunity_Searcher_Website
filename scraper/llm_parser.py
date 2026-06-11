from __future__ import annotations

import json
import os
import re
from typing import Any
from urllib.parse import urlparse

import requests
import trafilatura
from bs4 import BeautifulSoup

from common import (
    ALLOWED_CATEGORIES,
    USER_AGENT,
    Opportunity,
    clean_text,
    infer_category,
    infer_deadline,
    infer_grade_level,
    infer_subject,
    infer_timeline,
    normalize_category,
    normalize_link,
    truncate,
)

OPPORTUNITY_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "opportunities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "organization": {"type": "string"},
                    "category": {"type": "string"},
                    "location": {"type": "string"},
                    "subject_area": {"type": "string"},
                    "deadline": {"type": "string"},
                    "timeline": {"type": "string"},
                    "grade_level": {"type": "string"},
                    "description": {"type": "string"},
                    "link": {"type": "string"},
                },
                "required": ["title", "link"],
            },
        }
    },
    "required": ["opportunities"],
}

ENRICHMENT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "records": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "deadline": {"type": "string"},
                    "timeline": {"type": "string"},
                    "grade_level": {"type": "string"},
                    "location": {"type": "string"},
                    "subject_area": {"type": "string"},
                    "category": {"type": "string"},
                },
                "required": ["index"],
            },
        }
    },
    "required": ["records"],
}

EXTRACTION_PROMPT = """You extract high-school student opportunities from web page content.

Return JSON with an "opportunities" array. Each item must include:
- title: program or opportunity name (required)
- organization: hosting org; use title if unknown
- category: one of Internship, Research, Scholarship, Competition, Summer Program, Volunteering, Activity
- location: city/state, "United States", "Global", etc.
- subject_area: e.g. STEM, Computer Science, Medicine
- deadline: exact deadline text from the page (dates, "Rolling", "Various", "Contact for deadline", etc.) or empty if truly absent
- timeline: when the program runs (e.g. "Summer", "Year-round", "Spring and Fall") or empty
- grade_level: e.g. "High School", "9-12", "Rising Junior"
- description: 1-3 sentences, max 500 characters
- link: absolute URL to apply or learn more (required)

Rules:
- Only real opportunities for students.
- Skip ads, navigation, and unrelated links.
- Use links present in the page content; do not invent URLs.
- Capture deadline/timeline wording exactly when the page states it, even if not a calendar date.
- If the page lists no opportunities, return an empty opportunities array.

Source name: {source}
"""

ENRICHMENT_PROMPT = """You enrich high-school opportunity records that are missing deadline or timeline details.

For each record, infer fields from the title and description:
- deadline: calendar date if stated, otherwise exact phrases like "Rolling", "Various", "Contact for deadline", or empty
- timeline: when the program runs
- grade_level, location, subject_area, category: fill only when clearly supported by the text

Use empty strings for unknown values. Do not invent URLs or organizations.
Return JSON with a "records" array matching the input indices.
"""


def ollama_settings() -> dict[str, Any]:
    return {
        "base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/"),
        "model": os.getenv("OLLAMA_MODEL", "llama3.2"),
        "max_page_chars": int(os.getenv("LLM_MAX_PAGE_CHARS", "8000")),
        "timeout": int(os.getenv("OLLAMA_TIMEOUT", "300")),
        "enrichment_batch_size": int(os.getenv("LLM_ENRICHMENT_BATCH_SIZE", "6")),
    }


def is_ollama_available() -> bool:
    settings = ollama_settings()
    try:
        response = requests.get(f"{settings['base_url']}/api/tags", timeout=3)
        return response.status_code == 200
    except requests.RequestException:
        return False


def html_to_text(html: str, url: str) -> str:
    extracted = trafilatura.extract(
        html,
        url=url,
        include_links=True,
        include_tables=True,
        favor_precision=True,
    )
    if extracted:
        return extracted

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        tag.decompose()
    return clean_text(soup.get_text("\n", strip=True))


def call_ollama(
    *,
    system_prompt: str,
    user_content: str,
    schema: dict[str, Any],
) -> dict[str, Any]:
    settings = ollama_settings()
    response = requests.post(
        f"{settings['base_url']}/api/chat",
        json={
            "model": settings["model"],
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "format": schema,
            "stream": False,
            "options": {"temperature": 0.1},
        },
        timeout=settings["timeout"],
    )
    response.raise_for_status()
    payload = response.json()
    content = payload.get("message", {}).get("content", "")
    if not content:
        raise RuntimeError("Ollama returned an empty response.")
    try:
        return json.loads(content)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Ollama returned invalid JSON: {error}") from error


def collect_page_links(html: str, page_url: str) -> set[str]:
    soup = BeautifulSoup(html, "html.parser")
    links: set[str] = set()
    for tag in soup.find_all("a", href=True):
        absolute = normalize_link(str(tag["href"]), page_url)
        if absolute:
            links.add(absolute)
    return links


def link_on_page(link: str, page_text: str, page_links: set[str]) -> bool:
    cleaned = clean_text(link)
    if not cleaned:
        return False
    if cleaned in page_links:
        return True
    if cleaned in page_text:
        return True

    parsed = urlparse(cleaned)
    if parsed.path and parsed.path != "/" and parsed.path in page_text:
        return True
    return False


def find_link_for_title(title: str, html: str, page_url: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    title_lower = title.lower()
    best_link = ""
    best_score = 0

    for tag in soup.find_all("a", href=True):
        anchor_text = clean_text(tag.get_text(" ", strip=True))
        if not anchor_text:
            continue
        anchor_lower = anchor_text.lower()
        if anchor_lower == title_lower:
            return normalize_link(str(tag["href"]), page_url)
        if title_lower in anchor_lower or anchor_lower in title_lower:
            score = min(len(anchor_lower), len(title_lower))
            if score > best_score:
                best_score = score
                best_link = normalize_link(str(tag["href"]), page_url)

    return best_link


def normalize_extracted_item(
    item: dict[str, Any],
    page_url: str,
    page_text: str,
    page_links: set[str],
    html: str,
) -> dict[str, str] | None:
    title = clean_text(item.get("title"))
    link = normalize_link(str(item.get("link", "")), page_url)
    if not title:
        return None

    parsed = urlparse(link)
    if parsed.scheme not in {"http", "https"} or not link_on_page(link, page_text, page_links):
        link = find_link_for_title(title, html, page_url)

    if not link or not link_on_page(link, page_text, page_links):
        print(f"LLM warning (link unverified): {title}. Using page URL.")
        link = page_url

    category = clean_text(item.get("category"))
    if category not in ALLOWED_CATEGORIES:
        category = ""

    return {
        "title": title,
        "organization": clean_text(item.get("organization")) or title,
        "category": category,
        "location": clean_text(item.get("location")),
        "subject_area": clean_text(item.get("subject_area")),
        "deadline": clean_text(item.get("deadline")),
        "timeline": clean_text(item.get("timeline")),
        "grade_level": clean_text(item.get("grade_level")),
        "description": clean_text(item.get("description")),
        "link": link,
    }


def extract_opportunities_from_page(
    *,
    url: str,
    source: str,
    html: str | None = None,
) -> list[dict[str, str]]:
    if html is None:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        html = response.text

    page_text = html_to_text(html, url)
    if not page_text.strip():
        print(f"LLM skip (no extractable text): {url}")
        return []

    page_links = collect_page_links(html, url)
    settings = ollama_settings()
    prompt = EXTRACTION_PROMPT.format(source=source)
    parsed = call_ollama(
        system_prompt=prompt,
        user_content=f"Page content:\n\n{page_text[:settings['max_page_chars']]}",
        schema=OPPORTUNITY_JSON_SCHEMA,
    )
    raw_items = parsed.get("opportunities", [])
    if not isinstance(raw_items, list):
        raise RuntimeError(f"Unexpected LLM response shape for {url}")

    opportunities: list[dict[str, str]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        normalized = normalize_extracted_item(item, url, page_text, page_links, html)
        if normalized is not None:
            opportunities.append(normalized)

    print(f"LLM extracted {len(opportunities)} opportunities from {source}")
    return opportunities


def needs_enrichment(opportunity: Opportunity) -> bool:
    return not opportunity.deadline


def enrich_opportunities(records: list[Opportunity]) -> list[Opportunity]:
    settings = ollama_settings()
    batch_size = settings["enrichment_batch_size"]
    enriched = list(records)

    pending = [(index, record) for index, record in enumerate(enriched) if needs_enrichment(record)]
    if not pending:
        return enriched

    print(f"LLM enriching {len(pending)} opportunities missing deadlines...")

    for start in range(0, len(pending), batch_size):
        batch = pending[start : start + batch_size]
        payload = [
            {
                "index": index,
                "title": record.title,
                "description": record.description,
                "category": record.category,
                "location": record.location,
                "deadline": record.deadline,
                "timeline": record.timeline,
            }
            for index, record in batch
        ]
        parsed = call_ollama(
            system_prompt=ENRICHMENT_PROMPT,
            user_content=json.dumps({"records": payload}, ensure_ascii=False),
            schema=ENRICHMENT_JSON_SCHEMA,
        )
        updates = parsed.get("records", [])
        if not isinstance(updates, list):
            continue

        for update in updates:
            if not isinstance(update, dict):
                continue
            index = update.get("index")
            if not isinstance(index, int) or index < 0 or index >= len(enriched):
                continue

            current = enriched[index]
            description = current.description
            enriched[index] = Opportunity(
                title=current.title,
                organization=current.organization,
                category=normalize_category(
                    str(update.get("category", "")),
                    current.title,
                    description,
                    current.category,
                ),
                location=clean_text(update.get("location")) or current.location,
                subject_area=clean_text(update.get("subject_area"))
                or current.subject_area
                or infer_subject(current.title, description),
                deadline=clean_text(update.get("deadline"))
                or current.deadline
                or infer_deadline(description),
                timeline=clean_text(update.get("timeline"))
                or current.timeline
                or infer_timeline(description),
                grade_level=clean_text(update.get("grade_level"))
                or current.grade_level
                or infer_grade_level(description, "High School"),
                description=current.description,
                link=current.link,
                source=current.source,
                source_url=current.source_url,
                scraped_at=current.scraped_at,
            )

    return enriched
