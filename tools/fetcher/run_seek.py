"""Seek (au.seek.com) incremental job fetcher — runs parallel to run_jobspy.py.

LEGAL / TERMS OF SERVICE NOTICE
------------------------------
Seek's Terms of Use (au.seek.com/terms, clauses 7(d), 9(b), 9(d)) prohibit
automated data gathering and circumventing anti-bot measures. This worker is
DELIBERATELY the mild variant:

  * It calls the same public JSON endpoint (`/api/jobsearch/v5/search`) that
    au.seek.com serves to ordinary clients.
  * It uses only the `__cf_bm` cookie Seek freely hands out on a normal page
    load — it does NOT solve Cloudflare challenges, spoof TLS/JA3 fingerprints,
    or rotate residential proxies.
  * On any anti-bot challenge it re-warms ONCE and then STOPS the run, rather
    than attempting to bypass the measure.
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
from html import unescape
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.parse import urlsplit

import requests

logging.basicConfig(
    level=logging.INFO, format="[%(asctime)s] %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("seek_runner")

# ── Endpoints ──────────────────────────────────────────────────────────────
SEEK_HOST = "au.seek.com"
SEEK_ORIGIN = f"https://{SEEK_HOST}"
SEEK_WARMUP_URL = f"{SEEK_ORIGIN}/jobs"
SEEK_SEARCH_URL = f"{SEEK_ORIGIN}/api/jobsearch/v5/search"
SEEK_JOB_URL_TEMPLATE = f"{SEEK_ORIGIN}/job/{{job_id}}"

# ── Search params ──────────────────────────────────────────────────────────
DEFAULT_SITE_KEY = "AU-Main"
DEFAULT_SOURCE_SYSTEM = "houston"
DEFAULT_WHERE = "All Australia"
DEFAULT_PAGE_SIZE = 100  # Seek serves up to 100 per page.
SEEK_PAGE_CEILING = 5  # Seek hard-caps any search at ~500 results = 5 pages x 100.
# Default to a 2-day window so a missed/late cron run does not silently drop a
# day of postings; downstream (userId, jobUrl) dedupe absorbs the overlap.
DEFAULT_DATERANGE_DAYS = 2

# ── Politeness / resilience ────────────────────────────────────────────────
REQUEST_DELAY_SEC = 1.2
WARMUP_DELAY_SEC = 0.8
REQUEST_TIMEOUT_SEC = 25.0
MAX_RETRIES = 2
RETRY_BACKOFF_SEC = 3.0
RETRY_AFTER_CAP_SEC = 60.0
IMPORT_RETRIES = 2
# __cf_bm clearance lives ~30 min; re-warm well before it lapses.
WARM_TTL_SEC = 25 * 60

# ── Defensive bounds (untrusted external data) ─────────────────────────────
MAX_TITLE = 512
MAX_TEXT_FIELD = 256
MAX_DESCRIPTION = 50_000
MAX_JSONLD_BYTES = 2_000_000
MAX_RECURSION_DEPTH = 24
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
    design (after one re-warm) rather than circumventing the measure."""


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


def build_search_params(
    *,
    keywords: str = "",
    classification: str = "",
    where: str = DEFAULT_WHERE,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
    daterange_days: Optional[int] = DEFAULT_DATERANGE_DAYS,
) -> Dict[str, str]:
    params: Dict[str, str] = {
        "siteKey": DEFAULT_SITE_KEY,
        "sourcesystem": DEFAULT_SOURCE_SYSTEM,
        "where": where,
        "page": str(page),
        "pageSize": str(page_size),
    }
    if keywords.strip():
        params["keywords"] = keywords.strip()
    if str(classification).strip():
        params["classification"] = str(classification).strip()
    if daterange_days and daterange_days > 0:
        params["daterange"] = str(daterange_days)
    return params


def classify_response(status_code: int, content_type: str, body: str) -> str:
    """Triage a response into: ok | challenge | transient | client_error.

    challenge  -> Cloudflare interstitial or 403: re-warm once then stop.
    transient  -> 429/5xx: retry with backoff (+ Retry-After if given).
    client_error -> other 4xx / non-JSON 2xx mismatch: fail fast, no retry.
    """
    text = (body or "")[:2000].lower()
    if any(n in text for n in CHALLENGE_NEEDLES):
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


