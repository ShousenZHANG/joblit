"""Seek (au.seek.com) incremental job fetcher — runs parallel to run_jobspy.py.

LEGAL / TERMS OF SERVICE NOTICE
------------------------------
Seek's Terms of Use (au.seek.com/terms, clauses 7(d), 9(b), 9(d)) prohibit
automated data gathering and circumventing anti-bot measures. This worker is
DELIBERATELY the mild variant:

  * It calls the same public JSON endpoint (`/api/jobsearch/v5/search`) that
    au.seek.com serves to ordinary browsers.
  * It uses only the `__cf_bm` cookie Seek freely hands out on a normal page
    load — it does NOT solve Cloudflare challenges, spoof TLS/JA3 fingerprints,
    or rotate residential proxies.
  * If Seek returns a challenge / non-JSON / 403, the worker STOPS that run
    instead of attempting to bypass the measure.

Running this against Seek is the operator's own risk decision. Live network
calls are gated behind the env flag `SEEK_FETCH_ENABLED=true`; without it the
worker refuses to hit Seek and only runs in offline/dry modes. Prefer the
managed path (Apify) if you do not want this risk on a public-facing brand.
"""

import os
import re
import json
import time
import logging
import argparse
from html import unescape
from typing import Any, Dict, Iterable, List, Optional

import requests

