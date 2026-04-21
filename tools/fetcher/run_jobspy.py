import os
import re
import json
import sys
import time
import math
import random
import logging
from html import unescape
from urllib.parse import urlsplit, urlunsplit, parse_qs
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

import requests
import pandas as pd
from jobspy import scrape_jobs

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(name)s: %(message)s')
logger = logging.getLogger("jobspy_runner")

SCRAPE_RETRIES = 2
SCRAPE_BACKOFF_SEC = 2
IMPORT_RETRIES = 2
DEFAULT_FETCH_QUERY_CONCURRENCY = 2
MAX_FETCH_QUERY_CONCURRENCY = 6
DEFAULT_RATE_LIMIT_RETRIES = 5
DEFAULT_RATE_LIMIT_BASE_SEC = 15.0
DEFAULT_RATE_LIMIT_MAX_SEC = 120.0
DEFAULT_RATE_LIMIT_COOLDOWN_SEC = 20.0
DEFAULT_FULL_FETCH_RESULTS_WANTED = 10000
DEFAULT_DETAIL_URL_WORKERS = 4
MAX_DETAIL_URL_WORKERS = 8
DEFAULT_DETAIL_URL_TIMEOUT_SEC = 12.0
DEFAULT_DETAIL_URL_RETRIES = 2
DEFAULT_DETAIL_URL_BACKOFF_BASE_SEC = 1.5

LINKEDIN_JOB_ID_RE = re.compile(r"linkedin\.com/jobs/view/(\d+)", re.IGNORECASE)

CANCELLED_ERROR = "Cancelled by user"

TITLE_EXCLUDE_PAT = re.compile(r'(?i)\b(?:senior|sr\.?|lead|principal|architect|manager|head|director|staff)\b')

EXCLUDE_RIGHTS_RE = re.compile(
    r'(?i)\b(?:'
    r'permanent\s+resident|permanent\s+residency|PR\s*(?:only|required)?|'
    r'citizen|citizenship|australian\s+citizen|au\s+citizen|nz\s+citizen'
    r')\b'
)

EXCLUDE_CLEARANCE_RE = re.compile(
    r'(?i)\b(?:baseline\s+clearance|NV1|NV2|security\s+clearance)\b'
)

EXCLUDE_SPONSORSHIP_RE = re.compile(
    r'(?i)\b(?:'
    r'sponsorship\s+not\s+available|'
    r'sponsorship\s+unavailable|'
    r'no\s+sponsorship|'
    r'no\s+visa\s+sponsorship|'
    r'will\s+not\s+sponsor|'
    r'cannot\s+sponsor|'
    r'unable\s+to\s+sponsor|'
    r'not\s+able\s+to\s+sponsor'
    r')\b'
)

HARD_CLEARANCE_RE = re.compile(
    r'(?i)\b(?:baseline\s+clearance|NV1|NV2|security\s+clearance)\b'
    r'(?:(?:[^.]{0,40})\b(?:required|must\s+have|mandatory|only)\b)'
)

SOFT_CLEARANCE_RE = re.compile(
    r'(?i)\b(?:baseline\s+clearance|NV1|NV2|security\s+clearance)\b'
    r'(?:(?:[^.]{0,40})\b(?:preferred|nice\s+to\s+have|bonus|a\s+plus)\b)'
)

HARD_RIGHTS_RE = re.compile(
    r'(?i)\b(?:required|must\s+have|must\s+be|mandatory|only)\b'
    r'(?:(?:[^.]{0,40})\b(?:'
    r'(?:australian\s+)?citizen(?:ship)?|'
    r'(?:permanent\s+resident|permanent\s+residency|PR)|'
    r'(?:nz\s+citizen|new\s+zealand\s+citizen)'
    r')\b)'
    r'|'
    r'\b(?:'
    r'(?:australian\s+)?citizen(?:ship)?|'
    r'(?:permanent\s+resident|permanent\s+residency|PR)|'
    r'(?:nz\s+citizen|new\s+zealand\s+citizen)'
    r')\b'
    r'(?:(?:[^.]{0,40})\b(?:required|must\s+have|must\s+be|mandatory|only)\b)'
)

SOFT_RIGHTS_RE = re.compile(
    r'(?i)\b(?:'
    r'(?:citizen|citizenship|permanent\s+resident|permanent\s+residency|PR|nz\s+citizen|new\s+zealand\s+citizen)'
    r')\b'
    r'(?:(?:[^.]{0,40})\b(?:welcome|eligible|encouraged)\b)'
)


