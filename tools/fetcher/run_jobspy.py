import os
import re
import json
import sys
import time
import math
import random
import logging
import unicodedata
import ipaddress
import socket
import uuid
from html import unescape
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit, parse_qs, urlencode, quote
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

import requests
import pandas as pd
from jobspy import scrape_jobs
from title_seniority_policy import (
    evaluate_legacy_title_exclusions,
    evaluate_title_seniority_for_policy,
)
from fetch_policy import (
    AU_FETCH_POLICY_REGISTRY,
    AU_RECALL_SAFE_V1_POLICY_ID,
    AU_RECALL_SAFE_V2_POLICY_ID,
    FetchPolicyManifestError,
    resolve_registered_au_fetch_policy,
)

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(name)s: %(message)s')
logger = logging.getLogger("jobspy_runner")

SCRAPE_RETRIES = 2
SCRAPE_BACKOFF_SEC = 2
COMMIT_RETRIES = 2
FETCH_RUN_COMMIT_PROTOCOL = "fetch-run-commit/v1"
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
MAX_DETAIL_URL_REDIRECTS = 3
MAX_DETAIL_RESPONSE_BYTES = 2 * 1024 * 1024

LINKEDIN_JOB_ID_RE = re.compile(r"linkedin\.com/jobs/view/(\d+)", re.IGNORECASE)
IDENTITY_QUERY_GROUPS = (
    ("gh_jid", ("gh_jid",)),
    ("job_id", ("jobid", "job_id", "jid")),
    (
        "requisition_id",
        ("requisitionid", "requisition_id", "reqid", "req_id"),
    ),
    ("posting_id", ("postingid", "posting_id")),
)

CANCELLED_ERROR = "Cancelled by user"


class FetchRunCancelled(SystemExit):
    """A clean worker exit after the server linearizes cancellation first."""

    def __init__(self):
        super().__init__(0)


class FetchRunSuperseded(SystemExit):
    """Another worker established the canonical batch stream first."""

    def __init__(self):
        super().__init__(0)


# Historical v1 description rules share this manifest with the TypeScript
# normalizer. AU v2 title policy is versioned separately and never comes from
# browser-selected terms.
FETCH_EXCLUSION_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "lib"
    / "shared"
    / "fetchExclusionCriteria.config.json"
)
FETCH_ROLE_PACKS_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "lib"
    / "shared"
    / "fetchRolePacks.config.json"
)

# Description-level rights/clearance/sponsorship filtering lives in
# rights_filter.ExclusionMatcher (see rights_rules.json). The older regex
# constants that previously lived here were retired with the v2 matcher —
# keeping them around created a false safety net where a broken import
# could silently downgrade filtering quality.


def _load_fetch_exclusion_manifest() -> Dict[str, Any]:
    return json.loads(FETCH_EXCLUSION_MANIFEST_PATH.read_text(encoding="utf-8"))


def _description_rules_by_category(category: str) -> List[str]:
    manifest = _load_fetch_exclusion_manifest()
    return [
        str(rule.get("value") or "")
        for rule in manifest.get("descriptionRules", [])
        if rule.get("category") == category and rule.get("value")
    ]


def _experience_rule_thresholds() -> Dict[str, int]:
    manifest = _load_fetch_exclusion_manifest()
    out: Dict[str, int] = {}
    for rule in manifest.get("descriptionRules", []):
        if rule.get("category") != "experience":
            continue
        value = str(rule.get("value") or "")
        years = rule.get("minYears")
        if value and isinstance(years, int):
            out[value] = years
    return out


def _relevance_manifest() -> Dict[str, Any]:
    """The title-relevance vocabulary shared with lib/shared/jobRelevance.ts.

    One table, two readers. The fallbacks below keep the worker runnable if the
    manifest is ever unreadable, but `SharedRelevanceManifestTests` asserts the
    manifest and these constants agree, so a silent fork fails the suite.
    """
    try:
        manifest = json.loads(
            FETCH_ROLE_PACKS_MANIFEST_PATH.read_text(encoding="utf-8")
        )
    except (OSError, ValueError, TypeError):
        return {}
    value = manifest.get("relevance")
    return value if isinstance(value, dict) else {}


_RELEVANCE = _relevance_manifest()


def _manifest_str_tuple(key: str, fallback: tuple[str, ...]) -> tuple[str, ...]:
    raw = _RELEVANCE.get(key)
    if not isinstance(raw, list):
        return fallback
    values = tuple(str(item).strip() for item in raw if str(item).strip())
    return values or fallback


def _role_generic_signal_tokens() -> set[str]:
    # "fullstack" is deliberately absent: `_normalize_role_text` collapses
    # "full stack" into it, so treating it as generic erased the only domain
    # signal a full-stack query carries and made that search match every role.
    fallback = {
        "application",
        "dev",
        "developer",
        "development",
        "engineer",
        "engineering",
        "full",
        "role",
        "software",
        "stack",
    }
    try:
        manifest = json.loads(
            FETCH_ROLE_PACKS_MANIFEST_PATH.read_text(encoding="utf-8")
        )
    except (OSError, ValueError, TypeError):
        return fallback
    configured = {
        str(token).strip().lower()
        for token in manifest.get("genericTokens", [])
        if str(token).strip()
    }
    return fallback | configured


DESCRIPTION_RIGHTS_RULES = set(_description_rules_by_category("rights"))
EXPERIENCE_RULE_THRESHOLDS = _experience_rule_thresholds()
ROLE_GENERIC_SIGNAL_TOKENS = _role_generic_signal_tokens()

EXPERIENCE_REQUIREMENT_PATTERNS = [
    re.compile(
        r"(?i)\b(?:minimum|min\.?|at\s+least|requires?|required|must\s+have|need(?:ed)?|looking\s+for)\s+"
        r"(?:a\s+)?(?:minimum\s+of\s+)?(?P<num>\d{1,2})\s*\+?\s*(?:years?|yrs?)\b"
        r"(?:[^.;]{0,80}\b(?:experience|commercial|professional|development|engineering)\b)?"
    ),
    re.compile(
        r"(?i)\b(?P<num>\d{1,2})\s*\+\s*(?:years?|yrs?)'?\s+"
        r"(?:of\s+)?(?:commercial\s+|professional\s+|relevant\s+)?experience\b"
    ),
    re.compile(
        r"(?i)\b(?P<num>\d{1,2})\s*(?:years?|yrs?)'?\s+"
        r"(?:of\s+)?(?:commercial\s+|professional\s+|relevant\s+)?experience\s+"
        r"(?:is\s+)?(?:required|minimum|needed|essential|must\b)"
    ),
    re.compile(
        r"(?i)\b(?:over|more\s+than)\s+(?P<num>\d{1,2})\s*(?:years?|yrs?)'?\s+"
        r"(?:of\s+)?(?:commercial\s+|professional\s+|relevant\s+)?experience\b"
    ),
    re.compile(
        r"(?P<num>\d{1,2}|[一二三四五六七八九十]{1,3})\s*年\s*(?:以上|及以上|起)\s*(?:工作)?经验"
    ),
    re.compile(
        r"(?:至少|不少于)\s*(?P<num>\d{1,2}|[一二三四五六七八九十]{1,3})\s*年\s*(?:工作)?经验"
    ),
]

EXPERIENCE_SOFT_GUARD_RE = re.compile(
    r"(?i)\b(?:up\s+to|less\s+than|fewer\s+than|under|within|no\s+more\s+than|maximum|max\.?|preferred|nice\s+to\s+have)\b"
)

AU_STATE_ALIASES = {
    "NSW": ("nsw", "new south wales"),
    "VIC": ("vic", "victoria"),
    "QLD": ("qld", "queensland"),
    "WA": ("wa", "western australia"),
    "SA": ("sa", "south australia"),
    "TAS": ("tas", "tasmania"),
    "ACT": ("act", "australian capital territory"),
    "NT": ("nt", "northern territory"),
}