logging.basicConfig(
    level=logging.INFO, format="[%(asctime)s] %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("seek_runner")

# ── Constants ──────────────────────────────────────────────────────────────
SEEK_ORIGIN = "https://au.seek.com"
SEEK_WARMUP_URL = f"{SEEK_ORIGIN}/jobs"
SEEK_SEARCH_URL = f"{SEEK_ORIGIN}/api/jobsearch/v5/search"
SEEK_JOB_URL_TEMPLATE = f"{SEEK_ORIGIN}/job/{{job_id}}"

DEFAULT_SITE_KEY = "AU-Main"
DEFAULT_SOURCE_SYSTEM = "houston"
DEFAULT_WHERE = "All Australia"
DEFAULT_PAGE_SIZE = 100  # Seek serves up to 100 per page.
SEEK_PAGE_CEILING = 5  # Seek hard-caps any search at ~500 results = 5 pages x 100.
DEFAULT_DATERANGE_DAYS = 1  # Incremental default: only the last day's postings.

# Polite pacing — this is NOT a stealth knob, it keeps load off Seek.
REQUEST_DELAY_SEC = 1.2
WARMUP_DELAY_SEC = 0.8
REQUEST_TIMEOUT_SEC = 25.0
MAX_RETRIES = 2
RETRY_BACKOFF_SEC = 3.0

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


class SeekChallengeError(RuntimeError):
    """Raised when Seek returns an anti-bot challenge. The worker stops here by
    design rather than attempting to circumvent the measure."""


# ── Pure helpers (network-free, unit-tested) ───────────────────────────────
def seek_job_url(job_id: Any) -> str:
    return SEEK_JOB_URL_TEMPLATE.format(job_id=job_id)


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


def is_challenge_response(status_code: int, content_type: str, body: str) -> bool:
    """Detect a Cloudflare/anti-bot interstitial. We treat these as a hard stop."""
    if status_code in (403, 429, 503):
        return True
    ct = (content_type or "").lower()
    if "application/json" in ct:
        return False
    text = (body or "")[:2000].lower()
    needles = ("just a moment", "challenges.cloudflare.com", "cf-mitigated", "attention required")
    return any(n in text for n in needles)


def parse_search_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Normalise the v5 search envelope into {total_count, jobs}."""
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
        return name.strip()
    advertiser = raw.get("advertiser")
    if isinstance(advertiser, dict):
        desc = advertiser.get("description")
        if isinstance(desc, str):
            return desc.strip()
    return ""


def _join_locations(raw: Dict[str, Any]) -> str:
    locs = raw.get("locations")
    if not isinstance(locs, list):
        return ""
    labels = [str(l.get("label", "")).strip() for l in locs if isinstance(l, dict)]
    return ", ".join([l for l in labels if l])


def _teaser_description(raw: Dict[str, Any]) -> str:
    """Best-effort short description from search-result fields (full text needs a
    per-job detail fetch via enrich_description)."""
    parts: List[str] = []
    teaser = raw.get("teaser")
    if isinstance(teaser, str) and teaser.strip():
        parts.append(teaser.strip())
    bullets = raw.get("bulletPoints")
    if isinstance(bullets, list):
        for b in bullets:
            if isinstance(b, str) and b.strip():
                parts.append(f"- {b.strip()}")
    return "\n".join(parts)


def map_job(raw: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """Map one Seek v5 result to Joblit's /api/admin/import row schema."""
    if not isinstance(raw, dict):
        return None
    job_id = raw.get("id")
    title = str(raw.get("title", "") or "").strip()
    if not job_id or not title:
        return None
    work_types = raw.get("workTypes")
    job_type = (
        ", ".join([str(w).strip() for w in work_types if str(w).strip()])
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


def extract_jsonld_description(html_text: str) -> str:
    """Pull the JobPosting description from a Seek job page's JSON-LD."""
    if not html_text:
        return ""
    for snippet in re.findall(
        r'(?is)<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html_text,
    ):
        try:
            payload = json.loads(snippet.strip())
        except Exception:
            continue
        found = _find_description(payload)
        if found:
            return _clean_html(found)
    return ""


def _find_description(payload: Any) -> str:
    if isinstance(payload, dict):
        desc = payload.get("description")
        if isinstance(desc, str) and desc.strip():
            return desc
        for value in payload.values():
            nested = _find_description(value)
            if nested:
                return nested
    elif isinstance(payload, list):
        for item in payload:
            nested = _find_description(item)
            if nested:
                return nested
    return ""


def _clean_html(text: str) -> str:
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text or "")
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ── Network layer (gated, polite, no bypass) ───────────────────────────────
class SeekFetcher:
    def __init__(self, session: Optional[requests.Session] = None) -> None:
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-AU,en;q=0.9",
                "Referer": f"{SEEK_ORIGIN}/jobs",
            }
        )
        self._warmed = False

    @staticmethod
    def _ensure_enabled() -> None:
        if os.environ.get("SEEK_FETCH_ENABLED", "").strip().lower() not in ("1", "true", "yes"):
            raise RuntimeError(
                "Live Seek fetch is disabled. Set SEEK_FETCH_ENABLED=true to run "
                "(operator accepts Seek ToS risk), or use --dry-run."
            )

    def warm_up(self) -> None:
        """Load a normal page so Seek issues the __cf_bm clearance cookie."""
        self._ensure_enabled()
        res = self.session.get(SEEK_WARMUP_URL, timeout=REQUEST_TIMEOUT_SEC)
        if is_challenge_response(res.status_code, res.headers.get("content-type", ""), res.text):
            raise SeekChallengeError("Challenged on warm-up; stopping (no bypass by design).")
        self._warmed = True
        time.sleep(WARMUP_DELAY_SEC)

    def _get_json(self, url: str, params: Dict[str, str]) -> Dict[str, Any]:
        self._ensure_enabled()
        if not self._warmed:
            self.warm_up()
        last_err: Optional[Exception] = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                res = self.session.get(url, params=params, timeout=REQUEST_TIMEOUT_SEC)
                ct = res.headers.get("content-type", "")
                if is_challenge_response(res.status_code, ct, res.text):
                    raise SeekChallengeError(
                        f"Anti-bot challenge (status={res.status_code}); stopping by design."
                    )
                res.raise_for_status()
                return res.json()
            except SeekChallengeError:
                raise  # never retry/bypass a challenge
            except Exception as err:  # noqa: BLE001
                last_err = err
                if attempt >= MAX_RETRIES:
                    break
                time.sleep(RETRY_BACKOFF_SEC * (attempt + 1))
        raise RuntimeError(f"Seek request failed: {last_err}")

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
        """Page through one query up to the Seek 5-page / ~500-result ceiling."""
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
            parsed = parse_search_payload(self._get_json(SEEK_SEARCH_URL, params))
            jobs = parsed["jobs"]
            if not jobs:
                break  # past the result ceiling for this query
            collected.extend(jobs)
            logger.info(
                "Seek page=%s query=%r class=%s -> %s rows (totalCount=%s)",
                page,
                keywords,
                classification or "-",
                len(jobs),
                parsed["total_count"],
            )
            time.sleep(REQUEST_DELAY_SEC)
        return collected

    def enrich_description(self, job_url: str) -> str:
        """Fetch a job page and extract the full JSON-LD description (optional)."""
        try:
            res = self.session.get(job_url, timeout=REQUEST_TIMEOUT_SEC)
            if is_challenge_response(res.status_code, res.headers.get("content-type", ""), res.text):
                return ""
            return extract_jsonld_description(res.text)
        except Exception as err:  # noqa: BLE001
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
) -> List[Dict[str, str]]:
    """Run each query, map + dedupe, optionally enrich descriptions."""
    raw_rows: List[Dict[str, Any]] = []
    for q in queries:
        raw_rows.extend(fetcher.search_paginated(**q))
    mapped = [m for m in (map_job(r) for r in raw_rows) if m]
    deduped = dedupe_by_url(mapped)
    if enrich:
        for row in deduped:
            if not row.get("description"):
                row["description"] = fetcher.enrich_description(row["job_url"])
    logger.info("Seek collected raw=%s mapped/deduped=%s", len(raw_rows), len(deduped))
    return deduped


