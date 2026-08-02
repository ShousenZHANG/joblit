"""High-precision Australian eligibility policy A.

The evaluator is intentionally fail-open. A job is excluded only when one
clause contains an explicit applicant gate for Australian citizenship/PR or
an AU government Baseline/NV1/NV2 clearance (including a hard requirement to
be able or eligible to obtain it).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Optional, Sequence

import pandas as pd

try:  # Package-mode tests/imports.
    from .fetch_policy import AU_RECALL_SAFE_V1_POLICY_ID
except ImportError:  # Direct worker script execution from tools/fetcher.
    from fetch_policy import AU_RECALL_SAFE_V1_POLICY_ID


AU_ELIGIBILITY_POLICY_VERSION = AU_RECALL_SAFE_V1_POLICY_ID


@dataclass(frozen=True)
class AuEligibilityEvidence:
    clause: str
    start: int
    end: int


@dataclass(frozen=True)
class AuEligibilityDecision:
    verdict: str
    policy_version: str
    confidence: str
    reason_code: Optional[str] = None
    evidence: Optional[AuEligibilityEvidence] = None


@dataclass(frozen=True)
class _Clause:
    clause: str
    start: int
    end: int
    normalized: str


_CLAUSE_BOUNDARY_RE = re.compile(
    r"(?:[.;!?]+|\r?\n+|[•●▪]+|<\s*br\s*/?>|</(?:li|p)>|\s+\b(?:but|however|whereas|although)\b\s+)",
    re.IGNORECASE,
)

_AU_CITIZEN_TARGET = (
    r"(?:australian\s+citizen(?:s|ship)?(?:\s+status)?|"
    r"citizen(?:s|ship)?(?:\s+or\s+(?:australian\s+)?pr)?\s+of\s+australia"
    r"(?:\s+or\s+(?:new\s+zealand|nz))?)"
)
_AU_PR_TARGET = (
    r"(?:australian\s+permanent\s+residen(?:t|ts|ce|cy)|"
    r"permanent\s+residen(?:t|ts|ce|cy)\s+(?:of|in)\s+australia|"
    r"(?:australian|au|aus)\s+pr(?:\s+(?:holder|status))?|"
    r"pr\s+(?:holder|status)\s+(?:of|in)\s+australia)"
)
_AU_PR_CONJUNCT_TARGET = (
    r"(?:(?:australian\s+)?permanent\s+residen(?:t|ts|ce|cy)|"
    r"(?:australian|au|aus)\s+pr(?:\s+(?:holder|status))?)"
)
_AU_CITIZEN_OR_PR_TARGET = (
    rf"(?:{_AU_CITIZEN_TARGET})(?:\s*(?:(?:/|,)\s*|(?:and|or)\s+)"
    rf"(?:an?\s+)?{_AU_PR_CONJUNCT_TARGET})?"
)
_AU_PR_OR_CITIZEN_TARGET = (
    rf"(?:{_AU_PR_TARGET})(?:\s*(?:(?:/|,)\s*|(?:and|or)\s+)"
    rf"(?:an?\s+)?{_AU_CITIZEN_TARGET})?"
)

_BASELINE_TARGET = (
    r"(?:agsva\s+baseline(?:\s+(?:security\s+)?clearance)?|"
    r"baseline\s+(?:security\s+)?clearance)"
)
_NV1_TARGET = r"(?:nv[\s-]?1|negative\s+vetting\s+1)(?:\s+(?:security\s+)?clearance)?"
_NV2_TARGET = r"(?:nv[\s-]?2|negative\s+vetting\s+2)(?:\s+(?:security\s+)?clearance)?"
_GOVERNMENT_CLEARANCE_TARGET = (
    r"(?:australian\s+government|agsva)(?:\s+security)?\s+clearance"
)
_ANY_AU_CLEARANCE_TARGET = (
    rf"(?:{_BASELINE_TARGET}|{_NV1_TARGET}|{_NV2_TARGET}|{_GOVERNMENT_CLEARANCE_TARGET})"
)

_CANDIDATE_SUBJECT = (
    r"(?:applicants?|candidates?|successful\s+applicants?|successful\s+candidates?|"
    r"the\s+successful\s+(?:applicant|candidate)|you)"
)
_DIRECT_HOLD_VERB = r"(?:be|hold|have|possess|maintain)"
_HARD_POSTFIX = (
    r"(?:required|mandatory|essential|a\s+(?:(?:mandatory|strict|minimum)\s+)?"
    r"(?:condition\s+of\s+employment|prerequisite|"
    r"requirement(?:\s+of\s+(?:this|the)\s+(?:role|position|job))?))"
)
_TARGET_PREFIX = r"(?:either\s+)?(?:an?\s+)?(?:active\s+|current\s+|existing\s+)?"
_ALL_EXPLICIT_GATE_TARGET = (
    rf"(?:{_AU_CITIZEN_OR_PR_TARGET}|{_AU_PR_OR_CITIZEN_TARGET}|"
    rf"{_ANY_AU_CLEARANCE_TARGET})"
)
_KNOWN_GATE_VALUE = rf"{_TARGET_PREFIX}(?:{_ALL_EXPLICIT_GATE_TARGET})\b"
_GATE_CONJUNCTION_TAIL = (
    rf"(?:\s*(?:(?:/|,)\s*|(?:and|or)\s+)"
    rf"(?:(?:be|hold|have|possess|maintain)\s+)?{_KNOWN_GATE_VALUE})*"
)
_GATE_QUALIFIER_TAIL = (
    r"(?:\s+(?:for\s+(?:(?:this|the)\s+(?:role|position|job)|appointment|employment)|"
    r"to\s+(?:apply|be\s+considered|qualify|commence)|"
    r"at\s+(?:the\s+)?(?:time\s+of\s+)?(?:application|appointment|commencement)|"
    r"(?:prior\s+to|before|on)\s+(?:appointment|commencement|starting)|"
    r"throughout\s+(?:employment|the\s+(?:role|position|job))|"
    r"as\s+a\s+condition\s+of\s+employment))?"
)
_CLOSED_GATE_END = rf"{_GATE_CONJUNCTION_TAIL}{_GATE_QUALIFIER_TAIL}\s*$"
_POSTFIX_END = rf"{_GATE_QUALIFIER_TAIL}\s*$"


def _exact(pattern: str) -> re.Pattern:
    return re.compile(pattern, re.IGNORECASE)


def _required_target_patterns(target: str) -> Sequence[re.Pattern]:
    value = rf"{_TARGET_PREFIX}(?:{target})\b"
    return (
        _exact(
            rf"\b{_CANDIDATE_SUBJECT}\s+(?:(?:must|need(?:s)?\s+to|will\s+need\s+to)\s+"
            rf"{_DIRECT_HOLD_VERB}|(?:is|are|will\s+be)\s+required\s+to\s+"
            rf"{_DIRECT_HOLD_VERB})\s+{value}{_CLOSED_GATE_END}"
        ),
        _exact(
            rf"^(?:must|need\s+to|required\s+to|will\s+need\s+to)\s+"
            rf"{_DIRECT_HOLD_VERB}\s+{value}{_CLOSED_GATE_END}"
        ),
        _exact(
            rf"\b{_CANDIDATE_SUBJECT}\s+(?:need(?:s)?|require(?:s)?)\s+"
            rf"{value}{_CLOSED_GATE_END}"
        ),
        _exact(rf"^requires?\s+{value}{_CLOSED_GATE_END}"),
        _exact(
            rf"\b(?:this\s+)?(?:role|position|job)\s+requires?\s+"
            rf"{value}{_CLOSED_GATE_END}"
        ),
        _exact(
            rf"^(?:eligibility|mandatory|required|essential)(?:\s+(?:criteria|requirements?))?"
            rf"\s*:\s*{value}{_CLOSED_GATE_END}"
        ),
        _exact(
            rf"^{value}{_GATE_CONJUNCTION_TAIL}\s+(?:is|are)\s+"
            rf"{_HARD_POSTFIX}\b{_POSTFIX_END}"
        ),
        _exact(
            rf"^{value}{_GATE_CONJUNCTION_TAIL}\s+{_HARD_POSTFIX}\b{_POSTFIX_END}"
        ),
        _exact(
            rf"^{value}{_GATE_CONJUNCTION_TAIL}\s+only"
            rf"(?:\s+(?:may|can)\s+apply)?$"
        ),
        _exact(
            rf"\bonly\s+{value}{_GATE_CONJUNCTION_TAIL}\s+"
            rf"(?:(?:may|can|will)\s+(?:apply|be\s+considered|be\s+eligible)|"
            rf"(?:is|are)\s+eligible\s+to\s+apply)$"
        ),
        _exact(
            rf"\b(?:restricted|limited|only\s+open|only\s+available|open\s+only|"
            rf"available\s+only)\s+to\s+{value}{_CLOSED_GATE_END}"
        ),
        _exact(
            rf"^(?:open|available)\s+to\s+{value}{_GATE_CONJUNCTION_TAIL}\s+only$"
        ),
        _exact(
            rf"^only\s+(?:applicants?|candidates?)\s+who\s+"
            rf"(?:are|hold|have|possess)\s+{value}{_GATE_CONJUNCTION_TAIL}\s+"
            rf"(?:may|can|will)\s+(?:apply|be\s+considered|be\s+eligible)$"
        ),
        _exact(
            rf"^(?:applications?|applicants?)\s+from\s+"
            rf"{value}{_GATE_CONJUNCTION_TAIL}\s+only$"
        ),
        _exact(
            rf"\b{_CANDIDATE_SUBJECT}\b[^,]{{0,50}}\b(?:cannot|will\s+not|won't)\s+"
            rf"be\s+considered\s+without\s+{value}{_CLOSED_GATE_END}"
        ),
    )


_CITIZEN_REQUIRED_RE = _required_target_patterns(_AU_CITIZEN_OR_PR_TARGET)
_PR_REQUIRED_RE = _required_target_patterns(_AU_PR_OR_CITIZEN_TARGET)
_BASELINE_REQUIRED_RE = _required_target_patterns(_BASELINE_TARGET)
_NV1_REQUIRED_RE = _required_target_patterns(_NV1_TARGET)
_NV2_REQUIRED_RE = _required_target_patterns(_NV2_TARGET)
_GOVERNMENT_CLEARANCE_REQUIRED_RE = _required_target_patterns(
    _GOVERNMENT_CLEARANCE_TARGET
)
_INVERSE_CITIZEN_REQUIREMENT_RE = _exact(
    r"^(?:citizenship|citizen)\s+requirement\s*:\s*australian$"
)

_CLEARANCE_VALUE = rf"{_TARGET_PREFIX}(?:{_ANY_AU_CLEARANCE_TARGET})\b"
_CLEARANCE_ACQUISITION = r"obtain(?:\s+and\s+maintain)?"
_CLEARANCE_OBTAIN_RE = (
    _exact(
        rf"\b{_CANDIDATE_SUBJECT}\s+(?:(?:must|need(?:s)?\s+to|will\s+need\s+to)\s+"
        rf"(?:be\s+)?|(?:is|are|will\s+be)\s+required\s+to\s+(?:be\s+)?)"
        rf"(?:eligible|able|willing)\s+(?:to\s+{_CLEARANCE_ACQUISITION}|for)\s+"
        rf"{_CLEARANCE_VALUE}{_CLOSED_GATE_END}"
    ),
    _exact(
        rf"^(?:must|need\s+to|required\s+to|will\s+need\s+to)\s+(?:be\s+)?"
        rf"(?:eligible|able|willing)\s+(?:to\s+{_CLEARANCE_ACQUISITION}|for)\s+"
        rf"{_CLEARANCE_VALUE}{_CLOSED_GATE_END}"
    ),
    _exact(
        rf"^(?:the\s+)?(?:ability|eligibility)\s+to\s+{_CLEARANCE_ACQUISITION}\s+"
        rf"{_CLEARANCE_VALUE}\s+(?:is\s+)?{_HARD_POSTFIX}\b{_POSTFIX_END}"
    ),
    _exact(
        rf"\b(?:this\s+)?(?:role|position|job)\s+requires?\s+(?:the\s+)?"
        rf"(?:ability|eligibility)\s+to\s+{_CLEARANCE_ACQUISITION}\s+"
        rf"{_CLEARANCE_VALUE}{_CLOSED_GATE_END}"
    ),
    _exact(
        rf"^eligibility\s*:\s*(?:the\s+)?(?:ability|eligibility)\s+to\s+"
        rf"{_CLEARANCE_ACQUISITION}\s+{_CLEARANCE_VALUE}{_CLOSED_GATE_END}"
    ),
    _exact(
        rf"^(?:must|required\s+to|need\s+to)\s+{_CLEARANCE_ACQUISITION}\s+"
        rf"{_CLEARANCE_VALUE}{_CLOSED_GATE_END}"
    ),
    _exact(
        rf"\b{_CANDIDATE_SUBJECT}\s+(?:(?:must|need(?:s)?\s+to|will\s+need\s+to)\s+|"
        rf"(?:is|are|will\s+be)\s+required\s+to\s+){_CLEARANCE_ACQUISITION}\s+"
        rf"{_CLEARANCE_VALUE}{_CLOSED_GATE_END}"
    ),
    _exact(
        rf"^(?:must|required\s+to|need\s+to)\s+hold\s+or\s+be\s+"
        rf"(?:eligible|able|willing)\s+to\s+{_CLEARANCE_ACQUISITION}\s+"
        rf"{_CLEARANCE_VALUE}{_CLOSED_GATE_END}"
    ),
)


def _utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def _split_clauses(description: str) -> list[_Clause]:
    clauses: list[_Clause] = []
    cursor = 0

    def push(start: int, end: int) -> None:
        raw = description[start:end]
        leading = len(raw) - len(raw.lstrip())
        trailing = len(raw) - len(raw.rstrip())
        trimmed_start = start + leading
        trimmed_end = max(trimmed_start, end - trailing)
        clause = description[trimmed_start:trimmed_end]
        if not clause:
            return
        normalized = unicodedata.normalize("NFKC", clause)
        normalized = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", normalized)).strip().lower()
        normalized = re.sub(r"&(?:nbsp|amp|quot|apos);", " ", normalized, flags=re.IGNORECASE)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        # A contrast boundary begins before "but/however" and can leave a
        # comma on the preceding clause. Strip it only from the matching view;
        # the original clause and UTF-16 evidence offsets remain untouched.
        normalized = re.sub(r"[,;:]\s*$", "", normalized)
        if normalized:
            clauses.append(
                _Clause(
                    clause=clause,
                    start=_utf16_length(description[:trimmed_start]),
                    end=_utf16_length(description[:trimmed_end]),
                    normalized=normalized,
                )
            )

    for match in _CLAUSE_BOUNDARY_RE.finditer(description):
        push(cursor, match.start())
        cursor = match.end()
    push(cursor, len(description))
    return clauses


def _matches_any(value: str, patterns: Sequence[re.Pattern]) -> bool:
    return any(pattern.search(value) for pattern in patterns)


def _excluded(clause: _Clause, reason_code: str) -> AuEligibilityDecision:
    return AuEligibilityDecision(
        verdict="EXCLUDE",
        policy_version=AU_ELIGIBILITY_POLICY_VERSION,
        confidence="EXPLICIT",
        reason_code=reason_code,
        evidence=AuEligibilityEvidence(
            clause=clause.clause,
            start=clause.start,
            end=clause.end,
        ),
    )


def _kept() -> AuEligibilityDecision:
    return AuEligibilityDecision(
        verdict="KEEP",
        policy_version=AU_ELIGIBILITY_POLICY_VERSION,
        confidence="NONE",
    )


def evaluate_au_eligibility(
    description: Optional[str],
    *,
    identity_requirement: bool = True,
    clearance_requirement: bool = True,
) -> AuEligibilityDecision:
    """Evaluate policy A without turning ambiguous text into a deletion."""

    if not description or not description.strip():
        return _kept()
    if not identity_requirement and not clearance_requirement:
        return _kept()

    for clause in _split_clauses(description):
        if identity_requirement:
            if _INVERSE_CITIZEN_REQUIREMENT_RE.search(clause.normalized):
                return _excluded(clause, "AU_CITIZEN_REQUIRED")
            if _matches_any(clause.normalized, _CITIZEN_REQUIRED_RE):
                return _excluded(clause, "AU_CITIZEN_REQUIRED")
            if _matches_any(clause.normalized, _PR_REQUIRED_RE):
                return _excluded(clause, "AU_PR_REQUIRED")

        if clearance_requirement:
            if _matches_any(clause.normalized, _CLEARANCE_OBTAIN_RE):
                return _excluded(clause, "AU_CLEARANCE_OBTAIN_REQUIRED")
            if _matches_any(clause.normalized, _BASELINE_REQUIRED_RE):
                return _excluded(clause, "AU_BASELINE_REQUIRED")
            if _matches_any(clause.normalized, _NV1_REQUIRED_RE):
                return _excluded(clause, "AU_NV1_REQUIRED")
            if _matches_any(clause.normalized, _NV2_REQUIRED_RE):
                return _excluded(clause, "AU_NV2_REQUIRED")
            if _matches_any(clause.normalized, _GOVERNMENT_CLEARANCE_REQUIRED_RE):
                return _excluded(clause, "AU_GOV_CLEARANCE_REQUIRED")

    return _kept()


def filter_au_eligibility_policy(
    df: pd.DataFrame,
    *,
    identity_requirement: bool = True,
    clearance_requirement: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Apply the immutable AU v2 policy and return kept rows plus evidence.

    This facade is deliberately separate from ``rights_filter``. That module
    preserves historical v1 execution semantics, while this function is the
    only dataframe boundary for the recall-safe v2 policy.
    """

    audit_columns = list(df.columns) + ["rule", "score", "evidence", "snippet"]
    if df.empty or "description" not in df.columns:
        return df.copy(), pd.DataFrame(columns=audit_columns)

    keep_indexes: list[object] = []
    audit_rows: list[dict] = []
    for index, row in df.iterrows():
        raw_description = row["description"]
        description = "" if pd.isna(raw_description) else str(raw_description)
        decision = evaluate_au_eligibility(
            description,
            identity_requirement=identity_requirement,
            clearance_requirement=clearance_requirement,
        )
        if decision.verdict != "EXCLUDE" or decision.evidence is None:
            keep_indexes.append(index)
            continue

        rule_prefix = (
            "identity_requirement"
            if decision.reason_code in {"AU_CITIZEN_REQUIRED", "AU_PR_REQUIRED"}
            else "clearance_requirement"
        )
        evidence = decision.evidence.clause
        audit_row = row.to_dict()
        audit_row.update(
            {
                "rule": f"{rule_prefix}.{decision.reason_code}",
                "score": 100,
                "evidence": evidence,
                "snippet": evidence,
            }
        )
        audit_rows.append(audit_row)

    kept = df.loc[keep_indexes].copy()
    audit = (
        pd.DataFrame(audit_rows, columns=audit_columns)
        if audit_rows
        else pd.DataFrame(columns=audit_columns)
    )
    return kept, audit
