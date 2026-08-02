"""Fail-open senior-title policy for the AU Fetch Pipeline.

The public interface deliberately accepts only the visible title. Source
metadata such as ``job_level`` is not trustworthy enough to remove a role.
The shared JSON corpus holds this implementation and the TypeScript one to the
same observable outcome and rule id.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Callable, Literal, Optional, TypedDict


class TitleSeniorityDecision(TypedDict):
    outcome: Literal["KEEP", "EXCLUDE"]
    ruleId: str
    evidence: Optional[str]


EXPLICIT_ROLE_PHRASES = (
    ("analyst",),
    ("architect",),
    ("consultant",),
    ("designer",),
    ("developer",),
    ("engineer",),
    ("researcher",),
    ("scientist",),
    ("specialist",),
    ("business", "analyst"),
    ("cloud", "architect"),
    ("cloud", "engineer"),
    ("data", "analyst"),
    ("data", "engineer"),
    ("data", "scientist"),
    ("devops", "engineer"),
    ("platform", "engineer"),
    ("product", "designer"),
    ("qa", "engineer"),
    ("security", "engineer"),
    ("software", "architect"),
    ("software", "developer"),
    ("software", "engineer"),
    ("solutions", "architect"),
    ("systems", "engineer"),
    ("technical", "consultant"),
)

EXPLICIT_ROLE_NOUNS = {
    "analyst",
    "architect",
    "consultant",
    "designer",
    "developer",
    "engineer",
    "researcher",
    "scientist",
    "specialist",
}

LEAD_FUNCTION_SUFFIXES = {
    "capability",
    "chapter",
    "data",
    "delivery",
    "design",
    "discipline",
    "engineering",
    "platform",
    "practice",
    "product",
    "program",
    "project",
    "security",
    "software",
    "team",
    "tech",
    "technical",
    "technology",
}

MANAGER_FUNCTIONS = {
    "account",
    "change",
    "configuration",
    "customer",
    "data",
    "delivery",
    "development",
    "engineering",
    "environment",
    "finance",
    "implementation",
    "incident",
    "infrastructure",
    "marketing",
    "operations",
    "people",
    "platform",
    "portfolio",
    "practice",
    "product",
    "program",
    "project",
    "quality",
    "release",
    "sales",
    "security",
    "service",
    "services",
    "software",
    "success",
    "support",
    "team",
    "technical",
    "technology",
    "test",
}

HEAD_FUNCTIONS = {
    "chapter",
    "data",
    "department",
    "development",
    "engineering",
    "function",
    "infrastructure",
    "platform",
    "practice",
    "product",
    "security",
    "software",
    "team",
    "technical",
    "technology",
}

ARCHITECT_EARLY_CAREER_TOKENS = {
    "associate",
    "entry",
    "graduate",
    "intern",
    "jr",
    "junior",
    "trainee",
}

CONFLICT_EARLY_CAREER_TOKENS = {
    "entry",
    "graduate",
    "intern",
    "jr",
    "junior",
    "trainee",
}

LEVEL_SUFFIXES = {"i", "ii", "iii", "iv", "1", "2", "3", "4"}

# Positive grammar for terms whose technical/everyday meanings are too broad
# to exclude by token alone. Unknown modifier paths deliberately fail open.
LEVELLED_ROLE_NOUNS = {
    "administrator",
    "analyst",
    "architect",
    "consultant",
    "coordinator",
    "designer",
    "developer",
    "director",
    "engineer",
    "investigator",
    "manager",
    "officer",
    "owner",
    "programmer",
    "researcher",
    "scientist",
    "specialist",
    "technician",
}

LEVELLED_ROLE_MODIFIERS = {
    "ai",
    "android",
    "application",
    "applications",
    "associate",
    "backend",
    "business",
    "c",
    "cloud",
    "cyber",
    "cybersecurity",
    "data",
    "database",
    "devsecops",
    "devops",
    "digital",
    "embedded",
    "engineering",
    "enterprise",
    "frontend",
    "full",
    "infrastructure",
    "integration",
    "ios",
    "it",
    "java",
    "learning",
    "machine",
    "ml",
    "mobile",
    "net",
    "network",
    "platform",
    "product",
    "python",
    "qa",
    "react",
    "reliability",
    "research",
    "security",
    "site",
    "software",
    "solution",
    "solutions",
    "stack",
    "system",
    "systems",
    "technical",
    "test",
    "web",
}

MAX_LEVELLED_ROLE_MODIFIERS = 3

ALL_EXCLUSION_RULES = {
    "TITLE_SENIOR",
    "TITLE_PRINCIPAL",
    "TITLE_LEAD",
    "TITLE_STAFF",
    "TITLE_MANAGER",
    "TITLE_DIRECTOR",
    "TITLE_HEAD",
    "TITLE_ARCHITECT",
    "TITLE_EXECUTIVE",
}

LEGACY_TERM_RULE = {
    "senior": "TITLE_SENIOR",
    "sr": "TITLE_SENIOR",
    "snr": "TITLE_SENIOR",
    "principal": "TITLE_PRINCIPAL",
    "lead": "TITLE_LEAD",
    "staff": "TITLE_STAFF",
    "manager": "TITLE_MANAGER",
    "director": "TITLE_DIRECTOR",
    "head": "TITLE_HEAD",
    "architect": "TITLE_ARCHITECT",
    "chief": "TITLE_EXECUTIVE",
    "vp": "TITLE_EXECUTIVE",
    "vice president": "TITLE_EXECUTIVE",
    "distinguished": "TITLE_EXECUTIVE",
}

SENIOR_ALIASES = {"senior", "sr", "snr"}


class _Token(TypedDict):
    value: str
    start: int
    end: int


def _normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).lower()


def _tokenize(value: str) -> list[_Token]:
    return [
        {"value": match.group(0), "start": match.start(), "end": match.end()}
        for match in re.finditer(r"[a-z0-9]+", value)
    ]


def _phrase_at(tokens: list[_Token], start: int, phrase: tuple[str, ...]) -> bool:
    if start < 0 or start + len(phrase) > len(tokens):
        return False
    return all(tokens[start + offset]["value"] == part for offset, part in enumerate(phrase))


def _matches_explicit_role_at(tokens: list[_Token], start: int) -> bool:
    return any(
        _phrase_at(tokens, start, phrase) for phrase in EXPLICIT_ROLE_PHRASES
    )


def _has_structural_separator_after(
    normalized_title: str,
    token: _Token,
    next_token: Optional[_Token],
) -> bool:
    if next_token is None:
        return False
    return bool(
        re.search(r"[,/|:;–—-]", normalized_title[token["end"] : next_token["start"]])
    )


def _alias_enabled(
    rule_id: str,
    alias: str,
    enabled_aliases: Optional[dict[str, set[str]]],
) -> bool:
    aliases = enabled_aliases.get(rule_id) if enabled_aliases is not None else None
    return aliases is None or alias in aliases


def _exclude(rule_id: str, evidence: str) -> TitleSeniorityDecision:
    return {"outcome": "EXCLUDE", "ruleId": rule_id, "evidence": evidence}


def _ambiguous(evidence: str) -> TitleSeniorityDecision:
    return {
        "outcome": "KEEP",
        "ruleId": "TITLE_AMBIGUOUS_FAIL_OPEN",
        "evidence": evidence,
    }


class _RuleContext(TypedDict):
    normalized_title: str
    tokens: list[_Token]
    has_early_career_conflict: bool
    enabled_aliases: Optional[dict[str, set[str]]]


_RuleEvaluator = Callable[[_RuleContext], Optional[TitleSeniorityDecision]]


def _first_ambiguous(evidence: Optional[str]) -> Optional[TitleSeniorityDecision]:
    return _ambiguous(evidence) if evidence else None


def _has_structural_separator_before(
    normalized_title: str,
    previous_token: Optional[_Token],
    token: _Token,
) -> bool:
    if previous_token is None:
        return False
    between = normalized_title[previous_token["end"] : token["start"]]
    return bool(re.search(r"[,/|:;–—()\[\]-]", between))


def _matches_levelled_role_prefix(tokens: list[_Token], level_index: int) -> bool:
    cursor = level_index + 1
    if cursor < len(tokens) and tokens[cursor]["value"] in LEVELLED_ROLE_NOUNS:
        return True

    modifier_count = 0
    while (
        cursor < len(tokens)
        and modifier_count < MAX_LEVELLED_ROLE_MODIFIERS
        and tokens[cursor]["value"] in LEVELLED_ROLE_MODIFIERS
    ):
        cursor += 1
        modifier_count += 1
    return (
        modifier_count > 0
        and cursor < len(tokens)
        and tokens[cursor]["value"] in LEVELLED_ROLE_NOUNS
    )


def _matches_levelled_role_suffix(
    normalized_title: str,
    tokens: list[_Token],
    level_index: int,
) -> bool:
    if level_index == 0:
        return False
    previous = tokens[level_index - 1]
    if (
        previous["value"] not in LEVELLED_ROLE_NOUNS
        or not _has_structural_separator_before(
            normalized_title,
            previous,
            tokens[level_index],
        )
    ):
        return False
    return all(
        token["value"] in LEVEL_SUFFIXES for token in tokens[level_index + 1 :]
    )


def _matches_levelled_role_at(context: _RuleContext, level_index: int) -> bool:
    return _matches_levelled_role_prefix(context["tokens"], level_index) or (
        _matches_levelled_role_suffix(
            context["normalized_title"],
            context["tokens"],
            level_index,
        )
    )


def _evaluate_executive_rule(
    context: _RuleContext,
) -> Optional[TitleSeniorityDecision]:
    for index, token in enumerate(context["tokens"]):
        value = token["value"]
        if value in {"chief", "vp", "distinguished"} and _alias_enabled(
            "TITLE_EXECUTIVE", value, context["enabled_aliases"]
        ):
            return (
                _ambiguous(value)
                if context["has_early_career_conflict"]
                else _exclude("TITLE_EXECUTIVE", value)
            )
        if (
            value == "vice"
            and index + 1 < len(context["tokens"])
            and context["tokens"][index + 1]["value"] == "president"
            and _alias_enabled(
                "TITLE_EXECUTIVE",
                "vice president",
                context["enabled_aliases"],
            )
        ):
            return (
                _ambiguous("vice president")
                if context["has_early_career_conflict"]
                else _exclude("TITLE_EXECUTIVE", "vice president")
            )
    return None


def _evaluate_director_rule(
    context: _RuleContext,
) -> Optional[TitleSeniorityDecision]:
    for token in context["tokens"]:
        if token["value"] == "director" and _alias_enabled(
            "TITLE_DIRECTOR", token["value"], context["enabled_aliases"]
        ):
            return (
                _ambiguous(token["value"])
                if context["has_early_career_conflict"]
                else _exclude("TITLE_DIRECTOR", token["value"])
            )
    return None


def _evaluate_head_rule(context: _RuleContext) -> Optional[TitleSeniorityDecision]:
    ambiguous_evidence: Optional[str] = None
    tokens = context["tokens"]
    for index, token in enumerate(tokens):
        if token["value"] != "head" or not _alias_enabled(
            "TITLE_HEAD", token["value"], context["enabled_aliases"]
        ):
            continue
        if context["has_early_career_conflict"]:
            ambiguous_evidence = ambiguous_evidence or token["value"]
            continue
        previous = tokens[index - 1]["value"] if index > 0 else None
        next_value = tokens[index + 1]["value"] if index + 1 < len(tokens) else None
        if (
            next_value == "of"
            or (index == 0 and next_value in HEAD_FUNCTIONS)
            or (index == len(tokens) - 1 and previous in HEAD_FUNCTIONS)
        ):
            return _exclude("TITLE_HEAD", token["value"])
        ambiguous_evidence = ambiguous_evidence or token["value"]
    return _first_ambiguous(ambiguous_evidence)


def _evaluate_principal_rule(
    context: _RuleContext,
) -> Optional[TitleSeniorityDecision]:
    ambiguous_evidence: Optional[str] = None
    for index, token in enumerate(context["tokens"]):
        if token["value"] != "principal" or not _alias_enabled(
            "TITLE_PRINCIPAL", token["value"], context["enabled_aliases"]
        ):
            continue
        suffix = context["normalized_title"][token["end"] :]
        if re.match(r"^\s*['’]s\b", suffix):
            ambiguous_evidence = ambiguous_evidence or "principal's"
            continue
        if (
            context["has_early_career_conflict"]
            or not _matches_levelled_role_at(context, index)
        ):
            ambiguous_evidence = ambiguous_evidence or token["value"]
            continue
        return _exclude("TITLE_PRINCIPAL", token["value"])
    return _first_ambiguous(ambiguous_evidence)


def _evaluate_manager_rule(
    context: _RuleContext,
) -> Optional[TitleSeniorityDecision]:
    ambiguous_evidence: Optional[str] = None
    tokens = context["tokens"]
    for index, token in enumerate(tokens):
        if token["value"] != "manager" or not _alias_enabled(
            "TITLE_MANAGER", token["value"], context["enabled_aliases"]
        ):
            continue
        if context["has_early_career_conflict"]:
            ambiguous_evidence = ambiguous_evidence or token["value"]
            continue
        previous = tokens[index - 1]["value"] if index > 0 else None
        next_token = tokens[index + 1] if index + 1 < len(tokens) else None
        next_value = next_token["value"] if next_token is not None else None
        has_only_level_suffix = all(
            part["value"] in LEVEL_SUFFIXES for part in tokens[index + 1 :]
        )
        manager_of_function = (
            next_value == "of"
            and index + 2 < len(tokens)
            and tokens[index + 2]["value"] in MANAGER_FUNCTIONS
        )
        separated_function = (
            next_value in MANAGER_FUNCTIONS
            and _has_structural_separator_after(
                context["normalized_title"], token, next_token
            )
        )
        if (
            (previous in MANAGER_FUNCTIONS and has_only_level_suffix)
            or manager_of_function
            or separated_function
        ):
            return _exclude("TITLE_MANAGER", token["value"])
        ambiguous_evidence = ambiguous_evidence or token["value"]
    return _first_ambiguous(ambiguous_evidence)


def _evaluate_architect_rule(
    context: _RuleContext,
) -> Optional[TitleSeniorityDecision]:
    ambiguous_evidence: Optional[str] = None
    has_early_career_architect = any(
        token["value"] in ARCHITECT_EARLY_CAREER_TOKENS
        for token in context["tokens"]
    )
    for token in context["tokens"]:
        if token["value"] != "architect" or not _alias_enabled(
            "TITLE_ARCHITECT", token["value"], context["enabled_aliases"]
        ):
            continue
        if has_early_career_architect:
            ambiguous_evidence = ambiguous_evidence or token["value"]
            continue
        return _exclude("TITLE_ARCHITECT", token["value"])
    return _first_ambiguous(ambiguous_evidence)


def _evaluate_staff_rule(context: _RuleContext) -> Optional[TitleSeniorityDecision]:
    ambiguous_evidence: Optional[str] = None
    tokens = context["tokens"]
    for index, token in enumerate(tokens):
        if token["value"] != "staff" or not _alias_enabled(
            "TITLE_STAFF", token["value"], context["enabled_aliases"]
        ):
            continue
        if context["has_early_career_conflict"]:
            ambiguous_evidence = ambiguous_evidence or token["value"]
            continue
        previous = tokens[index - 1]["value"] if index > 0 else None
        if (
            (index == 0 and _matches_explicit_role_at(tokens, index + 1))
            or (index == len(tokens) - 1 and previous in EXPLICIT_ROLE_NOUNS)
        ):
            return _exclude("TITLE_STAFF", token["value"])
        ambiguous_evidence = ambiguous_evidence or token["value"]
    return _first_ambiguous(ambiguous_evidence)


def _evaluate_lead_rule(context: _RuleContext) -> Optional[TitleSeniorityDecision]:
    ambiguous_evidence: Optional[str] = None
    tokens = context["tokens"]
    for index, token in enumerate(tokens):
        if token["value"] != "lead" or not _alias_enabled(
            "TITLE_LEAD", token["value"], context["enabled_aliases"]
        ):
            continue
        if context["has_early_career_conflict"]:
            ambiguous_evidence = ambiguous_evidence or token["value"]
            continue
        previous = tokens[index - 1]["value"] if index > 0 else None
        if (
            (index == 0 and _matches_explicit_role_at(tokens, index + 1))
            or previous in LEAD_FUNCTION_SUFFIXES
        ):
            return _exclude("TITLE_LEAD", token["value"])
        ambiguous_evidence = ambiguous_evidence or token["value"]
    return _first_ambiguous(ambiguous_evidence)


def _evaluate_senior_rule(
    context: _RuleContext,
) -> Optional[TitleSeniorityDecision]:
    ambiguous_evidence: Optional[str] = None
    for index, token in enumerate(context["tokens"]):
        value = token["value"]
        if value not in SENIOR_ALIASES or not _alias_enabled(
            "TITLE_SENIOR", value, context["enabled_aliases"]
        ):
            continue
        if (
            context["has_early_career_conflict"]
            or not _matches_levelled_role_at(context, index)
        ):
            ambiguous_evidence = ambiguous_evidence or value
            continue
        return _exclude("TITLE_SENIOR", value)
    return _first_ambiguous(ambiguous_evidence)


_RULE_EVALUATORS: tuple[tuple[str, _RuleEvaluator], ...] = (
    ("TITLE_EXECUTIVE", _evaluate_executive_rule),
    ("TITLE_DIRECTOR", _evaluate_director_rule),
    ("TITLE_HEAD", _evaluate_head_rule),
    ("TITLE_PRINCIPAL", _evaluate_principal_rule),
    ("TITLE_MANAGER", _evaluate_manager_rule),
    ("TITLE_ARCHITECT", _evaluate_architect_rule),
    ("TITLE_STAFF", _evaluate_staff_rule),
    ("TITLE_LEAD", _evaluate_lead_rule),
    ("TITLE_SENIOR", _evaluate_senior_rule),
)


def _evaluate_title_seniority_with_rules(
    title: str,
    enabled_rules: set[str],
    enabled_aliases: Optional[dict[str, set[str]]] = None,
) -> TitleSeniorityDecision:
    normalized_title = _normalize(title)
    tokens = _tokenize(normalized_title)
    context: _RuleContext = {
        "normalized_title": normalized_title,
        "tokens": tokens,
        "has_early_career_conflict": any(
            token["value"] in CONFLICT_EARLY_CAREER_TOKENS for token in tokens
        ),
        "enabled_aliases": enabled_aliases,
    }
    ambiguous_evidence: Optional[str] = None

    for rule_id, evaluator in _RULE_EVALUATORS:
        if rule_id not in enabled_rules:
            continue
        decision = evaluator(context)
        if decision is None:
            continue
        if decision["outcome"] == "EXCLUDE":
            return decision
        ambiguous_evidence = ambiguous_evidence or decision["evidence"]

    if ambiguous_evidence:
        return _ambiguous(ambiguous_evidence)
    return {"outcome": "KEEP", "ruleId": "TITLE_ALLOWED", "evidence": None}


AU_RECALL_SAFE_V1_TITLE_POLICY_ID = "au-recall-safe-v1"


def _evaluate_au_recall_safe_v1_title(title: str) -> TitleSeniorityDecision:
    """Immutable evaluator for the persisted AU recall-safe v1 contract."""

    return _evaluate_title_seniority_with_rules(title, ALL_EXCLUSION_RULES)


_TITLE_POLICY_EVALUATORS = {
    AU_RECALL_SAFE_V1_TITLE_POLICY_ID: _evaluate_au_recall_safe_v1_title,
}


def evaluate_title_seniority_for_policy(
    title: str,
    policy_id: str,
) -> TitleSeniorityDecision:
    """Dispatch a visible title through its persisted immutable policy id."""

    evaluator = _TITLE_POLICY_EVALUATORS.get(policy_id)
    if evaluator is None:
        raise ValueError(f"Unsupported title seniority policy: {policy_id}")
    return evaluator(title)


def _normalized_legacy_term(term: str) -> str:
    return " ".join(token["value"] for token in _tokenize(_normalize(term)))


def _contains_custom_term(title: str, raw_term: str) -> bool:
    normalized_title = _normalize(title)
    title_tokens = [token["value"] for token in _tokenize(normalized_title)]
    term_tokens = [token["value"] for token in _tokenize(_normalize(raw_term))]
    if not term_tokens:
        term = _normalize(raw_term).strip()
        return bool(term) and term in normalized_title
    return any(
        title_tokens[start : start + len(term_tokens)] == term_tokens
        for start in range(0, len(title_tokens) - len(term_tokens) + 1)
    )


def evaluate_legacy_title_exclusions(
    title: str,
    configured_terms: list[str],
) -> TitleSeniorityDecision:
    """Apply a persisted v1 term list without widening its configured rules."""

    enabled_rules: set[str] = set()
    enabled_aliases: dict[str, set[str]] = {}
    custom_terms: list[str] = []
    for raw_term in configured_terms:
        term = _normalized_legacy_term(raw_term)
        if not term:
            continue
        rule = LEGACY_TERM_RULE.get(term)
        if rule:
            enabled_rules.add(rule)
            enabled_aliases.setdefault(rule, set()).add(term)
        else:
            custom_terms.append(raw_term)

    seniority_decision = _evaluate_title_seniority_with_rules(
        title,
        enabled_rules,
        enabled_aliases,
    )
    if seniority_decision["outcome"] == "EXCLUDE":
        return seniority_decision

    for custom_term in custom_terms:
        if _contains_custom_term(title, custom_term):
            return _exclude("TITLE_CUSTOM", _normalize(custom_term).strip())
    return seniority_decision