def parse_search_payload(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {"total_count": 0, "jobs": []}
    jobs = payload.get("data")
    return {
        "total_count": int(payload.get("totalCount") or 0),
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
    labels = [str(l.get("label", "")).strip() for l in locs if isinstance(l, dict)]
    return _truncate(", ".join([l for l in labels if l]), MAX_TEXT_FIELD)


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


def _find_description(payload: Any, depth: int = 0) -> str:
    if depth > MAX_RECURSION_DEPTH:
        return ""
    if isinstance(payload, dict):
        desc = payload.get("description")
        if isinstance(desc, str) and desc.strip():
            return desc
        for value in payload.values():
            nested = _find_description(value, depth + 1)
            if nested:
                return nested
    elif isinstance(payload, list):
        for item in payload:
            nested = _find_description(item, depth + 1)
            if nested:
                return nested
    return ""


def _clean_html(text: str) -> str:
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text or "")
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def extract_jsonld_description(html_text: str) -> str:
    """Pull the JobPosting description from a job page's JSON-LD (size-bounded)."""
    if not html_text:
        return ""
    html_text = html_text[:MAX_JSONLD_BYTES]
    for snippet in re.findall(
        r'(?is)<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html_text,
    ):
        try:
            payload = json.loads(snippet.strip())
        except (ValueError, RecursionError):
            continue
        found = _find_description(payload)
        if found:
            return _truncate(_clean_html(found), MAX_DESCRIPTION)
    return ""


# ── Network layer (gated, polite, no bypass) ───────────────────────────────
class SeekFetcher:
    def __init__(
        self,
        session: Optional[requests.Session] = None,
        clock: Optional[Callable[[], float]] = None,
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
        self._clock = clock or time.monotonic
        self._warmed_at: Optional[float] = None

    @staticmethod
    def _ensure_enabled() -> None:
        if os.environ.get("SEEK_FETCH_ENABLED", "").strip().lower() not in ("1", "true", "yes"):
            raise RuntimeError(
                "Live Seek fetch is disabled. Set SEEK_FETCH_ENABLED=true to run "
                "(operator accepts Seek ToS risk), or use --dry-run."
            )

    def _needs_warm(self) -> bool:
        return self._warmed_at is None or (self._clock() - self._warmed_at) > WARM_TTL_SEC

    def _sleep_backoff(self, attempt: int, retry_after: Optional[float] = None) -> None:
        base = RETRY_BACKOFF_SEC * (attempt + 1)
        if retry_after:
            base = max(base, retry_after)
        time.sleep(base + random.uniform(0, base * 0.5))  # jitter avoids lockstep

    def warm_up(self) -> None:
        """Load a normal page so Seek issues the __cf_bm clearance cookie."""
        self._ensure_enabled()
        res = self.session.get(SEEK_WARMUP_URL, timeout=REQUEST_TIMEOUT_SEC)
        if classify_response(res.status_code, res.headers.get("content-type", ""), res.text) == "challenge":
            raise SeekChallengeError("Challenged on warm-up; stopping (no bypass by design).")
        self._warmed_at = self._clock()
        time.sleep(WARMUP_DELAY_SEC)

    def _get_json(self, url: str, params: Dict[str, str]) -> Dict[str, Any]:
        self._ensure_enabled()
        if self._needs_warm():
            self.warm_up()
        rewarmed = False
        last_err: Optional[Exception] = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                res = self.session.get(url, params=params, timeout=REQUEST_TIMEOUT_SEC)
            except (requests.ConnectionError, requests.Timeout) as err:
                last_err = err
                self._sleep_backoff(attempt)
                continue
            kind = classify_response(res.status_code, res.headers.get("content-type", ""), res.text)
            if kind == "ok":
                try:
                    return res.json()
                except ValueError as err:
                    raise RuntimeError(f"Seek returned a non-JSON ok body: {err}")
            if kind == "challenge":
                if not rewarmed:
                    rewarmed = True
                    logger.info("Anti-bot challenge — re-warming once before giving up.")
                    self._warmed_at = None
                    self.warm_up()
                    continue
                raise SeekChallengeError(
                    f"Challenge persisted after re-warm (status={res.status_code}); stopping."
                )
            if kind == "transient":
                last_err = RuntimeError(f"transient status={res.status_code}")
                if attempt < MAX_RETRIES:
                    self._sleep_backoff(attempt, retry_after=retry_after_seconds(res.headers))
                continue
            raise RuntimeError(f"Seek client error status={res.status_code} (not retried).")
        raise RuntimeError(f"Seek request failed after retries: {last_err}")

    def search_paginated(
        self,
        *,
        keywords: str = "",
        classification: str = "",
        where: str = DEFAULT_WHERE,
        daterange_days: Optional[int] = DEFAULT_DATERANGE_DAYS,
        max_pages: int = SEEK_PAGE_CEILING,
        page_size: int = DEFAULT_PAGE_SIZE,
    ) -> List[Dict[str, Any]]:
        """Page through one query up to the Seek 5-page / ~500-result ceiling.
        A challenge stops the run; any other page error keeps the prior pages."""
        pages = max(1, min(int(max_pages), SEEK_PAGE_CEILING))
        collected: List[Dict[str, Any]] = []
        for page in range(1, pages + 1):
            params = build_search_params(
                keywords=keywords,
                classification=classification,
                where=where,
                page=page,
                page_size=page_size,
                daterange_days=daterange_days,
            )
            try:
                parsed = parse_search_payload(self._get_json(SEEK_SEARCH_URL, params))
            except SeekChallengeError:
                raise  # ToS-mild: stop the whole run on a challenge
            except Exception as err:  # noqa: BLE001 — keep partial pages on any other error
                logger.warning(
                    "Seek page=%s failed (keeping %s prior rows): %s", page, len(collected), err
                )
                break
            jobs = parsed["jobs"]
            if not jobs:
                break  # past the result ceiling for this query
            collected.extend(jobs)
            logger.info(
                "Seek page=%s query=%r class=%s -> %s rows (totalCount=%s)",
                page, keywords, classification or "-", len(jobs), parsed["total_count"],
            )
            time.sleep(REQUEST_DELAY_SEC)
        return collected

    def enrich_description(self, job_url: str) -> str:
        """Fetch a job page and extract its JSON-LD description. SSRF-guarded:
        only fetches au.seek.com URLs; returns "" on any challenge/error."""
        if not is_seek_host(job_url):
            logger.warning("enrich skipped non-Seek url: %s", job_url)
            return ""
        try:
            self._ensure_enabled()
            if self._needs_warm():
                self.warm_up()
            res = self.session.get(job_url, timeout=REQUEST_TIMEOUT_SEC)
            kind = classify_response(res.status_code, res.headers.get("content-type", ""), res.text)
            return extract_jsonld_description(res.text) if kind == "ok" else ""
        except (requests.RequestException, SeekChallengeError) as err:
            logger.warning("enrich failed url=%s err=%s", job_url, err)
            return ""
        finally:
            time.sleep(REQUEST_DELAY_SEC)


# ── Orchestration ──────────────────────────────────────────────────────────
def collect_jobs(
    fetcher: SeekFetcher,
    queries: List[Dict[str, Any]],
    *,
    enrich: bool = False,
    max_total: int = MAX_TOTAL_ROWS,
) -> List[Dict[str, str]]:
    """Stream each query through map + dedupe (bounded memory, immutable rows).
    A challenge stops further queries but keeps everything collected so far."""
    seen: set = set()
    items: List[Dict[str, str]] = []
    stats = {"queries": 0, "raw": 0, "mapped": 0, "challenges": 0, "enrich_ok": 0, "enrich_fail": 0}
    for query in queries:
        stats["queries"] += 1
        try:
            rows = fetcher.search_paginated(**query)
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

    if enrich:
        enriched: List[Dict[str, str]] = []
        for row in items:
            if row.get("description"):
                enriched.append(row)
                continue
            description = fetcher.enrich_description(row["job_url"])
            stats["enrich_ok" if description else "enrich_fail"] += 1
            enriched.append({**row, "description": description})  # new dict — no mutation
        items = enriched

    logger.info("Seek summary: %s", stats)
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
            raise last_err
    return imported


def main() -> int:
    parser = argparse.ArgumentParser(description="Seek incremental job fetcher")
    parser.add_argument("--keywords", default="")
    parser.add_argument("--classification", default="")
    parser.add_argument("--where", default=DEFAULT_WHERE)
    parser.add_argument("--daterange", type=int, default=DEFAULT_DATERANGE_DAYS)
    parser.add_argument("--max-pages", type=int, default=SEEK_PAGE_CEILING)
    parser.add_argument("--enrich", action="store_true")
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
                "where": args.where,
                "daterange_days": args.daterange,
                "max_pages": args.max_pages,
            }
        ]
        items = collect_jobs(fetcher, queries, enrich=args.enrich)

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
