from __future__ import annotations

import re
from difflib import SequenceMatcher
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

TRACKING_QUERY_PREFIXES = ("utm_",)
TRACKING_QUERY_KEYS = {"fbclid", "gclid", "mc_cid", "mc_eid"}
MIN_TITLE_SIMILARITY = 0.72
MIN_URL_SIMILARITY = 0.62


def normalize_title_for_match(title: str) -> str:
    """Reduce title noise before duplicate comparison."""
    cleaned = title.lower()
    cleaned = re.sub(r"\b(the|a|an|program|for|high|school|students?)\b", " ", cleaned)
    cleaned = re.sub(r"[^a-z0-9]+", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def canonical_url(url: str) -> str:
    """Remove tracking noise and normalize host/path casing for URL matching."""
    if not url:
        return ""

    parsed = urlparse(url.strip())
    query_pairs = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key not in TRACKING_QUERY_KEYS
        and not any(key.startswith(prefix) for prefix in TRACKING_QUERY_PREFIXES)
    ]
    path = re.sub(r"/+$", "", parsed.path.lower())
    netloc = parsed.netloc.lower().removeprefix("www.")
    return urlunparse((parsed.scheme.lower(), netloc, path, "", urlencode(query_pairs), ""))


def similarity(first: str, second: str) -> float:
    """Return a stable 0-1 string similarity score."""
    if not first or not second:
        return 0
    return SequenceMatcher(None, first, second).ratio()


def token_overlap(first: str, second: str) -> float:
    """Score overlap between meaningful title tokens."""
    first_tokens = set(normalize_title_for_match(first).split())
    second_tokens = set(normalize_title_for_match(second).split())
    if not first_tokens or not second_tokens:
        return 0
    return len(first_tokens & second_tokens) / len(first_tokens | second_tokens)


def is_duplicate_listing(
    first_title: str,
    first_url: str,
    second_title: str,
    second_url: str,
) -> bool:
    """Check whether two listings describe the same opportunity."""
    first_canonical_url = canonical_url(first_url)
    second_canonical_url = canonical_url(second_url)
    if first_canonical_url and first_canonical_url == second_canonical_url:
        return True

    title_score = max(
        similarity(normalize_title_for_match(first_title), normalize_title_for_match(second_title)),
        token_overlap(first_title, second_title),
    )
    url_score = similarity(first_canonical_url, second_canonical_url)
    same_domain = bool(
        first_canonical_url
        and second_canonical_url
        and urlparse(first_canonical_url).netloc == urlparse(second_canonical_url).netloc
    )

    return title_score >= MIN_TITLE_SIMILARITY and (
        url_score >= MIN_URL_SIMILARITY or same_domain or not first_canonical_url or not second_canonical_url
    )