def import_items(base_url: str, user_email: str, items: List[Dict[str, str]]) -> int:
    secret = os.environ.get("IMPORT_SECRET", "").strip()
    if not secret:
        raise RuntimeError("IMPORT_SECRET is not set")
    imported = 0
    headers = {"x-import-secret": secret, "Content-Type": "application/json"}
    for i in range(0, len(items), 50):
        batch = items[i : i + 50]
        res = requests.post(
            f"{base_url.rstrip('/')}/api/admin/import",
            headers=headers,
            data=json.dumps({"userEmail": user_email, "items": batch}),
            timeout=120,
        )
        res.raise_for_status()
        imported += int(res.json().get("imported", 0))
    return imported


def main() -> None:
    parser = argparse.ArgumentParser(description="Seek incremental job fetcher")
    parser.add_argument("--keywords", default="", help="Search keywords")
    parser.add_argument("--classification", default="", help="Seek classification id")
    parser.add_argument("--where", default=DEFAULT_WHERE)
    parser.add_argument("--daterange", type=int, default=DEFAULT_DATERANGE_DAYS,
                        help="Only postings from the last N days (incremental)")
    parser.add_argument("--max-pages", type=int, default=SEEK_PAGE_CEILING)
    parser.add_argument("--enrich", action="store_true", help="Fetch full descriptions")
    parser.add_argument("--dry-run", action="store_true", help="Print rows, do not import")
    parser.add_argument("--import-base", default=os.environ.get("JOBLIT_WEB_URL", ""))
    parser.add_argument("--user-email", default=os.environ.get("SEEK_USER_EMAIL", ""))
    args = parser.parse_args()

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
        logger.info("DRY RUN — %s items (first 5 shown)", len(items))
        for row in items[:5]:
            logger.info("  %s | %s | %s | %s", row["title"], row["company"], row["location"], row["job_url"])
        return

    imported = import_items(args.import_base, args.user_email, items)
    logger.info("Imported %s Seek jobs", imported)


if __name__ == "__main__":
    main()
