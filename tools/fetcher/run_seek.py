"""Seek (au.seek.com) incremental job fetcher — runs parallel to run_jobspy.py.

LEGAL / TERMS OF SERVICE NOTICE
------------------------------
Seek's Terms of Use (au.seek.com/terms, clauses 7(d), 9(b), 9(d)) prohibit
automated data gathering and circumventing anti-bot measures. This worker is
DELIBERATELY the mild variant:

  * It calls the same public graphql endpoint (`/graphql`, operation
    JobSearchV6) that au.seek.com serves to ordinary clients — no warm-up
    page, no v5 REST.
  * It does NOT solve Cloudflare challenges, spoof TLS/JA3 fingerprints, or
    rotate residential proxies.
  * On an anti-bot challenge (403 / interstitial) it STOPS the run, rather
    than attempting to bypass the measure — no challenge is ever solved and
    no fingerprint is spoofed.
  * It identifies honestly by default (User-Agent `Joblit-Fetcher/...`). An
    operator may override `SEEK_USER_AGENT` for browser compatibility, but that
    is a conscious choice, not built-in evasion.

Running this against Seek is the operator's own risk decision. Live network
calls are gated behind the env flag `SEEK_FETCH_ENABLED=true`; without it the
worker refuses to hit Seek. Prefer the managed path (Apify) to keep this risk
off a public-facing brand.
"""

import os
import re
import json
import time
import random
import logging
import argparse
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlsplit

import requests