def _build_query_phrases(queries: List[str]) -> List[str]:
    phrases: List[str] = []
    for q in queries or []:
        q2 = _normalize_text((q or "").strip().strip('"').strip("'"))
        if q2:
            phrases.append(q2.lower())
    return phrases


def _resolve_search_terms(title_query: str, queries: List[str]) -> List[str]:
    candidates = [*(queries or []), title_query]
    out: List[str] = []
    seen = set()
    for item in candidates:
        cleaned = (item or "").strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out


def _results_per_query(total_results: int, query_count: int) -> int:
    if query_count <= 0:
        return max(1, int(total_results or 1))
    base = max(1, int(total_results or 1))
    return max(1, math.ceil(base / query_count))


def _build_results_budget_by_term(search_terms: List[str], total_results: int) -> Dict[str, int]:
    cleaned = [term.strip() for term in search_terms if term and term.strip()]
    if not cleaned:
        return {}

    total = max(1, int(total_results or 1))
    # "All results" mode: each query gets full results_wanted budget.
    return {term: total for term in cleaned}


def _resolve_fetch_query_workers(query_count: int) -> int:
    if query_count <= 1:
        return 1
    raw = os.environ.get("FETCH_QUERY_CONCURRENCY", "").strip()
    try:
        configured = int(raw) if raw else DEFAULT_FETCH_QUERY_CONCURRENCY
    except ValueError:
        configured = DEFAULT_FETCH_QUERY_CONCURRENCY
    configured = max(1, min(MAX_FETCH_QUERY_CONCURRENCY, configured))
    return min(query_count, configured)


def _is_rate_limited_error(err: Exception) -> bool:
    msg = str(err).lower()
    return " 429 " in f" {msg} " or "too many 429" in msg or "rate limit" in msg


def _retry_sleep_seconds(err: Exception, attempt: int) -> float:
    # For rate-limit errors we back off aggressively with jitter.
    if _is_rate_limited_error(err):
        raw_base = os.environ.get("FETCH_RATE_LIMIT_BASE_SEC", "").strip()
        raw_max = os.environ.get("FETCH_RATE_LIMIT_MAX_SEC", "").strip()
        try:
            base = float(raw_base) if raw_base else DEFAULT_RATE_LIMIT_BASE_SEC
        except ValueError:
            base = DEFAULT_RATE_LIMIT_BASE_SEC
        try:
            max_sec = float(raw_max) if raw_max else DEFAULT_RATE_LIMIT_MAX_SEC
        except ValueError:
            max_sec = DEFAULT_RATE_LIMIT_MAX_SEC
        sleep_sec = min(max_sec, base * (2**attempt))
        return sleep_sec + random.uniform(0, min(3.0, sleep_sec * 0.2))
    sleep_sec = SCRAPE_BACKOFF_SEC * (attempt + 1)
    return sleep_sec + random.uniform(0, 0.5)


def _fetch_terms(
    queries: List[str],
    fetch_fn,
    max_workers: int,
):
    if not queries:
        return []
    workers = max(1, min(max_workers, len(queries)))
    if workers == 1:
        return [(term, fetch_fn(term)) for term in queries]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        frames = list(pool.map(fetch_fn, queries))
    return list(zip(queries, frames))


def _normalize_text(text: str) -> str:
    if not text:
        return ""
    s = str(text).lower()
    # Normalize separators so "full-stack" matches "full stack".
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _fingerprint_value(value: Any) -> str:
    return _normalize_text(value or "")


def _parse_csv_list(raw: str) -> List[str]:
    out: List[str] = []
    seen = set()
    for part in (raw or "").split(","):
        value = (part or "").strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _resolve_detail_workers(url_count: int) -> int:
    if url_count <= 1:
        return 1
    raw = os.environ.get("FETCH_DETAIL_URL_WORKERS", "").strip()
    try:
        configured = int(raw) if raw else DEFAULT_DETAIL_URL_WORKERS
    except ValueError:
        configured = DEFAULT_DETAIL_URL_WORKERS
    configured = max(1, min(MAX_DETAIL_URL_WORKERS, configured))
    return min(url_count, configured)


def _resolve_detail_timeout_sec() -> float:
    raw = os.environ.get("FETCH_DETAIL_URL_TIMEOUT_SEC", "").strip()
    try:
        value = float(raw) if raw else DEFAULT_DETAIL_URL_TIMEOUT_SEC
    except ValueError:
        value = DEFAULT_DETAIL_URL_TIMEOUT_SEC
    return max(2.0, value)