def _manifest_pattern(key: str, fallback: str) -> "re.Pattern[str]":
    raw = _RELEVANCE.get(key)
    source = raw if isinstance(raw, str) and raw.strip() else fallback
    try:
        return re.compile(source, re.IGNORECASE)
    except re.error:
        return re.compile(fallback, re.IGNORECASE)


INVALID_DESCRIPTION_RE = _manifest_pattern(
    "invalidDescriptionPattern",
    r"^\s*(?:"
    r"sign\s+in\s+to\s+view\s+this\s+job|"
    r"join\s+linkedin(?:\s+to\s+view\s+this\s+job)?|"
    r"page\s+not\s+found|"
    r"access\s+denied|"
    r"enable\s+javascript(?:\s+to\s+continue)?|"
    r"verify\s+you(?:'re|\s+are)\s+human|"
    r"captcha"
    r")[\s.!-]*$",
)

INVALID_TITLE_RE = _manifest_pattern(
    "invalidTitlePattern",
    r"^\s*(?:jobs?|job\s+search|careers?|vacancies|"
    r"search\s+results?|view\s+all\s+jobs?|sign\s+in)\s*$",
)

# "Data Scientist" / "Research Scientist" / "AI Researcher" are engineering
# roles for our purposes. Without these markers the whole signal path is
# skipped for them and only a literal full-title match can keep them.
ROLE_TOKENS = set(
    _manifest_str_tuple(
        "roleTokens",
        (
            "architect",
            "developer",
            "development",
            "engineer",
            "engineering",
            "programmer",
            "researcher",
            "scientist",
        ),
    )
)
# Seniority states a level, not a domain, so it is stripped from a query's
# signals. Leaving "senior" in made it a term the title had to contain, which
# rejected "AI Engineer", "Staff AI Engineer" and "Principal AI Engineer" for
# the query "Senior AI Engineer".
ROLE_NOISE_TOKENS = set(
    _manifest_str_tuple(
        "roleNoiseTokens",
        (
            "entry",
            "graduate",
            "head",
            "junior",
            "lead",
            "level",
            "mid",
            "principal",
            "senior",
            "staff",
        ),
    )
)
CJK_ROLE_TERMS = _manifest_str_tuple(
    "cjkRoleTerms",
    (
        "开发工程师",
        "软件工程师",
        "开发人员",
        "技术专家",
        "工程师",
        "程序员",
        "架构师",
        "开发者",
        "设计师",
        "分析师",
        "经理",
        "顾问",
        "专员",
        "开发",
    ),
)
CJK_ROLE_NOISE_TERMS = _manifest_str_tuple(
    "cjkRoleNoiseTerms",
    ("高级", "资深", "初级", "中级", "首席", "应届", "校招"),
)


def _parse_year_count(raw: str) -> Optional[int]:
    value = (raw or "").strip()
    if not value:
        return None
    if value.isdigit():
        return int(value)

    digit_map = {
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
    }
    if value == "十":
        return 10
    if value.startswith("十") and len(value) == 2:
        return 10 + digit_map.get(value[1], 0)
    if value.endswith("十") and len(value) == 2:
        return digit_map.get(value[0], 0) * 10
    if "十" in value and len(value) == 3:
        return digit_map.get(value[0], 0) * 10 + digit_map.get(value[2], 0)
    return digit_map.get(value)


def _is_soft_or_range_experience_context(text: str, start: int, end: int) -> bool:
    prefix = text[max(0, start - 28) : start]
    suffix = text[end : min(len(text), end + 36)]
    context = f"{prefix} {suffix}"
    if EXPERIENCE_SOFT_GUARD_RE.search(context):
        return True
    if re.search(r"(?i)(?:\d+\s*(?:-|–|to)\s*)$", prefix):
        return True
    return False


def _experience_snippet(text: str, start: int, end: int, pad: int = 70) -> str:
    return text[max(0, start - pad) : min(len(text), end + pad)].strip()


def _active_experience_thresholds(rules: List[str]) -> List[tuple[str, int]]:
    active_rules = set(rules or [])
    active = [
        (rule, years)
        for rule, years in EXPERIENCE_RULE_THRESHOLDS.items()
        if rule in active_rules
    ]
    return sorted(active, key=lambda item: item[1])


def _find_experience_requirement(
    text: str,
    active_thresholds: List[tuple[str, int]],
) -> Optional[tuple[str, int, str]]:
    if not text or not active_thresholds:
        return None
    body = str(text)
    for pattern in EXPERIENCE_REQUIREMENT_PATTERNS:
        for match in pattern.finditer(body):
            years = _parse_year_count(match.group("num"))
            if years is None:
                continue
            if _is_soft_or_range_experience_context(body, match.start(), match.end()):
                continue
            for rule, min_years in active_thresholds:
                if years >= min_years:
                    return rule, years, _experience_snippet(body, match.start(), match.end())
    return None