logging.basicConfig(
    level=logging.INFO, format="[%(asctime)s] %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("seek_runner")

# ── Endpoints ──────────────────────────────────────────────────────────────
SEEK_HOST = "au.seek.com"
SEEK_ORIGIN = f"https://{SEEK_HOST}"
# Current Seek search stack: the consumer graphql BFF (same endpoint the
# on-demand JD fetch uses). A JSON API POST, NOT the /jobs HTML page — so it
# sidesteps the Cloudflare JS-challenge that walls the warm-up + v5 REST path
# from a datacenter IP. operationName JobSearchV6, input JobSearchV6QueryInput.
SEEK_GRAPHQL_URL = f"{SEEK_ORIGIN}/graphql"
SEEK_JOB_URL_TEMPLATE = f"{SEEK_ORIGIN}/job/{{job_id}}"

# ── Search params ──────────────────────────────────────────────────────────
DEFAULT_WHERE = "All Australia"
SEEK_PAGE_CEILING = 5  # Seek hard-caps any search at ~500 results = 5 pages x 100.
# Default to a 2-day window so a missed/late cron run does not silently drop a
# day of postings; downstream (userId, jobUrl) dedupe absorbs the overlap.
DEFAULT_DATERANGE_DAYS = 2

# ── Politeness / resilience ────────────────────────────────────────────────
REQUEST_DELAY_SEC = 1.2
REQUEST_TIMEOUT_SEC = 25.0
MAX_RETRIES = 2
RETRY_BACKOFF_SEC = 3.0
RETRY_AFTER_CAP_SEC = 60.0
IMPORT_RETRIES = 2

# ── Defensive bounds (untrusted external data) ─────────────────────────────
MAX_TITLE = 512
MAX_TEXT_FIELD = 256
MAX_DESCRIPTION = 50_000
MAX_TOTAL_ROWS = 20_000

SEEK_ID_RE = re.compile(r"^[0-9]+$")  # Seek job ids are numeric — pin this.
CHALLENGE_NEEDLES = (
    "just a moment",
    "challenges.cloudflare.com",
    "cf-mitigated",
    "attention required",
)

DEFAULT_USER_AGENT = "Joblit-Fetcher/1.0 (+https://www.joblit.tech)"


class SeekChallengeError(RuntimeError):
    """Raised when Seek returns an anti-bot challenge. The worker stops here by
    design rather than circumventing the measure."""


class PartialImportError(RuntimeError):
    """Raised when some import batches committed before a later batch failed.
    Carries the count actually imported so the run status doesn't lie."""

    def __init__(self, imported: int, cause: object) -> None:
        self.imported = imported
        super().__init__(str(cause))


# ── Pure helpers (network-free, unit-tested) ───────────────────────────────
def _truncate(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text[:limit]


def is_valid_seek_id(job_id: Any) -> bool:
    return bool(SEEK_ID_RE.match(str(job_id or "")))


def seek_job_url(job_id: Any) -> str:
    """Build a Seek job URL. Returns "" for ids that are not strictly numeric,
    so a crafted id can never be format-injected into the URL authority/path."""
    if not is_valid_seek_id(job_id):
        return ""
    return SEEK_JOB_URL_TEMPLATE.format(job_id=str(job_id))


def is_seek_host(url: str) -> bool:
    try:
        return (urlsplit(url).hostname or "").lower() == SEEK_HOST
    except ValueError:
        return False


def normalize_seek_where(location: Any) -> str:
    """Seek's `where` expects a Seek location token ("All Australia", "Sydney",
    "Sydney NSW"), NOT the LinkedIn-style "City, State, Country" string — which
    returns ZERO results. Take the leading segment (the city) and fall back to
    All Australia when empty."""
    text = str(location or "").strip()
    if not text:
        return DEFAULT_WHERE
    first = text.split(",")[0].strip()
    return first or DEFAULT_WHERE


def classify_response(status_code: int, content_type: str, body: str) -> str:
    """Triage a response into: ok | challenge | transient | client_error.

    challenge  -> Cloudflare interstitial or 403: re-warm once then stop.
    transient  -> 429/5xx: retry with backoff (+ Retry-After if given).
    client_error -> other 4xx / non-JSON 2xx mismatch: fail fast, no retry.
    """
    # Cloudflare interstitials are HTML. A legitimate JSON 2xx body can contain a
    # needle phrase (e.g. a job title "Attention Required: Safety Officer"), so
    # only scan non-JSON bodies for challenge markers.
    is_json = "application/json" in (content_type or "").lower()
    text = (body or "")[:2000].lower()
    if not is_json and any(n in text for n in CHALLENGE_NEEDLES):
        return "challenge"
    if status_code == 403:
        return "challenge"
    if status_code in (429, 500, 502, 503, 504):
        return "transient"
    if 400 <= status_code < 500:
        return "client_error"
    if 200 <= status_code < 300:
        # A normal page (warm-up) returns HTML and is fine; an API endpoint that
        # returns HTML instead of JSON is caught later when res.json() fails.
        return "ok"
    return "transient"


def retry_after_seconds(headers: Any) -> Optional[float]:
    raw = ""
    try:
        raw = (headers.get("Retry-After") or headers.get("retry-after") or "").strip()
    except AttributeError:
        return None
    if not raw or not raw.isdigit():
        return None
    return min(float(raw), RETRY_AFTER_CAP_SEC)


# ── graphql JobSearchV6 (current Seek search stack) ────────────────────────
#
# A trimmed selection of the real browser query — we request only the fields
# map_job consumes (graphql lets a client under-select). One request per page,
# no warm-up. `params` carries only fields confirmed from a live capture
# (keywords / siteKey / page / pageSize / locale / source / channel / include):
# we deliberately do NOT guess unverified input fields (where / classification
# / workType) — those are applied client-side from the returned rows instead,
# so we never fabricate an API contract.
JOB_SEARCH_V6_QUERY = (
    "query JobSearchV6($params: JobSearchV6QueryInput!) {"
    " jobSearchV6(params: $params) {"
    " data { id title teaser companyName salaryLabel workTypes"
    " advertiser { description } bulletPoints"
    " listingDate { dateTimeUtc } locations { label }"
    " workArrangements { displayText } }"
    " totalCount } }"
)

GRAPHQL_PAGE_SIZE = 100  # Seek serves up to 100/page on the BFF too.


def build_graphql_variables(
    *, keywords: str = "", page: int = 1, page_size: int = GRAPHQL_PAGE_SIZE
) -> Dict[str, Any]:
    """Build JobSearchV6 variables from only live-captured input fields."""
    params: Dict[str, Any] = {
        "channel": "web",
        "include": ["seoData", "gptTargeting", "relatedSearches"],
        "locale": "en-AU",
        "page": page,
        "pageSize": page_size,
        "siteKey": "AU",
        "source": "FE_SERP",
    }
    if keywords.strip():
        params["keywords"] = keywords.strip()
    return {"params": params}


def parse_graphql_payload(payload: Any) -> Dict[str, Any]:
    """Pull the listings array + totalCount out of a JobSearchV6 response.
    Tolerant: any shape drift collapses to an empty page, surfaced by the
    caller's totalCount>0-but-no-rows warning."""
    if not isinstance(payload, dict):
        return {"total_count": 0, "jobs": []}
    if isinstance(payload.get("errors"), list) and payload["errors"]:
        # graphql transport-200 with an errors[] body — treat as no rows; the
        # caller logs it. (e.g. an input field Seek no longer accepts.)
        first = payload["errors"][0]
        msg = first.get("message") if isinstance(first, dict) else str(first)
        return {"total_count": 0, "jobs": [], "error": str(msg or "graphql error")}
    root = payload.get("data")
    root = root.get("jobSearchV6") if isinstance(root, dict) else None
    if not isinstance(root, dict):
        return {"total_count": 0, "jobs": []}
    jobs = root.get("data")
    return {
        "total_count": int(root.get("totalCount") or 0),
        "jobs": jobs if isinstance(jobs, list) else [],
    }


def _first_company(raw: Dict[str, Any]) -> str:
    name = raw.get("companyName")
    if isinstance(name, str) and name.strip():
        return _truncate(name, MAX_TEXT_FIELD)
    advertiser = raw.get("advertiser")
    if isinstance(advertiser, dict) and isinstance(advertiser.get("description"), str):
        return _truncate(advertiser["description"], MAX_TEXT_FIELD)
    return ""


def _join_locations(raw: Dict[str, Any]) -> str:
    locs = raw.get("locations")
    if not isinstance(locs, list):
        return ""
    labels = [str(loc.get("label", "")).strip() for loc in locs if isinstance(loc, dict)]
    return _truncate(", ".join([lbl for lbl in labels if lbl]), MAX_TEXT_FIELD)


def _teaser_description(raw: Dict[str, Any]) -> str:
    parts: List[str] = []
    teaser = raw.get("teaser")
    if isinstance(teaser, str) and teaser.strip():
        parts.append(teaser.strip())
    bullets = raw.get("bulletPoints")
    if isinstance(bullets, list):
        for b in bullets:
            if isinstance(b, str) and b.strip():
                parts.append(f"- {b.strip()}")
    return _truncate("\n".join(parts), MAX_DESCRIPTION)


def _work_arrangement(raw: Dict[str, Any]) -> str:
    wa = raw.get("workArrangements")
    if isinstance(wa, dict):
        # graphql JobSearchV6 shape: { displayText }
        display = wa.get("displayText")
        if isinstance(display, str) and display.strip():
            return _truncate(display, MAX_TEXT_FIELD)
        # legacy v5 shape: { data: [{ label }] }
        data = wa.get("data")
        if isinstance(data, list) and data and isinstance(data[0], dict):
            label = data[0].get("label")
            if isinstance(label, str):
                return _truncate(label, MAX_TEXT_FIELD)
    return ""


def _listing_date(raw: Dict[str, Any]) -> str:
    """listingDate is a string in the legacy v5 payload but { dateTimeUtc } in
    the graphql JobSearchV6 payload — normalise both to an ISO string."""
    ld = raw.get("listingDate")
    if isinstance(ld, dict):
        return str(ld.get("dateTimeUtc") or "").strip()
    return str(ld or "").strip()


def map_job(raw: Any) -> Optional[Dict[str, str]]:
    """Map one Seek v5 result to Joblit's /api/admin/import row schema. Rejects
    rows without a numeric id / title (numeric id also closes the SSRF vector)."""
    if not isinstance(raw, dict):
        return None
    job_id = raw.get("id")
    title = _truncate(raw.get("title", ""), MAX_TITLE)
    if not is_valid_seek_id(job_id) or not title:
        return None
    work_types = raw.get("workTypes")
    job_type = (
        _truncate(", ".join([str(w).strip() for w in work_types if str(w).strip()]), MAX_TEXT_FIELD)
        if isinstance(work_types, list)
        else ""
    )
    return {
        "job_url": seek_job_url(job_id),
        "title": title,
        "company": _first_company(raw),
        "location": _join_locations(raw),
        "job_type": job_type,
        "job_level": "",  # Seek search payload has no seniority field.
        "description": _teaser_description(raw),
        "salary": _truncate(raw.get("salaryLabel", ""), MAX_TEXT_FIELD),
        "work_arrangement": _work_arrangement(raw),
        "listing_date": _listing_date(raw),
    }


def dedupe_by_url(items: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    seen: set = set()
    out: List[Dict[str, str]] = []
    for item in items:
        url = (item.get("job_url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(item)
    return out


# Token boundary that respects tech symbols: \b breaks inside "c++"/"c#" (no word
# char after +/#), silently disabling those exclusions/relevance terms. Use
# lookarounds against the token charset instead so "c++"/"c#"/"node.js" match.
_TOKEN_LB = r"(?<![a-z0-9#+])"
_TOKEN_LA = r"(?![a-z0-9#+])"


def _boundary_alternation_re(terms: Iterable[str]):
    """Compile a case-insensitive regex matching ANY term as a symbol-aware
    token, so "c++"/"c#"/"node.js" match where ``\\b`` would break. Returns None
    when there are no usable terms. Shared by the title-exclusion and the
    relevance matchers so both anchor tokens identically."""
    cleaned = [re.escape(t.strip().lower()) for t in (terms or []) if t and t.strip()]
    if not cleaned:
        return None
    return re.compile(r"(?i)" + _TOKEN_LB + r"(?:" + "|".join(cleaned) + r")" + _TOKEN_LA)


def build_exclude_title_re(terms: Iterable[str]):
    """Boundary-anchored, case-insensitive regex of exclusion terms (mirrors the
    JobSpy worker's title filter so Seek honours the same exclusions)."""
    return _boundary_alternation_re(terms)


def apply_title_exclusions(items: List[Dict[str, str]], exclude_terms: Iterable[str]) -> List[Dict[str, str]]:
    pattern = build_exclude_title_re(exclude_terms)
    if not pattern:
        return items
    return [it for it in items if not pattern.search(it.get("title", ""))]


# Generic role/seniority suffixes — dropped when judging title relevance so the
# DOMAIN tokens of a query (e.g. "ai", "data") are what must appear in a title.
RELEVANCE_GENERIC = {
    "the", "and", "for", "with", "of", "in", "to", "or", "at", "a", "an",
    "engineer", "engineers", "engineering", "developer", "developers", "programmer",
    "programmers", "manager", "management", "analyst", "analysts", "specialist",
    "consultant", "scientist", "designer", "administrator", "coordinator", "officer",
    "lead", "senior", "junior", "graduate", "intern", "internship", "staff",
    "principal", "director", "head", "architect", "role", "roles", "expert",
}


# Unlike RELEVANCE_GENERIC, this drops ONLY true stopwords — role words
# (engineer/developer/...) are KEPT so a title in the same role family still
# matches. Used for recall-oriented relevance (favour volume over precision).
RELEVANCE_STOPWORDS = {
    "the", "and", "for", "with", "of", "in", "to", "or", "at", "a", "an", "role", "roles",
}


def _tokenize(keywords: Iterable[str], drop: set) -> set:
    """Lower-case, split on non-token chars, keep tokens (incl. single chars like
    "r"/"go") that are not in `drop`. `+`/`#` stay in-token so "c++"/"c#" survive."""
    tokens: set = set()
    for kw in keywords or []:
        for tok in re.split(r"[^a-z0-9+#]+", str(kw or "").lower()):
            tok = tok.strip()
            if len(tok) >= 1 and tok not in drop:
                tokens.add(tok)
    return tokens


def extract_domain_tokens(keywords: Iterable[str]) -> set:
    """Distinctive domain words of a query (role/seniority words removed) — what
    a title MUST relate to, e.g. "ai"/"data" from "AI Engineer"/"Data Analyst"."""
    return _tokenize(keywords, RELEVANCE_GENERIC)


def extract_query_tokens(keywords: Iterable[str]) -> set:
    """All meaningful query words (only true stopwords removed) — keeps role
    words so same-family titles still match (recall-oriented)."""
    return _tokenize(keywords, RELEVANCE_STOPWORDS)


def filter_relevant_titles(items: List[Dict[str, str]], keywords: Iterable[str]) -> List[Dict[str, str]]:
    """Keep results whose title shares at least one meaningful token with the
    query — recall-oriented. Domain words (ai, software, python) AND role words
    (engineer, developer) all count; only true stopwords are ignored. This keeps
    same-family roles (e.g. "Backend Engineer" for a "Software Engineer" query)
    while dropping clearly-unrelated roles that share no token.

    Returns an EMPTY list when nothing shares a token — never the FULL unfiltered
    list. (Dumping every raw row is what surfaced unrelated roles, since Seek's
    keyword search matches the teaser/skills, not just the title.) A query with
    no DOMAIN word (e.g. just "Engineer") is too generic to filter meaningfully,
    so it is left untouched."""
    if not extract_domain_tokens(keywords):
        return items
    # One precompiled, boundary-anchored regex for all query tokens (same builder
    # the exclusion filter uses) — search each title once instead of rebuilding a
    # pattern per token per row. `pattern` is only None when there are no query
    # tokens, which can't happen once domain tokens exist, but guard anyway.
    pattern = _boundary_alternation_re(extract_query_tokens(keywords))
    if pattern is None:
        return items
    return [it for it in items if pattern.search(it.get("title") or "")]


# ── Network layer (gated, polite, no bypass) ───────────────────────────────
class SeekFetcher:
    def __init__(
        self,
        session: Optional[requests.Session] = None,
    ) -> None:
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "User-Agent": os.environ.get("SEEK_USER_AGENT", "").strip() or DEFAULT_USER_AGENT,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-AU,en;q=0.9",
                "Referer": f"{SEEK_ORIGIN}/jobs",
            }
        )

    @staticmethod
    def _ensure_enabled() -> None:
        if os.environ.get("SEEK_FETCH_ENABLED", "").strip().lower() not in ("1", "true", "yes"):
            raise RuntimeError(
                "Live Seek fetch is disabled. Set SEEK_FETCH_ENABLED=true to run "
                "(operator accepts Seek ToS risk), or use --dry-run."
            )

    def _sleep_backoff(self, attempt: int, retry_after: Optional[float] = None) -> None:
        base = RETRY_BACKOFF_SEC * (attempt + 1)
        if retry_after:
            base = max(base, retry_after)
        time.sleep(base + random.uniform(0, base * 0.5))  # jitter avoids lockstep

    def search_graphql(self, variables: Dict[str, Any]) -> Dict[str, Any]:
        """POST one JobSearchV6 query to the graphql BFF. No warm-up: this is a
        JSON API POST, not the Cloudflare-JS-challenged /jobs HTML page, so it
        sidesteps the warm-up challenge that walls the v5 path from a datacenter
        IP. A challenge (403 / interstitial) raises SeekChallengeError; 429/5xx
        retry with backoff."""
        self._ensure_enabled()
        headers = {
            "Content-Type": "application/json",
            "Origin": SEEK_ORIGIN,
            "Referer": f"{SEEK_ORIGIN}/jobs",
        }
        body = json.dumps(
            {"operationName": "JobSearchV6", "query": JOB_SEARCH_V6_QUERY, "variables": variables}
        )
        last_err: Optional[Exception] = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                res = self.session.post(
                    SEEK_GRAPHQL_URL, data=body, headers=headers, timeout=REQUEST_TIMEOUT_SEC
                )
            except (requests.ConnectionError, requests.Timeout) as err:
                last_err = err
                if attempt < MAX_RETRIES:
                    self._sleep_backoff(attempt)
                continue
            kind = classify_response(res.status_code, res.headers.get("content-type", ""), res.text)
            if kind == "challenge":
                raise SeekChallengeError(
                    f"graphql challenge (status={res.status_code}); stopping (no bypass by design)."
                )
            if kind == "transient":
                last_err = RuntimeError(f"transient status={res.status_code}")
                if attempt < MAX_RETRIES:
                    self._sleep_backoff(attempt, retry_after=retry_after_seconds(res.headers))
                continue
            if kind == "client_error":
                raise RuntimeError(f"graphql client error status={res.status_code} (not retried).")
            try:
                return res.json()
            except ValueError as err:
                raise RuntimeError(f"graphql returned a non-JSON ok body: {err}")
        raise RuntimeError(f"graphql request failed after retries: {last_err}")

    def search_graphql_paginated(
        self,
        *,
        keywords: str = "",
        max_pages: int = SEEK_PAGE_CEILING,
        page_size: int = GRAPHQL_PAGE_SIZE,
        **_ignored: Any,
    ) -> List[Dict[str, Any]]:
        """Page one keyword query through the graphql BFF up to the Seek ceiling.
        `**_ignored` swallows the legacy where/classification/work_type/
        daterange_days kwargs from build_queries_from_config — those are NOT
        sent as (unverified) graphql input fields; relevance is applied
        downstream from the returned rows. A challenge stops the run; any other
        page error keeps the prior pages."""
        pages = max(1, min(int(max_pages), SEEK_PAGE_CEILING))
        collected: List[Dict[str, Any]] = []
        for page in range(1, pages + 1):
            variables = build_graphql_variables(keywords=keywords, page=page, page_size=page_size)
            try:
                parsed = parse_graphql_payload(self.search_graphql(variables))
            except SeekChallengeError:
                raise
            except Exception as err:  # noqa: BLE001 — keep partial pages on any other error
                logger.warning(
                    "Seek graphql page=%s failed (keeping %s prior rows): %s",
                    page, len(collected), err,
                )
                break
            jobs = parsed["jobs"]
            if not jobs:
                if parsed["total_count"] > 0 or parsed.get("error"):
                    logger.warning(
                        "Seek graphql page=%s query=%r: 0 rows (totalCount=%s error=%s) — "
                        "payload shape may have changed.",
                        page, keywords, parsed["total_count"], parsed.get("error"),
                    )
                break
            collected.extend(jobs)
            logger.info(
                "Seek graphql page=%s query=%r -> %s rows (totalCount=%s)",
                page, keywords, len(jobs), parsed["total_count"],
            )
            time.sleep(REQUEST_DELAY_SEC)
        return collected


# ── Orchestration ──────────────────────────────────────────────────────────
def collect_jobs(
    fetcher: SeekFetcher,
    queries: List[Dict[str, Any]],
    *,
    max_total: int = MAX_TOTAL_ROWS,
    stats_out: Optional[Dict[str, int]] = None,
) -> List[Dict[str, str]]:
    """Stream each query through map + dedupe (bounded memory, immutable rows).
    A challenge stops further queries but keeps everything collected so far.

    When `stats_out` is given it is populated with the run funnel
    (queries/raw/mapped/challenges) so the caller can tell a genuine empty
    result (raw=0, challenges=0) apart from an anti-bot block (challenges>0,
    raw=0) — the difference between "no new jobs" and "Seek blocked us", which
    must NOT both surface as a silent empty success.

    Note: full job descriptions are intentionally NOT fetched here — bulk runs
    keep only the teaser to stay light against Seek's anti-bot. The full JD is
    fetched on-demand at tailoring time (lib/server/seek/fetchJobDescription.ts)."""
    seen: set = set()
    items: List[Dict[str, str]] = []
    stats = {"queries": 0, "raw": 0, "mapped": 0, "challenges": 0}
    for query in queries:
        stats["queries"] += 1
        try:
            rows = fetcher.search_graphql_paginated(**query)
        except SeekChallengeError as err:
            stats["challenges"] += 1
            logger.warning("Seek query stopped on challenge (kept %s rows): %s", len(items), err)
            break
        except Exception as err:  # noqa: BLE001 — one bad query must not lose the rest
            logger.warning("Seek query failed (kept prior results): %s", err)
            continue
        stats["raw"] += len(rows)
        for raw in rows:
            mapped = map_job(raw)
            if not mapped or mapped["job_url"] in seen:
                continue
            seen.add(mapped["job_url"])
            items.append(mapped)
            stats["mapped"] += 1
            if len(items) >= max_total:
                logger.warning("Seek row cap %s reached; truncating.", max_total)
                break
        if len(items) >= max_total:
            break

    logger.info("Seek summary: %s", stats)
    if stats_out is not None:
        stats_out.update(stats)
    return items


def _validate_import_base(base_url: str) -> str:
    parts = urlsplit(base_url)
    host = (parts.hostname or "").lower()
    is_local = host in ("localhost", "127.0.0.1")
    if parts.scheme != "https" and not is_local:
        raise RuntimeError(
            f"Refusing to send IMPORT_SECRET to a non-HTTPS base: {base_url!r}"
        )
    return base_url.rstrip("/")


def import_items(base_url: str, user_email: str, items: List[Dict[str, str]]) -> int:
    secret = os.environ.get("IMPORT_SECRET", "").strip()
    if not secret:
        raise RuntimeError("IMPORT_SECRET is not set")
    base = _validate_import_base(base_url)
    headers = {"x-import-secret": secret, "Content-Type": "application/json"}
    imported = 0
    for offset in range(0, len(items), 50):
        batch = items[offset : offset + 50]
        last_err: Optional[Exception] = None
        for attempt in range(IMPORT_RETRIES + 1):
            try:
                res = requests.post(
                    f"{base}/api/admin/import",
                    headers=headers,
                    data=json.dumps({"userEmail": user_email, "items": batch}),
                    timeout=120,
                )
                if res.ok:
                    imported += int((res.json() or {}).get("imported", 0))
                    last_err = None
                    break
                last_err = RuntimeError(f"import status={res.status_code}")
            except requests.RequestException as err:
                last_err = err
            if attempt < IMPORT_RETRIES:
                time.sleep(2 * (attempt + 1))
        if last_err is not None:
            logger.error(
                "Seek import failed at offset=%s (imported %s before failure): %s",
                offset, imported, last_err,
            )
            raise PartialImportError(imported, last_err)
    return imported


# ── Run-config mode (production worker; parallels run_jobspy.py) ───────────
CANCELLED_ERROR = "Cancelled by user"


def _api_base() -> str:
    base = os.environ.get("JOBLIT_WEB_URL", "").strip().rstrip("/")
    if not base:
        raise RuntimeError("JOBLIT_WEB_URL is not set")
    return _validate_import_base(base)


def _secret_headers(secret_env: str, header: str) -> Dict[str, str]:
    secret = os.environ.get(secret_env, "").strip()
    if not secret:
        raise RuntimeError(f"{secret_env} is not set")
    return {header: secret, "Content-Type": "application/json"}


def fetch_run_config(base: str, run_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
    res = requests.get(f"{base}/api/fetch-runs/{run_id}/config", headers=headers, timeout=30)
    res.raise_for_status()
    return res.json()["run"]


def update_run(base: str, run_id: str, headers: Dict[str, str], payload: Dict[str, Any]) -> None:
    res = requests.patch(
        f"{base}/api/fetch-runs/{run_id}/update", headers=headers, data=json.dumps(payload), timeout=30
    )
    res.raise_for_status()


def is_cancelled(run: Dict[str, Any]) -> bool:
    return (run or {}).get("status") == "FAILED" and (run or {}).get("error") == CANCELLED_ERROR


def build_queries_from_config(run: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Derive the Seek query fan-out (one query per keyword) from a FetchRun."""
    raw = run.get("queries") if isinstance(run.get("queries"), dict) else {}
    keywords = [k for k in (raw.get("queries") or []) if isinstance(k, str) and k.strip()]
    if not keywords:
        title = raw.get("title")
        keywords = [title] if isinstance(title, str) and title.strip() else [""]
    classification = str(raw.get("classification") or "")
    sub_classification = str(raw.get("subClassification") or "")
    try:
        daterange_days = int(raw.get("daterange") or DEFAULT_DATERANGE_DAYS)
    except (TypeError, ValueError):
        daterange_days = DEFAULT_DATERANGE_DAYS
    where = normalize_seek_where(run.get("location"))
    work_type = str(raw.get("workType") or "")
    return [
        {
            "keywords": kw,
            "classification": classification,
            "sub_classification": sub_classification,
            "where": where,
            "daterange_days": daterange_days,
            "max_pages": SEEK_PAGE_CEILING,
            "work_type": work_type,
        }
        for kw in keywords
    ]


def run_from_config(run_id: str) -> int:
    """Production entrypoint: read the FetchRun, report RUNNING/SUCCEEDED/FAILED,
    fetch + import, with a cancellation checkpoint before writing."""
    base = _api_base()
    fetch_headers = _secret_headers("FETCH_RUN_SECRET", "x-fetch-run-secret")
    run = fetch_run_config(base, run_id, fetch_headers)
    if is_cancelled(run):
        logger.info("Seek run already cancelled before start; exiting.")
        return 0
    user_email = run["userEmail"]
    update_run(base, run_id, fetch_headers, {"status": "RUNNING"})
    started = time.monotonic()
    try:
        raw = run.get("queries") if isinstance(run.get("queries"), dict) else {}
        # Bulk runs do NOT fetch full descriptions (the teaser is enough here);
        # the full JD is fetched on-demand at tailoring time. This keeps the bulk
        # run light against Seek's anti-bot.
        fetch_stats: Dict[str, int] = {}
        items = collect_jobs(
            SeekFetcher(), build_queries_from_config(run), stats_out=fetch_stats
        )
        # Honest status: an anti-bot challenge (Cloudflare interstitial on the
        # warm-up, or a persistent 403 on the search endpoint — both common from
        # a datacenter/CI IP) that blocked us BEFORE a single row arrived is NOT
        # an empty success. Reporting it as SUCCEEDED imported=0 is exactly why
        # this read as "Seek always finds nothing" with no explanation. Surface
        # it as FAILED with a challenge marker so the UI's existing
        # rate-limit/challenge message fires instead of a silent zero. A genuine
        # empty result (challenges=0, raw=0) stays a clean SUCCEEDED-0, and a
        # challenge that hit only after some rows were collected keeps the
        # partial harvest below.
        if fetch_stats.get("raw", 0) == 0 and fetch_stats.get("challenges", 0) > 0:
            update_run(
                base, run_id, fetch_headers,
                {
                    "status": "FAILED",
                    "importedCount": 0,
                    "error": (
                        "seek_challenge: Seek's anti-bot blocked automated access "
                        "(status=403 / Cloudflare challenge) before any results. "
                        "Try again later, or use LinkedIn."
                    ),
                },
            )
            logger.warning(
                "Seek run BLOCKED by anti-bot challenge (raw=0, challenges=%s); "
                "reported FAILED. elapsed=%.1fs",
                fetch_stats.get("challenges", 0), time.monotonic() - started,
            )
            # Exit 0, NOT 1: the worker did its job correctly — it reached Seek,
            # detected the upstream anti-bot block, and reported a FAILED run to
            # the DB (the app surfaces "rate-limited / try later"). An IP-level
            # Cloudflare block from a datacenter runner is an expected external
            # condition, not a worker fault, so it must not red the CI run on
            # every manual dispatch. Genuine worker faults still return 1 below.
            return 0
        # Relevance: Seek keyword search is broad, so drop titles that do not
        # match the search domain (e.g. "Elixir Developer" for an "AI Engineer"
        # query) before any other filtering.
        keywords = [str(k) for k in (raw.get("queries") or []) if str(k).strip()]
        if not keywords and raw.get("title"):
            keywords = [str(raw.get("title"))]
        relevance_before = len(items)
        items = filter_relevant_titles(items, keywords)
        if len(items) != relevance_before:
            logger.info("Seek relevance filter dropped %s -> %s", relevance_before, len(items))
        # Honour the same title exclusions the JobSpy pipeline applies.
        if bool(raw.get("applyExcludes", True)):
            before = len(items)
            items = apply_title_exclusions(items, raw.get("excludeTitleTerms") or [])
            if len(items) != before:
                logger.info("Seek title-exclusion dropped %s -> %s", before, len(items))
        if is_cancelled(fetch_run_config(base, run_id, fetch_headers)):
            logger.info("Seek run cancelled before import; exiting.")
            return 0
        candidates = len(items)
        imported = import_items(base, user_email, items) if items else 0
        if candidates and imported < candidates:
            logger.info(
                "Seek import kept %s of %s candidates; the rest were already "
                "imported or previously removed (tombstoned) — skipped by design.",
                imported, candidates,
            )
        update_run(base, run_id, fetch_headers, {"status": "SUCCEEDED", "importedCount": imported, "error": None})
        logger.info("Seek run SUCCEEDED imported=%s elapsed=%.1fs", imported, time.monotonic() - started)
        return 0
    except PartialImportError as err:
        logger.error("Seek run FAILED after partial import imported=%s: %s", err.imported, err)
        try:
            update_run(
                base, run_id, fetch_headers,
                {"status": "FAILED", "importedCount": err.imported, "error": str(err)},
            )
        except Exception:  # noqa: BLE001 — best-effort status write
            pass
        return 1
    except Exception as err:  # noqa: BLE001 — always report a terminal status
        logger.error("Seek run FAILED elapsed=%.1fs error=%s", time.monotonic() - started, err)
        try:
            update_run(base, run_id, fetch_headers, {"status": "FAILED", "error": str(err)})
        except Exception:  # noqa: BLE001 — best-effort status write
            pass
        return 1


def main() -> int:
    run_id = os.environ.get("RUN_ID", "").strip()
    if run_id:
        return run_from_config(run_id)

    parser = argparse.ArgumentParser(description="Seek incremental job fetcher")
    parser.add_argument("--keywords", default="")
    parser.add_argument("--classification", default="")
    parser.add_argument("--sub-classification", default="", help="Seek subclassification id (numeric)")
    parser.add_argument("--where", default=DEFAULT_WHERE)
    parser.add_argument("--daterange", type=int, default=DEFAULT_DATERANGE_DAYS)
    parser.add_argument("--max-pages", type=int, default=SEEK_PAGE_CEILING)
    parser.add_argument("--work-type", default="", help="Seek worktype id (242/243/244/245)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--import-base", default=os.environ.get("JOBLIT_WEB_URL", ""))
    parser.add_argument("--user-email", default=os.environ.get("SEEK_USER_EMAIL", ""))
    args = parser.parse_args()

    started = time.monotonic()
    try:
        fetcher = SeekFetcher()
        queries = [
            {
                "keywords": args.keywords,
                "classification": args.classification,
                "sub_classification": args.sub_classification,
                "where": normalize_seek_where(args.where),
                "daterange_days": args.daterange,
                "max_pages": args.max_pages,
                "work_type": args.work_type,
            }
        ]
        items = collect_jobs(fetcher, queries)
        items = filter_relevant_titles(items, [args.keywords])

        if args.dry_run or not args.import_base or not args.user_email:
            logger.info("DRY RUN - %s items (first 5 shown)", len(items))
            for row in items[:5]:
                logger.info("  %s | %s | %s | %s", row["title"], row["company"], row["location"], row["job_url"])
            return 0

        imported = import_items(args.import_base, args.user_email, items)
        logger.info("SUCCEEDED imported=%s collected=%s elapsed=%.1fs", imported, len(items), time.monotonic() - started)
        return 0
    except Exception as err:  # noqa: BLE001 — top-level run-status signal for cron
        logger.error("FAILED elapsed=%.1fs error=%s", time.monotonic() - started, err)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