def _resolve_detail_retries() -> int:
    raw = os.environ.get("FETCH_DETAIL_URL_RETRIES", "").strip()
    try:
        value = int(raw) if raw else DEFAULT_DETAIL_URL_RETRIES
    except ValueError:
        value = DEFAULT_DETAIL_URL_RETRIES
    return max(0, min(6, value))


def _resolve_detail_backoff_base_sec() -> float:
    raw = os.environ.get("FETCH_DETAIL_URL_BACKOFF_BASE_SEC", "").strip()
    try:
        value = float(raw) if raw else DEFAULT_DETAIL_URL_BACKOFF_BASE_SEC
    except ValueError:
        value = DEFAULT_DETAIL_URL_BACKOFF_BASE_SEC
    return max(0.2, min(10.0, value))


def _extract_linkedin_job_id(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""

    match = LINKEDIN_JOB_ID_RE.search(raw)
    if match:
        return match.group(1)

    try:
        parts = urlsplit(raw)
    except Exception:
        return ""

    if not (parts.scheme and parts.netloc):
        return ""

    hostname = (parts.hostname or "").lower()
    if hostname.startswith("www."):
        hostname = hostname[4:]
    if hostname != "linkedin.com" and not hostname.endswith(".linkedin.com"):
        return ""

    qs = parse_qs(parts.query or "")
    for key in ("currentJobId", "currentjobid", "jobId", "jobid"):
        val = (qs.get(key) or [""])[0]
        if val and str(val).isdigit():
            return str(val)

    return ""


def _canonicalize_job_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        parts = urlsplit(raw)
    except Exception:
        return raw
    if not parts.scheme or not parts.netloc:
        return raw

    scheme = parts.scheme.lower()
    hostname = (parts.hostname or "").lower()
    if hostname.startswith("www."):
        hostname = hostname[4:]
    if hostname == "linkedin.com" or hostname.endswith(".linkedin.com"):
        hostname = "linkedin.com"
    port = parts.port
    if not hostname:
        return raw
    if port and not ((scheme == "https" and port == 443) or (scheme == "http" and port == 80)):
        netloc = f"{hostname}:{port}"
    else:
        netloc = hostname

    if hostname == "linkedin.com":
        job_id = _extract_linkedin_job_id(raw)
        if job_id:
            return f"https://linkedin.com/jobs/view/{job_id}"

    path = parts.path or "/"
    if path != "/":
        path = path.rstrip("/")
        if not path:
            path = "/"

    # Drop query and fragment to remove tracking variants.
    return urlunsplit((scheme, netloc, path, "", ""))


def dedupe_jobs(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()
    out["_canonical_job_url"] = out.get("job_url", "").fillna("").apply(_canonicalize_job_url)

    has_url = out["_canonical_job_url"].astype(bool)
    by_url = out[has_url].drop_duplicates(subset=["_canonical_job_url"], keep="first")
    no_url = out[~has_url].copy()
    if not no_url.empty:
        no_url["_fallback_fingerprint"] = (
            no_url.get("title", "").apply(_fingerprint_value)
            + "|"
            + no_url.get("company", "").apply(_fingerprint_value)
            + "|"
            + no_url.get("location", "").apply(_fingerprint_value)
        )
        no_url = no_url.drop_duplicates(subset=["_fallback_fingerprint"], keep="first")
        no_url = no_url.drop(columns=["_fallback_fingerprint"], errors="ignore")

    out = pd.concat([by_url, no_url], ignore_index=True)
    return out.drop(columns=["_canonical_job_url"], errors="ignore")


def _build_exclude_title_re(terms: List[str]) -> Optional[re.Pattern]:
    cleaned = [re.escape(t.strip().lower()) for t in terms if t and t.strip()]
    if not cleaned:
        return None
    return re.compile(r'(?i)\b(?:' + "|".join(cleaned) + r')\b')


def filter_title(
    df: pd.DataFrame,
    queries: List[str],
    enforce_include: bool,
    exclude_terms: Optional[List[str]] = None,
) -> pd.DataFrame:
    if df.empty:
        return df
    t = df["title"].fillna("")
    exclude_re = _build_exclude_title_re(exclude_terms or [])
    if exclude_re:
        exc = t.apply(lambda s: bool(exclude_re.search(s)))
    else:
        exc = t.apply(lambda s: False)
    out = df[~exc].copy()
    # Optional strict include mode for parity with includeFromQueries config.
    if enforce_include:
        include_terms = _build_query_phrases(queries)
        if include_terms:
            normalized_titles = out["title"].fillna("").apply(_normalize_text)
            include_mask = normalized_titles.apply(
                lambda value: any(term in value for term in include_terms)
            )
            out = out[include_mask].copy()
    return out


def filter_description(
    df: pd.DataFrame,
    exclude_rights: bool,
    exclude_clearance: bool,
    exclude_sponsorship: bool,
) -> pd.DataFrame:
    if df.empty or "description" not in df.columns:
        return df
    desc = df["description"].fillna("")
    if exclude_rights:
        hard_rights = desc.str.contains(HARD_RIGHTS_RE, na=False)
        soft_rights = desc.str.contains(SOFT_RIGHTS_RE, na=False)
        rights = hard_rights & ~soft_rights
    else:
        rights = pd.Series(False, index=desc.index)
    if exclude_clearance:
        hard_clearance = desc.str.contains(HARD_CLEARANCE_RE, na=False)
        soft_clearance = desc.str.contains(SOFT_CLEARANCE_RE, na=False)
        clearance = hard_clearance & ~soft_clearance
    else:
        clearance = pd.Series(False, index=desc.index)
    sponsorship = (
        desc.str.contains(EXCLUDE_SPONSORSHIP_RE, na=False)
        if exclude_sponsorship
        else pd.Series(False, index=desc.index)
    )
    return df[~(rights | clearance | sponsorship)].copy()


def keep_columns(df: pd.DataFrame) -> pd.DataFrame:
    # Normalize jobspy column names to our import schema
    out = df.copy()
    if "job_url" not in out.columns and "job_url_direct" in out.columns:
        out["job_url"] = out["job_url_direct"]

    if "job_type" not in out.columns and "employment_type" in out.columns:
        out["job_type"] = out["employment_type"]
    if "job_level" not in out.columns and "seniority_level" in out.columns:
        out["job_level"] = out["seniority_level"]

    for c in ["job_url", "title", "company", "location", "job_type", "job_level", "description"]:
        if c not in out.columns:
            out[c] = ""

    return out[["job_url", "title", "company", "location", "job_type", "job_level", "description"]].fillna("")


def _clean_description_text(text: str) -> str:
    if not text:
        return ""
    s = str(text)
    # Lightweight cleanup: remove HTML and normalize common escape artifacts
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    s = s.replace("\uff0b", "+").replace("\uff1a", ":")
    s = s.replace("\\+", "+").replace("\\-", "-").replace("\\&", "&")
    s = s.replace("\\/", "/").replace("\\(", "(").replace("\\)", ")")
    s = s.replace("\\_", "_").replace("\\*", "*").replace("\\#", "#")
    s = s.replace("\\'", "'").replace('\\"', '"')
    s = s.replace("\\", "")
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n\n", s)
    return s.strip()


def clean_description(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty or "description" not in df.columns:
        return df
    out = df.copy()
    out["description"] = out["description"].fillna("").apply(_clean_description_text)
    return out


def _find_description_in_json_ld(payload: Any) -> str:
    if isinstance(payload, dict):
        description = payload.get("description")
        if isinstance(description, str) and description.strip():
            return description
        for value in payload.values():
            nested = _find_description_in_json_ld(value)
            if nested:
                return nested
    elif isinstance(payload, list):
        for item in payload:
            nested = _find_description_in_json_ld(item)
            if nested:
                return nested
    return ""


def _strip_html(html_text: str) -> str:
    text = html_text or ""
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", text)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _extract_description_from_html(html_text: str) -> str:
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
        desc = _find_description_in_json_ld(payload)
        if desc:
            return _clean_description_text(desc)

    linkedin_match = re.search(
        r'(?is)<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>(.*?)</div>',
        html_text,
    )
    if linkedin_match:
        text = _strip_html(linkedin_match.group(1))
        if text:
            return _clean_description_text(text)

    meta_desc_match = re.search(
        r'(?is)<meta[^>]+(?:name|property)=["\'](?:description|og:description)["\'][^>]+content=["\'](.*?)["\']',
        html_text,
    )
    if meta_desc_match:
        text = _strip_html(meta_desc_match.group(1))
        if text:
            return _clean_description_text(text)

    text = _strip_html(html_text)
    return _clean_description_text(text) if text else ""


def _fetch_description_for_url(
    job_url: str,
    proxy_pool: Optional[List[str]] = None,
) -> str:
    canonical = _canonicalize_job_url(job_url)
    if not canonical:
        return ""

    timeout_sec = _resolve_detail_timeout_sec()
    retries = _resolve_detail_retries()
    backoff_base_sec = _resolve_detail_backoff_base_sec()
    user_agent = os.environ.get("FETCH_DETAIL_USER_AGENT", "").strip() or (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )
    headers = {"User-Agent": user_agent}

    for attempt in range(retries + 1):
        proxy = _proxy_for_attempt(proxy_pool or [], canonical, attempt)
        proxies = {"http": proxy, "https": proxy} if proxy else None
        try:
            linkedin_id = _extract_linkedin_job_id(canonical)
            if linkedin_id:
                detail_url = f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{linkedin_id}"
            else:
                detail_url = canonical
            res = requests.get(detail_url, timeout=timeout_sec, headers=headers, proxies=proxies)
            if res.status_code >= 400:
                raise RuntimeError(f"http_{res.status_code}")
            description = _extract_description_from_html(res.text or "")
            if description:
                return description
            return ""
        except Exception as err:
            if attempt >= retries:
                logger.warning("detail fetch failed url=%s error=%s", canonical, err)
                return ""
            sleep_sec = backoff_base_sec * (2**attempt) + random.uniform(0.0, 0.5)
            time.sleep(sleep_sec)
    return ""


def _description_needs_enrichment(description: Any) -> bool:
    text = str(description or "").strip()
    return not text


def _enrich_descriptions_for_urls(
    df: pd.DataFrame,
    proxy_pool: Optional[List[str]] = None,
    fetch_fn=None,
) -> pd.DataFrame:
    if df.empty or "job_url" not in df.columns:
        return df
    out = df.copy()
    if "description" not in out.columns:
        out["description"] = ""
    out["description"] = out["description"].fillna("")

    out["_canonical_job_url"] = out["job_url"].fillna("").apply(_canonicalize_job_url)
    candidates = out[
        out["_canonical_job_url"].astype(bool)
        & out["description"].apply(_description_needs_enrichment)
    ]
    if candidates.empty:
        return out.drop(columns=["_canonical_job_url"], errors="ignore")

    urls = list(dict.fromkeys(candidates["_canonical_job_url"].tolist()))
    workers = _resolve_detail_workers(len(urls))
    logger.info("Phase2 detail enrichment: urls=%s workers=%s", len(urls), workers)

    resolve = fetch_fn or (lambda url: _fetch_description_for_url(url, proxy_pool=proxy_pool))

    def fetch_one(url: str):
        return url, str(resolve(url) or "").strip()

    pairs: List[tuple[str, str]]
    if workers <= 1:
        pairs = [fetch_one(url) for url in urls]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            pairs = list(pool.map(fetch_one, urls))

    details = pd.DataFrame(
        [
            {"job_url": url, "description": description}
            for url, description in pairs
            if description
        ]
    )
    if details.empty:
        return out.drop(columns=["_canonical_job_url"], errors="ignore")
    merged = _merge_phase_details(
        out.drop(columns=["_canonical_job_url"], errors="ignore"),
        details,
    )
    return merged


def _proxy_for_attempt(proxy_pool: List[str], term: str, attempt: int) -> Optional[str]:
    if not proxy_pool:
        return None
    base = abs(hash(term)) % len(proxy_pool)
    index = (base + attempt) % len(proxy_pool)
    return proxy_pool[index]


def _merge_phase_details(base_df: pd.DataFrame, details_df: pd.DataFrame) -> pd.DataFrame:
    if base_df.empty:
        return base_df
    if details_df.empty:
        return base_df

    out = base_df.copy()
    details = details_df.copy()
    out["_canonical_job_url"] = out.get("job_url", "").fillna("").apply(_canonicalize_job_url)
    details["_canonical_job_url"] = details.get("job_url", "").fillna("").apply(_canonicalize_job_url)
    details = details[details["_canonical_job_url"].astype(bool)].drop_duplicates(
        subset=["_canonical_job_url"], keep="first"
    )
    details_by_url = details.set_index("_canonical_job_url")

    if "description" not in out.columns:
        out["description"] = ""
    out["description"] = out["description"].fillna("")

    def resolve_description(row):
        current = str(row.get("description") or "").strip()
        if current:
            return current
        key = row.get("_canonical_job_url") or ""
        if not key or key not in details_by_url.index:
            return current
        details_val = details_by_url.loc[key, "description"]
        if isinstance(details_val, pd.Series):
            details_val = details_val.iloc[0]
        return str(details_val or "").strip()

    out["description"] = out.apply(resolve_description, axis=1)
    return out.drop(columns=["_canonical_job_url"], errors="ignore")


def _fetch_single_linkedin_term(
    term: str,
    location: str,
    hours_old: int,
    results_wanted: int,
    fetch_description: bool,
    proxy_pool: Optional[List[str]] = None,
) -> Optional[pd.DataFrame]:
    raw_rl_retries = os.environ.get("FETCH_RATE_LIMIT_RETRIES", "").strip()
    try:
        rate_limit_retries = int(raw_rl_retries) if raw_rl_retries else DEFAULT_RATE_LIMIT_RETRIES
    except ValueError:
        rate_limit_retries = DEFAULT_RATE_LIMIT_RETRIES
    max_attempts = max(SCRAPE_RETRIES + 1, max(1, rate_limit_retries))

    for attempt in range(max_attempts):
        try:
            proxy = _proxy_for_attempt(proxy_pool or [], term, attempt)
            df = scrape_jobs(
                site_name=["linkedin"],
                search_term=term,
                location=location,
                hours_old=hours_old,
                results_wanted=results_wanted,
                verbose=0,
                linkedin_fetch_description=fetch_description,
                proxies=proxy,
            )
            return df
        except Exception as e:
            is_429 = _is_rate_limited_error(e)
            if attempt >= (max_attempts - 1):
                logger.error("scrape_jobs failed term=%s error=%s", term, e)
                return None
            sleep_sec = _retry_sleep_seconds(e, attempt)
            logger.warning(
                "scrape_jobs retry term=%s attempt=%s/%s rate_limited=%s sleep=%.1fs error=%s",
                term,
                attempt + 1,
                max_attempts,
                is_429,
                sleep_sec,
                e,
            )
            time.sleep(sleep_sec)
    return None


def fetch_linkedin(
    queries: List[str],
    location: str,
    hours_old: int,
    results_wanted: int,
    results_budget_by_term: Optional[Dict[str, int]] = None,
    fetch_description: bool = True,
    proxy_pool: Optional[List[str]] = None,
) -> pd.DataFrame:
    dfs: List[pd.DataFrame] = []
    workers = _resolve_fetch_query_workers(len(queries))
    term_budget = results_budget_by_term or {}
    logger.info(
        "Fetch mode: queries=%s workers=%s fetch_description=%s",
        len(queries),
        workers,
        fetch_description,
    )

    pending_terms = list(queries)
    current_workers = workers
    rounds = 0
    while pending_terms:
        rounds += 1
        pairs = _fetch_terms(
            pending_terms,
            lambda term: _fetch_single_linkedin_term(
                term,
                location,
                hours_old,
                int(term_budget.get(term, results_wanted)),
                fetch_description=fetch_description,
                proxy_pool=proxy_pool,
            ),
            max_workers=current_workers,
        )
        failed_terms: List[str] = []
        for term, df in pairs:
            if df is None or df.empty:
                failed_terms.append(term)
                continue
            df = df.loc[:, df.notna().any(axis=0)]
            if "job_url" in df.columns:
                df = df.drop_duplicates(subset=["job_url"], keep="first")
            df["source_query"] = term
            dfs.append(df)

        if not failed_terms:
            break
        if current_workers <= 1 or rounds >= 3:
            logger.info("Fallback reached safe mode after %s rounds; stop retries", rounds)
            break

        raw_cooldown = os.environ.get("FETCH_RATE_LIMIT_COOLDOWN_SEC", "").strip()
        try:
            cooldown_sec = float(raw_cooldown) if raw_cooldown else DEFAULT_RATE_LIMIT_COOLDOWN_SEC
        except ValueError:
            cooldown_sec = DEFAULT_RATE_LIMIT_COOLDOWN_SEC
        next_workers = max(1, current_workers // 2)
        logger.info(
            "Adaptive fallback for %s failed terms after cooldown %.1fs (workers %s -> %s)",
            len(failed_terms),
            cooldown_sec,
            current_workers,
            next_workers,
        )
        time.sleep(max(1.0, cooldown_sec))
        pending_terms = failed_terms
        current_workers = next_workers

    if not dfs:
        return pd.DataFrame()
    out = pd.concat(dfs, ignore_index=True, sort=False)
    if "job_url" in out.columns:
        out = out.drop_duplicates(subset=["job_url"], keep="first")
    return out


def api_base() -> str:
    base = os.environ.get("JOBLIT_WEB_URL", "").strip().rstrip("/")
    if not base:
        raise RuntimeError("JOBLIT_WEB_URL is not set")
    return base


def headers_secret(secret_env: str, header_name: str) -> Dict[str, str]:
    secret = os.environ.get(secret_env, "").strip()
    if not secret:
        raise RuntimeError(f"{secret_env} is not set")
    return {header_name: secret, "Content-Type": "application/json"}


def _is_cancelled_run(run: Dict[str, Any]) -> bool:
    return (run or {}).get("status") == "FAILED" and (run or {}).get("error") == CANCELLED_ERROR


def _fetch_run_config(base: str, run_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
    cfg_res = requests.get(
        f"{base}/api/fetch-runs/{run_id}/config",
        headers=headers,
        timeout=30,
    )
    cfg_res.raise_for_status()
    return cfg_res.json()["run"]


def _abort_if_cancelled(base: str, run_id: str, headers: Dict[str, str], stage: str) -> None:
    run = _fetch_run_config(base, run_id, headers=headers)
    if _is_cancelled_run(run):
        logger.info("FetchRun cancelled at stage=%s. exiting.", stage)
        # SystemExit is not caught by the bottom-level Exception handler.
        sys.exit(0)


def main():
    run_id = os.environ.get("RUN_ID", "").strip()
    if not run_id:
        raise RuntimeError("RUN_ID is not set")

    base = api_base()

    fetch_headers = headers_secret("FETCH_RUN_SECRET", "x-fetch-run-secret")

    # Get run config
    run = _fetch_run_config(base, run_id, headers=fetch_headers)
    if _is_cancelled_run(run):
        logger.info("FetchRun already cancelled before start. exiting.")
        sys.exit(0)

    user_email = run["userEmail"]
    raw_queries = run["queries"] or {}
    if isinstance(raw_queries, list):
        queries = raw_queries
        title_query = queries[0] if queries else ""
        apply_excludes = bool(run.get("filterDescription") if run.get("filterDescription") is not None else True)
        exclude_title_terms: List[str] = []
        exclude_desc_rules: List[str] = []
        source_options: Dict[str, Any] = {}
    elif isinstance(raw_queries, dict):
        title_query = (raw_queries.get("title") or "").strip()
        queries = raw_queries.get("queries") or ([title_query] if title_query else [])
        apply_excludes = bool(raw_queries.get("applyExcludes", True))
        exclude_title_terms = raw_queries.get("excludeTitleTerms") or []
        exclude_desc_rules = raw_queries.get("excludeDescriptionRules") or []
        source_options = raw_queries.get("sourceOptions") or {}
    else:
        raise RuntimeError("run.queries must be a list or object")

    # v2 matcher defaults — GLOBAL region (unions all country packs) + balanced
    # strictness. Maximizes recall without requiring user configuration.
    identity_region = "GLOBAL"
    identity_strictness = "balanced"

    location = run.get("location") or "Sydney, New South Wales, Australia"
    hours_old = int(run.get("hoursOld") or 48)
    results_wanted = int(run.get("resultsWanted") or DEFAULT_FULL_FETCH_RESULTS_WANTED)
    include_from_queries = bool(run.get("includeFromQueries") or False)
    if not include_from_queries and isinstance(raw_queries, dict):
        include_from_queries = bool(raw_queries.get("includeFromQueries") or False)
    proxy_pool = _parse_csv_list(os.environ.get("FETCH_PROXY_POOL", ""))

    exclude_rights = apply_excludes and "identity_requirement" in exclude_desc_rules
    exclude_clearance = apply_excludes and "clearance_requirement" in exclude_desc_rules
    exclude_sponsorship = apply_excludes and "sponsorship_unavailable" in exclude_desc_rules
    filter_desc = apply_excludes and bool(
        exclude_rights or exclude_clearance or exclude_sponsorship
    )

    # Mark running
    requests.patch(
        f"{base}/api/fetch-runs/{run_id}/update",
        headers=fetch_headers,
        data=json.dumps({"status": "RUNNING"}),
        timeout=30,
    ).raise_for_status()

    t0 = time.time()
    search_terms = _resolve_search_terms(title_query=title_query, queries=queries)
    results_budget_by_term = _build_results_budget_by_term(search_terms, results_wanted)
    logger.info(
        "Search terms=%s results_budget_by_term=%s source_options=%s",
        len(search_terms),
        results_budget_by_term,
        {
            "proxyPoolSize": len(proxy_pool),
        },
    )
    df = fetch_linkedin(
        search_terms,
        location,
        hours_old,
        results_wanted,
        results_budget_by_term=results_budget_by_term,
        fetch_description=True,
        proxy_pool=proxy_pool,
    )

    if df.empty:
        items: List[Dict[str, Any]] = []
    else:
        logger.info("Fetched %s rows before filtering", len(df))
        df = filter_title(
            df,
            search_terms,
            enforce_include=include_from_queries,
            exclude_terms=exclude_title_terms if apply_excludes else None,
        )
        logger.info("Rows after title filter: %s", len(df))
        df = keep_columns(df)
        # Clean before description exclusion for more consistent matching
        df = clean_description(df)
        if filter_desc:
            # v2 matcher — layered regex + weighted scoring with audit trail.
            try:
                from rights_filter import filter_description_v2  # type: ignore
            except ImportError:
                # Fall back to legacy regex if the matcher module is unavailable
                df = filter_description(
                    df,
                    exclude_rights=exclude_rights,
                    exclude_clearance=exclude_clearance,
                    exclude_sponsorship=exclude_sponsorship,
                )
            else:
                active_rules: List[str] = []
                if exclude_rights:
                    active_rules.append("identity_requirement")
                if exclude_clearance:
                    active_rules.append("clearance_requirement")
                if exclude_sponsorship:
                    active_rules.append("sponsorship_unavailable")
                df, audit_df = filter_description_v2(
                    df,
                    rules=active_rules,
                    region=identity_region,
                    strictness=identity_strictness,
                )
                if not audit_df.empty:
                    audit_summary = (
                        audit_df.groupby("rule")["score"].count().to_dict()
                        if "rule" in audit_df.columns
                        else {}
                    )
                    logger.info(
                        "filter_description_v2 dropped=%s region=%s strictness=%s by_rule=%s",
                        len(audit_df),
                        identity_region,
                        identity_strictness,
                        audit_summary,
                    )
            logger.info("Rows after description filter: %s", len(df))
        df = dedupe_jobs(df)
        items = df.to_dict(orient="records")

    # Import into DB via Vercel API (chunked to avoid payload/time limits)
    imported = 0
    if items:
        _abort_if_cancelled(base, run_id, headers=fetch_headers, stage="before_import")
        batch_size = 50
        for i in range(0, len(items), batch_size):
            _abort_if_cancelled(base, run_id, headers=fetch_headers, stage=f"before_import_batch_{i}")
            batch = items[i : i + batch_size]
            imp_res = None
            for attempt in range(IMPORT_RETRIES + 1):
                imp_res = requests.post(
                    f"{base}/api/admin/import",
                    headers=headers_secret("IMPORT_SECRET", "x-import-secret"),
                    data=json.dumps({"userEmail": user_email, "items": batch}),
                    timeout=120,
                )
                if imp_res.ok:
                    break
                if attempt >= IMPORT_RETRIES:
                    raise RuntimeError(
                        f"import failed status={imp_res.status_code} body={imp_res.text}"
                    )
                time.sleep(2 * (attempt + 1))
            imported += int(imp_res.json().get("imported", 0))

    # Update run
    _abort_if_cancelled(base, run_id, headers=fetch_headers, stage="before_succeeded_update")
    requests.patch(
        f"{base}/api/fetch-runs/{run_id}/update",
        headers=fetch_headers,
        data=json.dumps({"status": "SUCCEEDED", "importedCount": imported, "error": None}),
        timeout=30,
    ).raise_for_status()

    logger.info("Done. imported=%s elapsed=%.1fs", imported, time.time() - t0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Best effort: mark failed
        try:
            rid = os.environ.get("RUN_ID", "").strip()
            if rid:
                requests.patch(
                    f"{api_base()}/api/fetch-runs/{rid}/update",
                    headers=headers_secret("FETCH_RUN_SECRET", "x-fetch-run-secret"),
                    data=json.dumps({"status": "FAILED", "error": str(e)}),
                    timeout=30,
                )
        except Exception:
            pass
        raise