def filter_experience_requirements(
    df: pd.DataFrame,
    rules: List[str],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    audit_cols = list(df.columns) + ["rule", "score", "evidence", "snippet"]
    active_thresholds = _active_experience_thresholds(rules)
    if df.empty or "description" not in df.columns or not active_thresholds:
        return df.copy(), pd.DataFrame(columns=audit_cols)

    keep_idx: List[int] = []
    audit_rows: List[dict] = []
    for idx, row in df.iterrows():
        desc = row["description"] if pd.notna(row["description"]) else ""
        match = _find_experience_requirement(str(desc), active_thresholds)
        if not match:
            keep_idx.append(idx)
            continue
        rule, years, snippet = match
        entry = row.to_dict()
        entry.update(
            {
                "rule": rule,
                "score": 100,
                "evidence": f"explicit minimum experience requirement: {years} years",
                "snippet": snippet,
            }
        )
        audit_rows.append(entry)

    kept = df.loc[keep_idx].copy()
    audit = (
        pd.DataFrame(audit_rows, columns=audit_cols)
        if audit_rows
        else pd.DataFrame(columns=audit_cols)
    )
    return kept, audit


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


def _clean_query_values(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    out: List[str] = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        key = cleaned.lower()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out


def _resolve_base_queries(
    raw_queries: Any,
    title_query: str,
    expanded_queries: List[str],
) -> List[str]:
    if isinstance(raw_queries, dict):
        explicit = _clean_query_values(raw_queries.get("baseQueries"))
        if explicit:
            return explicit
        if raw_queries.get("smartExpand") is False:
            legacy_unexpanded = _clean_query_values(expanded_queries)
            if legacy_unexpanded:
                return legacy_unexpanded
        if title_query.strip():
            return [title_query.strip()]
    legacy = _clean_query_values(expanded_queries)
    return legacy or ([title_query.strip()] if title_query.strip() else [])


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


TITLE_MATCH_MODES = ("strict", "relaxed", "off")
IMPLEMENTED_AU_RECALL_POLICY_IDS = frozenset(
    {AU_RECALL_SAFE_V1_POLICY_ID, AU_RECALL_SAFE_V2_POLICY_ID}
)


def _resolve_au_recall_policy_id(raw_queries: Any) -> Optional[str]:
    """Validate AU config v2 and return its immutable execution policy id."""
    if not isinstance(raw_queries, dict) or raw_queries.get("schemaVersion") != 2:
        return None
    if (
        raw_queries.get("market") != "AU"
        or raw_queries.get("smartExpand") is not True
        or raw_queries.get("includeFromQueries") is not True
        or raw_queries.get("titleMatch") != "relaxed"
    ):
        raise RuntimeError("Unsupported AU fetch recall policy")
    try:
        policy = resolve_registered_au_fetch_policy(
            raw_queries.get("policy"),
            AU_FETCH_POLICY_REGISTRY,
        )
    except (FetchPolicyManifestError, TypeError, ValueError) as error:
        raise RuntimeError("Unsupported AU fetch recall policy") from error
    if policy.id not in IMPLEMENTED_AU_RECALL_POLICY_IDS:
        raise RuntimeError(
            f"AU fetch recall policy is not implemented: {policy.id}"
        )
    return policy.id


def _uses_au_recall_policy(raw_queries: Any) -> bool:
    """Compatibility probe retained for legacy worker tests and callers."""

    return _resolve_au_recall_policy_id(raw_queries) is not None


def _resolve_active_description_rules(
    apply_recall_policy: bool,
    apply_excludes: bool,
    configured_rules: List[str],
) -> tuple[List[str], List[str]]:
    if apply_recall_policy:
        return ["identity_requirement", "clearance_requirement"], []
    if not apply_excludes:
        return [], []
    return (
        [rule for rule in configured_rules if rule in DESCRIPTION_RIGHTS_RULES],
        [rule for rule in configured_rules if rule in EXPERIENCE_RULE_THRESHOLDS],
    )


def _filter_description_by_policy(
    df: pd.DataFrame,
    *,
    recall_policy_id: Optional[str],
    active_rights_rules: List[str],
    identity_region: str,
    identity_strictness: str,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Route policy-bearing AU configs to recall-safe eligibility rules."""

    if recall_policy_id is not None:
        if recall_policy_id not in IMPLEMENTED_AU_RECALL_POLICY_IDS:
            raise RuntimeError(
                f"AU fetch recall policy is not implemented: {recall_policy_id}"
            )
        from au_eligibility_policy import filter_au_eligibility_policy  # type: ignore

        return filter_au_eligibility_policy(
            df,
            identity_requirement="identity_requirement" in active_rights_rules,
            clearance_requirement="clearance_requirement" in active_rights_rules,
        )

    from rights_filter import filter_description_v2  # type: ignore

    return filter_description_v2(
        df,
        rules=active_rights_rules,
        region=identity_region,
        strictness=identity_strictness,
    )


def _resolve_title_match(
    run: Dict[str, Any],
    raw_queries: Any,
    include_from_queries: bool,
) -> str:
    """Mirror of resolveTitleMatchMode in lib/shared/jobRelevance.ts.

    `titleMatch` names all three states explicitly; the boolean remains the
    fallback for AU rows persisted before the field existed.
    """
    for source in (run, raw_queries if isinstance(raw_queries, dict) else {}):
        value = source.get("titleMatch")
        if isinstance(value, str) and value in TITLE_MATCH_MODES:
            return value
    return "strict" if include_from_queries else "off"


def _normalize_text(text: str) -> str:
    if not text:
        return ""
    s = str(text).lower()
    # Normalize separators so "full-stack" matches "full stack".
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _normalize_role_text(text: str) -> str:
    value = unicodedata.normalize("NFKC", str(text or "")).lower()
    value = re.sub(r"\bfront[\s-]*end\b", "frontend", value)
    value = re.sub(r"\bback[\s-]*end\b", "backend", value)
    value = re.sub(r"\bfull[\s-]*stack\b", "fullstack", value)
    value = re.sub(r"\bml\b", "machine learning", value)
    return value


def _contains_title_term(haystack: str, raw_needle: str) -> bool:
    needle = _normalize_role_text(raw_needle).strip()
    if not needle:
        return False
    body = _normalize_role_text(haystack)
    if re.search(r"[\u3400-\u9fff]", needle):
        return needle in body

    parts = [p for p in re.split(r"[\s\-_/\.]+", needle) if p]
    if not parts:
        return False
    phrase = r"[\s\-_/\.]+".join(re.escape(part) for part in parts)
    return bool(re.search(rf"(?<![a-z0-9]){phrase}(?![a-z0-9])", body))


def _role_tokens(value: str) -> List[str]:
    return re.findall(r"[a-z][a-z0-9+#.]*", _normalize_role_text(value))


def _has_role_marker(value: str) -> bool:
    normalized = _normalize_role_text(value)
    return any(token in ROLE_TOKENS for token in _role_tokens(normalized)) or any(
        term in normalized for term in CJK_ROLE_TERMS
    )


def _ascii_role_signals(value: str) -> List[str]:
    return [
        token
        for token in _role_tokens(value)
        if token not in ROLE_TOKENS and token not in ROLE_NOISE_TOKENS
    ]


def _required_ascii_role_signals(value: str) -> List[str]:
    return [
        token
        for token in _ascii_role_signals(value)
        if token not in ROLE_GENERIC_SIGNAL_TOKENS
    ]


def _cjk_role_signals(value: str) -> List[str]:
    normalized = re.sub(
        r"[a-z][a-z0-9+#.]*",
        " ",
        _normalize_role_text(value),
    )
    for term in (*CJK_ROLE_TERMS, *CJK_ROLE_NOISE_TERMS):
        normalized = normalized.replace(term, " ")
    return re.findall(r"[\u3400-\u9fff]+", normalized)


# AI-domain roles rarely carry the literal token "ai" in their titles: they
# read as "Machine Learning Engineer", "ML / GenAI / LLM Engineer", "Agentic
# Engineer", "Data Scientist". Treat these as one signal class so an
# "AI Engineer" query keeps them instead of rejecting the whole result set
# (which left the strict include filter fetching nothing for AI searches).
def _manifest_domain_class(name: str, fallback: tuple[str, ...]) -> tuple[str, ...]:
    classes = _RELEVANCE.get("domainClasses")
    if not isinstance(classes, dict):
        return fallback
    raw = classes.get(name)
    if not isinstance(raw, list):
        return fallback
    values = tuple(str(item).strip() for item in raw if str(item).strip())
    return values or fallback


AI_DOMAIN_SYNONYMS: tuple[str, ...] = _manifest_domain_class("ai", (
    "ai",
    "artificial intelligence",
    "ml",
    "mlops",
    "machine learning",
    "genai",
    "gen ai",
    "generative ai",
    "llm",
    "llms",
    "nlp",
    "deep learning",
    "neural",
    "agentic",
    "data science",
    "data scientist",
    "computer vision",
    "prompt",
    "rag",
))

BACKEND_DOMAIN_SYNONYMS: tuple[str, ...] = _manifest_domain_class("backend", (
    "backend",
    "api",
    "platform",
    "server side",
    "serverside",
    "microservices",
))

DATA_DOMAIN_SYNONYMS: tuple[str, ...] = _manifest_domain_class("data", (
    "data",
    "analytics",
    "etl",
    "elt",
    "warehouse",
    "business intelligence",
))

ROLE_SIGNAL_SYNONYMS: Dict[str, tuple[str, ...]] = {
    "ai": AI_DOMAIN_SYNONYMS,
    "ml": AI_DOMAIN_SYNONYMS,
    "genai": AI_DOMAIN_SYNONYMS,
    "llm": AI_DOMAIN_SYNONYMS,
    # `_normalize_role_text` rewrites a standalone "ml" to "machine learning",
    # so an "ML Engineer" query arrives here as these two tokens.
    "machine": AI_DOMAIN_SYNONYMS,
    "learning": AI_DOMAIN_SYNONYMS,
    "agent": ("agent", "agents", "agentic"),
    "agentic": ("agentic", "agent", "agents"),
    # The backend and data packs expand into sibling titles that share no
    # literal token with the query ("API Engineer", "Analytics Engineer"), so
    # without these classes the gate rejected every expanded row.
    "backend": BACKEND_DOMAIN_SYNONYMS,
    "api": BACKEND_DOMAIN_SYNONYMS,
    "platform": BACKEND_DOMAIN_SYNONYMS,
    "data": DATA_DOMAIN_SYNONYMS,
    "analytics": DATA_DOMAIN_SYNONYMS,
    "etl": DATA_DOMAIN_SYNONYMS,
}

# Domain families keyed on a token COMBINATION rather than a single token.
# "Power Platform Developer" requires both "power" and "platform", yet none of
# the products in that ecosystem repeat either word — "Copilot Studio
# Developer" and "Dynamics 365 Developer" are Power Platform roles by product,
# not by name. A single-token class cannot express this without also making a
# plain "Platform Engineer" search inherit the whole Microsoft catalogue, so
# the trigger is the full token set.
ROLE_DOMAIN_FAMILIES: tuple[tuple[frozenset[str], tuple[str, ...]], ...] = (
    (
        frozenset({"power", "platform"}),
        (
            "power platform",
            "power apps",
            "powerapps",
            "power automate",
            "power bi",
            "powerbi",
            "copilot",
            "copilot studio",
            "dynamics",
            "dynamics 365",
            "d365",
            "dataverse",
        ),
    ),
)


def _matches_domain_family(title: str, signals: List[str]) -> bool:
    """True when the query's signals trigger a multi-token domain family and the
    title carries any member of it."""
    signal_set = frozenset(signals)
    for triggers, members in ROLE_DOMAIN_FAMILIES:
        if triggers <= signal_set and any(
            _contains_title_term(title, member) for member in members
        ):
            return True
    return False


def _signal_in_title(title: str, signal: str) -> bool:
    """A role signal matches when the title contains it OR a domain synonym."""
    for candidate in ROLE_SIGNAL_SYNONYMS.get(signal, (signal,)):
        if _contains_title_term(title, candidate):
            return True
    return False


def _is_title_relevant(title: str, queries: List[str]) -> bool:
    for query in queries:
        if _contains_title_term(title, query):
            return True
        if not _has_role_marker(query) or not _has_role_marker(title):
            continue
        # Match on the same domain signals the base-query gate uses. Keeping
        # generic words like "software" here meant a "Software Engineer" search
        # rejected "Developer", "Python Developer" and "Backend Engineer" — same
        # family, no shared literal token.
        ascii_signals = _required_ascii_role_signals(query)
        cjk_signals = _cjk_role_signals(query)
        if not ascii_signals and not cjk_signals:
            # A wholly generic query ("Software Engineer") carries no domain to
            # narrow on, so any titled engineering role is a legitimate hit.
            return True
        if not all(
            _signal_in_title(title, signal) for signal in ascii_signals
        ) and not _matches_domain_family(title, ascii_signals):
            continue
        normalized_title = _normalize_role_text(title)
        if all(signal in normalized_title for signal in cjk_signals):
            return True
    return False


# A base query whose only signal names a domain ("AI Engineer" -> "ai") states
# which field the user is hiring into, not which stack they must have. Smart
# expansion answers that with the domain's sibling roles, and the fetcher
# really requests them, so rejecting every one wasted the request and hid
# roles the user asked to see. A base query naming a concrete technology
# ("Java backend developer" -> "java") is a different claim and stays pinned.
DOMAIN_ONLY_BASE_SIGNALS: frozenset[str] = frozenset(
    {*AI_DOMAIN_SYNONYMS, *BACKEND_DOMAIN_SYNONYMS, *DATA_DOMAIN_SYNONYMS}
)


def _base_query_is_domain_only(signals: List[str]) -> bool:
    """True when every required signal names a domain rather than a stack."""
    return bool(signals) and all(
        signal in DOMAIN_ONLY_BASE_SIGNALS for signal in signals
    )


def _matches_base_query_constraints(title: str, base_queries: List[str]) -> bool:
    normalized_title = _normalize_role_text(title)
    for query in base_queries:
        ascii_signals = _required_ascii_role_signals(query)
        cjk_signals = _cjk_role_signals(query)
        if not ascii_signals and not cjk_signals:
            return True
        if not all(
            _signal_in_title(title, signal) for signal in ascii_signals
        ) and not _matches_domain_family(title, ascii_signals):
            # A domain-only base query defers to the include filter, which has
            # already checked the title against the expanded role pack. That
            # keeps sibling engineering roles while still rejecting anything
            # outside the family — a chef matches no expanded query either.
            if not _base_query_is_domain_only(ascii_signals):
                continue
        if all(signal in normalized_title for signal in cjk_signals):
            return True
    return False


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
        return ""

    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        return ""
    hostname = (parts.hostname or "").lower()
    if hostname.startswith("www."):
        hostname = hostname[4:]
    if hostname == "linkedin.com" or hostname.endswith(".linkedin.com"):
        hostname = "linkedin.com"
    try:
        port = parts.port
    except ValueError:
        return ""
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

    query_values = parse_qs(parts.query or "", keep_blank_values=False)
    lower_query_values = {
        key.lower(): values
        for key, values in query_values.items()
    }
    stable_query = ""
    for canonical_key, aliases in IDENTITY_QUERY_GROUPS:
        value = next(
            (
                str((lower_query_values.get(alias) or [""])[0]).strip()
                for alias in aliases
                if (lower_query_values.get(alias) or [""])[0]
            ),
            "",
        )
        if value and len(value) <= 200:
            stable_query = urlencode({canonical_key: value}, quote_via=quote)
            break

    return urlunsplit((scheme, netloc, path, stable_query, ""))


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


def filter_title(
    df: pd.DataFrame,
    queries: List[str],
    enforce_include: bool,
    exclude_terms: Optional[List[str]] = None,
    base_queries: Optional[List[str]] = None,
    relaxed_include: bool = False,
    seniority_policy_id: Optional[str] = None,
) -> pd.DataFrame:
    """Exclusion always applies; `enforce_include` gates the include filter.

    `relaxed_include` keeps the base-query domain constraint but lets a title
    answer the base query rather than one of the expanded terms.
    """
    if df.empty:
        return df
    t = df["title"].fillna("")
    configured_terms = [
        str(term) for term in (exclude_terms or []) if str(term).strip()
    ]
    if seniority_policy_id is not None:
        if seniority_policy_id not in IMPLEMENTED_AU_RECALL_POLICY_IDS:
            raise RuntimeError(
                f"AU fetch recall policy is not implemented: {seniority_policy_id}"
            )
        try:
            decisions = t.astype(str).apply(
                lambda title: evaluate_title_seniority_for_policy(
                    title,
                    seniority_policy_id,
                )
            )
        except ValueError as error:
            raise RuntimeError(
                f"AU fetch recall policy is not implemented: {seniority_policy_id}"
            ) from error
    elif configured_terms:
        decisions = t.astype(str).apply(
            lambda title: evaluate_legacy_title_exclusions(
                title,
                configured_terms,
            )
        )
    else:
        decisions = t.apply(
            lambda _title: {
                "outcome": "KEEP",
                "ruleId": "TITLE_ALLOWED",
                "evidence": None,
            }
        )
    exc = decisions.apply(lambda decision: decision["outcome"] == "EXCLUDE")
    if bool(exc.any()):
        excluded_decisions = decisions[exc]
        logger.info(
            "Title seniority exclusions dropped=%s by_rule=%s samples=%s",
            int(exc.sum()),
            excluded_decisions.apply(lambda decision: decision["ruleId"])
            .value_counts()
            .to_dict(),
            [
                {
                    "title": str(t.loc[index]),
                    "rule": decision["ruleId"],
                    "evidence": decision["evidence"],
                }
                for index, decision in excluded_decisions.head(5).items()
            ],
        )
    out = df[~exc].copy()
    # Optional strict include mode for parity with includeFromQueries config.
    if enforce_include:
        include_terms = [q.strip() for q in queries if q and q.strip()]
        if include_terms:
            constraints = [
                q.strip()
                for q in (base_queries or [])
                if q and q.strip()
            ]

            def _keeps(value: str) -> bool:
                title = str(value)
                if constraints and not _matches_base_query_constraints(
                    title, constraints
                ):
                    return False
                if _is_title_relevant(title, include_terms):
                    return True
                return bool(
                    relaxed_include
                    and constraints
                    and _is_title_relevant(title, constraints)
                )

            include_mask = out["title"].fillna("").apply(_keeps)
            out = out[include_mask].copy()
    return out


def keep_columns(df: pd.DataFrame) -> pd.DataFrame:
    # Normalize jobspy column names to our import schema
    out = df.copy()
    if "job_url" not in out.columns and "job_url_direct" in out.columns:
        out["job_url"] = out["job_url_direct"]

    if "job_type" not in out.columns and "employment_type" in out.columns:
        out["job_type"] = out["employment_type"]
    if "job_level" not in out.columns and "seniority_level" in out.columns:
        out["job_level"] = out["seniority_level"]
    if "listing_date" not in out.columns and "date_posted" in out.columns:
        out["listing_date"] = out["date_posted"]

    for c in [
        "job_url",
        "title",
        "company",
        "location",
        "job_type",
        "job_level",
        "description",
        "listing_date",
    ]:
        if c not in out.columns:
            out[c] = ""

    out["listing_date"] = out["listing_date"].apply(_serialize_listing_date)
    return out[
        [
            "job_url",
            "title",
            "company",
            "location",
            "job_type",
            "job_level",
            "description",
            "listing_date",
        ]
    ].fillna("")


def _serialize_listing_date(value: Any) -> str:
    if value is None or (not isinstance(value, (list, dict)) and pd.isna(value)):
        return ""
    parsed = pd.to_datetime(value, utc=True, errors="coerce")
    if pd.isna(parsed):
        return ""
    return parsed.isoformat()


def _state_from_location(value: Any) -> str:
    normalized = _normalize_text(str(value or ""))
    if not normalized:
        return ""

    # Explicit state codes beat place names: "Victoria Point QLD" is QLD,
    # not VIC. If several codes occur, the right-most location component wins.
    code_hits: List[tuple[int, str]] = []
    for state in AU_STATE_ALIASES:
        for match in re.finditer(
            rf"(?<![a-z0-9]){re.escape(state.lower())}(?![a-z0-9])",
            normalized,
        ):
            code_hits.append((match.start(), state))
    if code_hits:
        return max(code_hits, key=lambda hit: hit[0])[1]

    # Prefer a long state name in the terminal location component, optionally
    # followed by "Australia", before considering a weaker anywhere match.
    for state, aliases in AU_STATE_ALIASES.items():
        long_aliases = [alias for alias in aliases if len(alias) > 3]
        for alias in long_aliases:
            if re.search(
                rf"(?<![a-z0-9]){re.escape(alias)}(?:\s+australia)?$",
                normalized,
            ):
                return state
    for state, aliases in AU_STATE_ALIASES.items():
        for alias in (alias for alias in aliases if len(alias) > 3):
            if re.search(
                rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])",
                normalized,
            ):
                return state
    return ""


def _filter_audit_frame(df: pd.DataFrame, rows: List[dict]) -> pd.DataFrame:
    columns = list(df.columns) + ["rule", "evidence"]
    return pd.DataFrame(rows, columns=columns) if rows else pd.DataFrame(columns=columns)


def filter_location(
    df: pd.DataFrame,
    requested_location: str,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Reject only provable Australian state mismatches.

    Empty, remote, country-only, and same-state suburb labels stay. This
    tightens obvious interstate noise without pretending we can geocode every
    suburb from a provider label.
    """
    if df.empty or "location" not in df.columns:
        return df.copy(), _filter_audit_frame(df, [])

    requested_state = _state_from_location(requested_location)
    if not requested_state:
        return df.copy(), _filter_audit_frame(df, [])

    keep_idx: List[int] = []
    audit_rows: List[dict] = []
    for idx, row in df.iterrows():
        candidate = str(row.get("location") or "").strip()
        normalized = _normalize_text(candidate)
        candidate_state = _state_from_location(candidate)
        if (
            not candidate
            or "remote" in normalized
            or not candidate_state
            or candidate_state == requested_state
        ):
            keep_idx.append(idx)
            continue

        entry = row.to_dict()
        entry.update(
            {
                "rule": "location_mismatch",
                "evidence": f"requested={requested_state}; found={candidate_state}",
            }
        )
        audit_rows.append(entry)

    return df.loc[keep_idx].copy(), _filter_audit_frame(df, audit_rows)


def filter_listing_age(
    df: pd.DataFrame,
    hours_old: int,
    now: Optional[pd.Timestamp] = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Verify provider freshness when a parseable listing timestamp exists.

    Date-only feeds lose time-of-day, so one extra day is allowed. Unknown
    dates remain eligible instead of being guessed stale.
    """
    if df.empty or "listing_date" not in df.columns or hours_old <= 0:
        return df.copy(), _filter_audit_frame(df, [])

    current = now if now is not None else pd.Timestamp.now(tz="UTC")
    current = pd.to_datetime(current, utc=True)
    cutoff = current - pd.Timedelta(hours=int(hours_old) + 24)
    future_cutoff = current + pd.Timedelta(hours=24)

    keep_idx: List[int] = []
    audit_rows: List[dict] = []
    for idx, row in df.iterrows():
        raw = row.get("listing_date")
        parsed = pd.to_datetime(raw, utc=True, errors="coerce")
        if pd.isna(parsed):
            keep_idx.append(idx)
            continue

        rule = ""
        if parsed < cutoff:
            rule = "listing_too_old"
        elif parsed > future_cutoff:
            rule = "listing_date_in_future"

        if not rule:
            keep_idx.append(idx)
            continue
        entry = row.to_dict()
        entry.update({"rule": rule, "evidence": parsed.isoformat()})
        audit_rows.append(entry)

    return df.loc[keep_idx].copy(), _filter_audit_frame(df, audit_rows)


def filter_job_quality(
    df: pd.DataFrame,
    require_description: bool,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Drop only provable non-job rows; missing JD evidence is fail-open.

    ``require_description`` remains in the compatibility signature for older
    callers. Eligibility rules can exclude only from affirmative evidence, so
    an unavailable description must never become a deletion signal itself.
    """
    _ = require_description
    if df.empty:
        return df.copy(), _filter_audit_frame(df, [])

    keep_idx: List[int] = []
    audit_rows: List[dict] = []
    for idx, row in df.iterrows():
        title = str(row.get("title") or "").strip()
        url = str(row.get("job_url") or "").strip()
        description = str(row.get("description") or "").strip()
        rule = ""
        evidence = ""

        if not re.match(r"(?i)^https?://", url):
            rule, evidence = "invalid_job_url", url[:120]
        elif len(title) < 2 or INVALID_TITLE_RE.match(title):
            rule, evidence = "invalid_job_title", title[:120]
        elif description and INVALID_DESCRIPTION_RE.match(description):
            rule, evidence = "invalid_description", description[:160]
        if not rule:
            keep_idx.append(idx)
            continue
        entry = row.to_dict()
        entry.update({"rule": rule, "evidence": evidence})
        audit_rows.append(entry)

    return df.loc[keep_idx].copy(), _filter_audit_frame(df, audit_rows)


DESCRIPTION_BLOCK_TAGS = {
    "address",
    "article",
    "aside",
    "blockquote",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "main",
    "p",
    "section",
}
DESCRIPTION_CONTAINER_TAGS = {"ol", "table", "tbody", "tfoot", "thead", "ul"}
PARSER_HTML_ENTITIES = {
    "ge": "≥",
    "geq": "≥",
    "le": "≤",
    "leq": "≤",
    "plus": "+",
}


def _replace_html_tags_with_structure(value: str) -> str:
    output: List[str] = []
    cursor = 0
    unit_depth = 0
    row_cell_count = 0

    for match in re.finditer(r"<[^>]*>", value):
        text_between_tags = value[cursor : match.start()]
        if re.search(r"\S", text_between_tags):
            output.append(text_between_tags)
        elif (
            text_between_tags
            and output
            and output[-1]
            and not output[-1][-1].isspace()
        ):
            output.append(" ")
        cursor = match.end()

        raw_tag = match.group(0)
        if raw_tag.startswith("<!"):
            continue
        tag = re.match(
            r"(?is)^<\s*(/?)\s*([a-z][\w:-]*)\b[^>]*?(/?)\s*>$",
            raw_tag,
        )
        if not tag:
            output.append(raw_tag)
            continue

        closing = tag.group(1) == "/"
        name = tag.group(2).lower()
        if closing:
            if name in {"li", "td", "th"}:
                unit_depth = max(0, unit_depth - 1)
            elif name == "tr":
                row_cell_count = 0
            elif name in DESCRIPTION_BLOCK_TAGS or name in DESCRIPTION_CONTAINER_TAGS:
                output.append(" " if unit_depth > 0 else "\n\n")
            continue

        if name == "br":
            output.append(" " if unit_depth > 0 else "\n")
        elif name == "li":
            output.append("; " if unit_depth > 0 else "\n- ")
            unit_depth += 1
        elif name == "tr":
            output.append("\n")
            row_cell_count = 0
        elif name in {"td", "th"}:
            if row_cell_count > 0:
                output.append(" | ")
            row_cell_count += 1
            unit_depth += 1
        elif name in DESCRIPTION_BLOCK_TAGS or name in DESCRIPTION_CONTAINER_TAGS:
            output.append(" " if unit_depth > 0 else "\n\n")

        if tag.group(3) == "/" and name in {"li", "td", "th"}:
            unit_depth = max(0, unit_depth - 1)

    output.append(value[cursor:])
    return "".join(output)


def _decode_parser_html_entities(value: str) -> str:
    def replace_entity(match) -> str:
        return PARSER_HTML_ENTITIES[match.group(1).lower()]

    return re.sub(
        r"(?i)&(geq|leq|plus|ge|le);?(?![a-z0-9_=])",
        replace_entity,
        value,
    )


def _html_to_structured_text(text: str) -> str:
    """Convert one HTML fragment to deterministic, structure-preserving text."""
    if not text:
        return ""
    s = str(text)
    s = re.sub(r"<!--[\s\S]*?-->", "", s)
    s = re.sub(
        r"(?is)<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?</\1\s*>",
        "\n",
        s,
    )
    s = _replace_html_tags_with_structure(s)
    s = unicodedata.normalize("NFKC", unescape(_decode_parser_html_entities(s)))
    s = re.sub(r"[\u2010-\u2015\u2212]", "-", s)
    s = s.replace("\u2028", "\n").replace("\u2029", "\n")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[^\S\n]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _clean_description_text(text: str) -> str:
    if not text:
        return ""
    s = str(text)
    # Normalize common escaped punctuation before preserving HTML blocks.
    s = s.replace("\\+", "+").replace("\\-", "-").replace("\\&", "&")
    s = s.replace("\\/", "/").replace("\\(", "(").replace("\\)", ")")
    s = s.replace("\\_", "_").replace("\\*", "*").replace("\\#", "#")
    s = s.replace("\\'", "'").replace('\\"', '"')
    s = s.replace("\\", "")
    return _html_to_structured_text(s)


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
    return _html_to_structured_text(html_text)


def _find_div_inner_html_by_class(html_text: str, class_name: str) -> str:
    """Return one div's complete inner HTML, including nested divs."""
    for opening in re.finditer(r"(?is)<div\b[^>]*>", html_text):
        class_match = re.search(
            r"(?is)\bclass\s*=\s*([\"'])(.*?)\1",
            opening.group(0),
        )
        if not class_match or class_name not in class_match.group(2).split():
            continue

        depth = 1
        for tag in re.finditer(
            r"(?is)</?div\b[^>]*>",
            html_text[opening.end() :],
        ):
            if tag.group(0).lstrip().startswith("</"):
                depth -= 1
                if depth == 0:
                    return html_text[opening.end() : opening.end() + tag.start()]
            else:
                depth += 1
        return ""
    return ""


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

    linkedin_html = _find_div_inner_html_by_class(
        html_text,
        "show-more-less-html__markup",
    )
    if linkedin_html:
        text = _strip_html(linkedin_html)
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


def _assert_safe_detail_url(
    raw_url: str,
    allowed_hosts: Optional[List[str]] = None,
    resolver=None,
) -> str:
    """Validate one detail-fetch hop before network I/O.

    HTTPS is mandatory. Every DNS answer must be globally routable; one
    loopback/private/link-local/metadata/CGNAT/reserved answer rejects the
    hostname. The check is repeated for every redirect by
    `_request_safe_detail_text`.
    """
    try:
        parts = urlsplit(str(raw_url or "").strip())
        port = parts.port or 443
    except Exception as err:
        raise ValueError("invalid_detail_url") from err

    if parts.scheme.lower() != "https":
        raise ValueError("detail_url_https_required")
    if parts.username or parts.password:
        raise ValueError("detail_url_credentials_forbidden")
    hostname = (parts.hostname or "").rstrip(".").lower()
    if not hostname:
        raise ValueError("detail_url_host_missing")

    if allowed_hosts:
        normalized_hosts = [str(host).rstrip(".").lower() for host in allowed_hosts]
        if not any(
            hostname == host or hostname.endswith(f".{host}")
            for host in normalized_hosts
        ):
            raise ValueError("detail_url_host_not_allowed")

    try:
        literal = ipaddress.ip_address(hostname)
        addresses = [literal]
    except ValueError:
        resolve = resolver or socket.getaddrinfo
        try:
            answers = resolve(hostname, port, type=socket.SOCK_STREAM)
        except Exception as err:
            raise ValueError("detail_url_dns_failed") from err
        addresses = []
        for answer in answers:
            try:
                addresses.append(ipaddress.ip_address(answer[4][0].split("%", 1)[0]))
            except (IndexError, ValueError, TypeError):
                raise ValueError("detail_url_dns_invalid") from None

    if not addresses:
        raise ValueError("detail_url_dns_empty")
    if any(not address.is_global for address in addresses):
        raise ValueError("detail_url_non_public_address")
    return parts.geturl()


def _read_bounded_detail_response(response) -> str:
    declared_raw = str(response.headers.get("content-length", "") or "").strip()
    if declared_raw.isdigit() and int(declared_raw) > MAX_DETAIL_RESPONSE_BYTES:
        raise ValueError("detail_response_too_large")

    chunks = []
    size = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        size += len(chunk)
        if size > MAX_DETAIL_RESPONSE_BYTES:
            raise ValueError("detail_response_too_large")
        chunks.append(chunk)
    encoding = response.encoding or "utf-8"
    return b"".join(chunks).decode(encoding, errors="replace")


def _request_safe_detail_text(
    url: str,
    *,
    timeout_sec: float,
    headers: Dict[str, str],
    proxies: Optional[Dict[str, str]],
    allowed_hosts: Optional[List[str]] = None,
) -> str:
    current = url
    for redirects in range(MAX_DETAIL_URL_REDIRECTS + 1):
        current = _assert_safe_detail_url(current, allowed_hosts=allowed_hosts)
        response = requests.get(
            current,
            timeout=timeout_sec,
            headers=headers,
            proxies=proxies,
            allow_redirects=False,
            stream=True,
        )
        try:
            if response.status_code in (301, 302, 303, 307, 308):
                location = str(response.headers.get("location", "") or "").strip()
                if not location:
                    raise ValueError("detail_redirect_location_missing")
                if redirects >= MAX_DETAIL_URL_REDIRECTS:
                    raise ValueError("detail_redirect_limit")
                current = urljoin(current, location)
                continue
            if response.status_code >= 400:
                raise RuntimeError(f"http_{response.status_code}")
            return _read_bounded_detail_response(response)
        finally:
            response.close()
    raise ValueError("detail_redirect_limit")


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
                allowed_hosts = ["linkedin.com"]
            else:
                detail_url = canonical
                allowed_hosts = None
            response_text = _request_safe_detail_text(
                detail_url,
                timeout_sec=timeout_sec,
                headers=headers,
                proxies=proxies,
                allowed_hosts=allowed_hosts,
            )
            description = _extract_description_from_html(response_text)
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
    return (run or {}).get("status") in ("FAILED", "PARTIAL") and (
        run or {}
    ).get("error") == CANCELLED_ERROR


def _fetch_run_config(base: str, run_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
    cfg_res = requests.get(
        f"{base}/api/fetch-runs/{run_id}/config",
        headers=headers,
        timeout=30,
    )
    cfg_res.raise_for_status()
    return cfg_res.json()["run"]


def _fetch_run_commit_url(base: str, run_id: str) -> str:
    return f"{base}/api/fetch-runs/{run_id}/commit"


def _response_error_code(response: requests.Response) -> str:
    try:
        body = response.json()
    except (TypeError, ValueError):
        return ""
    if not isinstance(body, dict):
        return ""
    direct_code = body.get("code")
    if isinstance(direct_code, str):
        return direct_code
    error = body.get("error")
    if isinstance(error, dict) and isinstance(error.get("code"), str):
        return error["code"]
    return ""


def _read_fetch_run_success(response: requests.Response) -> Dict[str, Any]:
    body = response.json()
    if not isinstance(body, dict) or body.get("ok") is not True:
        raise RuntimeError("fetch-run command returned an invalid success body")
    return body


def _raise_for_fetch_run_conflict(
    response: requests.Response,
    command: Dict[str, Any],
    error_code: str,
) -> None:
    if response.status_code != 409:
        return
    if error_code == "RUN_CANCELLED":
        logger.info(
            "FetchRun cancellation won before command=%s. exiting.",
            command.get("command"),
        )
        raise FetchRunCancelled()
    if error_code not in {
        "EXECUTION_LEASE_HELD",
        "EXECUTION_LEASE_LOST",
        "RUN_ALREADY_TERMINAL",
    }:
        return
    logger.warning(
        "Another FetchRun worker owns the canonical stream "
        "(command=%s code=%s). exiting without changing run state.",
        command.get("command"),
        error_code,
    )
    # SystemExit is intentionally outside the top-level Exception handler, so
    # this duplicate cannot poison the active worker by reporting a failure.
    raise FetchRunSuperseded()


def _fetch_run_response_error(
    response: requests.Response,
    command: Dict[str, Any],
) -> tuple[RuntimeError, bool]:
    error_code = _response_error_code(response)
    _raise_for_fetch_run_conflict(response, command, error_code)
    error = RuntimeError(
        "fetch-run command failed "
        f"status={response.status_code} code={error_code or 'UNKNOWN'} "
        f"body={response.text[:500]}"
    )
    retryable = (
        response.status_code in (408, 425, 429)
        or response.status_code >= 500
    )
    return error, retryable


def _post_fetch_run_command(
    base: str,
    run_id: str,
    headers: Dict[str, str],
    command: Dict[str, Any],
    *,
    timeout: int = 120,
) -> Dict[str, Any]:
    payload = {
        "protocol": FETCH_RUN_COMMIT_PROTOCOL,
        **command,
    }
    response = None
    last_error: Optional[BaseException] = None
    for attempt in range(COMMIT_RETRIES + 1):
        try:
            response = requests.post(
                _fetch_run_commit_url(base, run_id),
                headers=headers,
                json=payload,
                timeout=timeout,
            )
        except requests.RequestException as error:
            last_error = error
            if attempt >= COMMIT_RETRIES:
                raise RuntimeError(
                    f"fetch-run command failed after retries: {error}"
                ) from error
        else:
            if response.ok:
                return _read_fetch_run_success(response)

            last_error, retryable = _fetch_run_response_error(response, command)
            if not retryable or attempt >= COMMIT_RETRIES:
                raise last_error

        time.sleep(2 * (attempt + 1))

    # The loop always returns or raises. This guard keeps the return type honest.
    raise RuntimeError(f"fetch-run command failed: {last_error}")


def _fetch_run_batch_command(
    items: List[Dict[str, Any]],
    *,
    attempt_id: str,
    batch_index: int,
    batch_count: int,
    discovered_count: int,
) -> Dict[str, Any]:
    return {
        "command": "commit",
        "attemptId": attempt_id,
        "batchKey": (
            "batch-empty" if discovered_count == 0 else f"batch-{batch_index:06d}"
        ),
        "batchIndex": batch_index,
        "batchCount": batch_count,
        "items": items,
        "terminal": batch_index == batch_count - 1,
        "discoveredCount": discovered_count,
    }


def _commit_fetch_run_batch(
    base: str,
    run_id: str,
    headers: Dict[str, str],
    items: List[Dict[str, Any]],
    *,
    attempt_id: str,
    batch_index: int,
    batch_count: int,
    discovered_count: int,
) -> Dict[str, Any]:
    return _post_fetch_run_command(
        base,
        run_id,
        headers,
        _fetch_run_batch_command(
            items,
            attempt_id=attempt_id,
            batch_index=batch_index,
            batch_count=batch_count,
            discovered_count=discovered_count,
        ),
    )


def _commit_items(
    base: str,
    run_id: str,
    headers: Dict[str, str],
    items: List[Dict[str, Any]],
    *,
    attempt_id: str,
    batch_size: int = 50,
) -> int:
    if batch_size < 1:
        raise ValueError("batch_size must be positive")
    discovered_count = len(items)
    batch_count = max(1, math.ceil(discovered_count / batch_size))
    if not items:
        result = _commit_fetch_run_batch(
            base,
            run_id,
            headers,
            [],
            attempt_id=attempt_id,
            batch_index=0,
            batch_count=1,
            discovered_count=0,
        )
        return int(result.get("totalImported") or 0)

    total_imported = 0
    for batch_index, offset in enumerate(range(0, discovered_count, batch_size)):
        batch = items[offset : offset + batch_size]
        result = _commit_fetch_run_batch(
            base,
            run_id,
            headers,
            batch,
            attempt_id=attempt_id,
            batch_index=batch_index,
            batch_count=batch_count,
            discovered_count=discovered_count,
        )
        total_imported = int(result.get("totalImported") or 0)
        logger.info(
            "Committed FetchRun batch=%s/%s disposition=%s batchImported=%s totalImported=%s",
            batch_index + 1,
            batch_count,
            result.get("disposition"),
            result.get("batchImported"),
            total_imported,
        )
    return total_imported


def _report_fetch_run_failure(
    base: str,
    run_id: str,
    headers: Dict[str, str],
    attempt_id: str,
    error: BaseException,
) -> None:
    try:
        _post_fetch_run_command(
            base,
            run_id,
            headers,
            {
                "command": "fail",
                "attemptId": attempt_id,
                "error": str(error)[:1900] or "worker_failed",
            },
            timeout=30,
        )
    except (Exception, FetchRunCancelled, FetchRunSuperseded) as report_error:
        logger.warning("Best-effort FetchRun failure report failed: %s", report_error)


def main():
    run_id = os.environ.get("RUN_ID", "").strip()
    if not run_id:
        raise RuntimeError("RUN_ID is not set")

    base = api_base()

    fetch_headers = headers_secret("FETCH_RUN_SECRET", "x-fetch-run-secret")
    attempt_id = os.environ.get("FETCH_RUN_ATTEMPT_ID", "").strip()
    if not attempt_id:
        attempt_id = str(uuid.uuid4())
        os.environ["FETCH_RUN_ATTEMPT_ID"] = attempt_id

    # Claim execution authority before reading or interpreting the config. A
    # duplicate GitHub worker exits here and therefore cannot report an
    # ordinary discovery failure against the canonical worker's run.
    _post_fetch_run_command(
        base,
        run_id,
        fetch_headers,
        {"command": "start", "attemptId": attempt_id},
        timeout=30,
    )

    # Get run config
    run = _fetch_run_config(base, run_id, headers=fetch_headers)
    if _is_cancelled_run(run):
        logger.info("FetchRun already cancelled before start. exiting.")
        sys.exit(0)

    # `config` is the versioned FetchRun execution contract. The queries
    # fallback keeps a rolling deployment compatible with pre-v1 API nodes.
    raw_queries = run.get("config") or run.get("queries") or {}
    if isinstance(raw_queries, list):
        queries = _clean_query_values(raw_queries)
        title_query = queries[0] if queries else ""
        apply_excludes = bool(run.get("filterDescription") if run.get("filterDescription") is not None else True)
        exclude_title_terms: List[str] = []
        exclude_desc_rules: List[str] = []
        source_options: Dict[str, Any] = {}
    elif isinstance(raw_queries, dict):
        raw_title = raw_queries.get("title")
        title_query = raw_title.strip() if isinstance(raw_title, str) else ""
        queries = _clean_query_values(raw_queries.get("queries"))
        if not queries and title_query:
            queries = [title_query]
        apply_excludes = bool(raw_queries.get("applyExcludes", True))
        exclude_title_terms = raw_queries.get("excludeTitleTerms") or []
        exclude_desc_rules = raw_queries.get("excludeDescriptionRules") or []
        source_options = raw_queries.get("sourceOptions") or {}
    else:
        raise RuntimeError("run.queries must be a list or object")
    base_queries = _resolve_base_queries(raw_queries, title_query, queries)
    recall_policy_id = _resolve_au_recall_policy_id(raw_queries)
    apply_recall_policy = recall_policy_id is not None

    # Historical v1 rows retain the legacy GLOBAL vocabulary and balanced
    # strictness. AU v2 bypasses that matcher and uses its versioned evaluator.
    identity_region = "GLOBAL"
    identity_strictness = "balanced"

    location = run.get("location") or "Sydney, New South Wales, Australia"
    hours_old = int(run.get("hoursOld") or 48)
    results_wanted = int(run.get("resultsWanted") or DEFAULT_FULL_FETCH_RESULTS_WANTED)
    include_from_queries = bool(
        run.get("includeFromQueries")
        if run.get("includeFromQueries") is not None
        else True
    )
    if not include_from_queries and isinstance(raw_queries, dict):
        include_from_queries = bool(raw_queries.get("includeFromQueries") or False)
    title_match = _resolve_title_match(run, raw_queries, include_from_queries)
    proxy_pool = _parse_csv_list(os.environ.get("FETCH_PROXY_POOL", ""))

    active_rights_rules, active_experience_rules = (
        _resolve_active_description_rules(
            apply_recall_policy,
            apply_excludes,
            exclude_desc_rules,
        )
    )
    filter_desc = bool(active_rights_rules or active_experience_rules)

    t0 = time.time()
    search_terms = _resolve_search_terms(title_query=title_query, queries=queries)
    results_budget_by_term = _build_results_budget_by_term(search_terms, results_wanted)
    logger.info(
        "Search terms=%s base_queries=%s results_budget_by_term=%s source_options=%s",
        len(search_terms),
        len(base_queries),
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
            enforce_include=(title_match != "off"),
            relaxed_include=(title_match == "relaxed"),
            exclude_terms=exclude_title_terms if apply_excludes else None,
            base_queries=base_queries,
            seniority_policy_id=recall_policy_id,
        )
        logger.info("Rows after title filter: %s", len(df))
        df = keep_columns(df)
        df, location_audit_df = filter_location(df, requested_location=location)
        if not location_audit_df.empty:
            logger.info(
                "filter_location dropped=%s by_rule=%s",
                len(location_audit_df),
                location_audit_df.groupby("rule").size().to_dict(),
            )
        df, date_audit_df = filter_listing_age(df, hours_old=hours_old)
        if not date_audit_df.empty:
            logger.info(
                "filter_listing_age dropped=%s by_rule=%s",
                len(date_audit_df),
                date_audit_df.groupby("rule").size().to_dict(),
            )
        # Clean before description exclusion for more consistent matching
        df = clean_description(df)
        # Phase2 JD backfill — JobSpy's linkedin_fetch_description hits the
        # logged-out job page per row and LinkedIn increasingly answers it with
        # 429/999/login-walls, which JobSpy reports as a SILENT empty
        # description. This backfill re-fetches only the empty rows through the
        # jobs-guest API (a different endpoint with its own rate budget) and
        # must run BEFORE the description filters below: an empty JD would
        # otherwise sail past every rights/experience rule unchecked, and the
        # imported job renders "No description available" in the detail panel.
        empty_before = int((df["description"].astype(str).str.strip() == "").sum())
        if empty_before > 0:
            df = _enrich_descriptions_for_urls(df, proxy_pool=proxy_pool)
            df = clean_description(df)  # normalize backfilled HTML; idempotent
            empty_after = int((df["description"].astype(str).str.strip() == "").sum())
            logger.info(
                "Description coverage: rows=%s empty_before=%s empty_after=%s",
                len(df), empty_before, empty_after,
            )
        if filter_desc:
            # v2 matcher — layered regex + weighted scoring with audit trail.
            # Import errors surface loudly; a silent fallback to the retired
            # legacy regex would downgrade filter quality without warning.
            if active_rights_rules:
                df, audit_df = _filter_description_by_policy(
                    df,
                    recall_policy_id=recall_policy_id,
                    active_rights_rules=active_rights_rules,
                    identity_region=identity_region,
                    identity_strictness=identity_strictness,
                )
                if not audit_df.empty:
                    audit_summary = (
                        audit_df.groupby("rule")["score"].count().to_dict()
                        if "rule" in audit_df.columns
                        else {}
                    )
                    logger.info(
                        "filter_description_policy dropped=%s policy=%s region=%s strictness=%s by_rule=%s",
                        len(audit_df),
                        recall_policy_id or "legacy-v1",
                        identity_region,
                        identity_strictness,
                        audit_summary,
                    )
            if active_experience_rules:
                df, experience_audit_df = filter_experience_requirements(
                    df,
                    rules=active_experience_rules,
                )
                if not experience_audit_df.empty:
                    experience_summary = (
                        experience_audit_df.groupby("rule")["score"].count().to_dict()
                        if "rule" in experience_audit_df.columns
                        else {}
                    )
                    logger.info(
                        "filter_experience_requirements dropped=%s by_rule=%s",
                        len(experience_audit_df),
                        experience_summary,
                    )
            logger.info("Rows after description filter: %s", len(df))
        df, quality_audit_df = filter_job_quality(
            df,
            require_description=filter_desc,
        )
        if not quality_audit_df.empty:
            logger.info(
                "filter_job_quality dropped=%s by_rule=%s",
                len(quality_audit_df),
                quality_audit_df.groupby("rule").size().to_dict(),
            )
        df = dedupe_jobs(df)
        items = df.to_dict(orient="records")

    # The terminal batch and FetchRun completion commit atomically on the server.
    imported = _commit_items(
        base,
        run_id,
        fetch_headers,
        items,
        attempt_id=attempt_id,
    )

    logger.info("Done. imported=%s elapsed=%.1fs", imported, time.time() - t0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Best effort: mark failed (or PARTIAL when prior batches committed).
        try:
            rid = os.environ.get("RUN_ID", "").strip()
            attempt_id = os.environ.get("FETCH_RUN_ATTEMPT_ID", "").strip()
            if rid and attempt_id:
                _report_fetch_run_failure(
                    api_base(),
                    rid,
                    headers_secret("FETCH_RUN_SECRET", "x-fetch-run-secret"),
                    attempt_id,
                    e,
                )
        except Exception:
            pass
        raise
