"""
ExclusionMatcher — layered regex + scoring pipeline for filtering job
descriptions that require applicants to be a citizen / PR / green card
holder / ILR / etc. across multiple regions.

Architecture (see tools/fetcher/rights_rules.json):
  Layer A — Hard anchors (`must be`, `required`, `only open to`, …)
  Layer B — Region identity tokens (AU / US / CA / UK / NZ / EU)
  Layer C — Proximity: anchor within N chars of identity token
  Layer D — Negation guards (`does not require`, `regardless of`, …)
  Layer E — Soft-invite whitelist (`citizens of the world welcome`, …)
  Layer F — Weighted scorer; threshold by strictness
  Layer G — Standalone regional tokens (Five Eyes)
  Layer H — Global hard patterns (`X citizens only`, `legally authorized …`)
  Layer I — Sponsorship phrases (`no sponsorship now or in the future`)
  Layer J — Clearance tokens (NV1/NV2/TS-SCI/Baseline)

Every drop returns a `MatchResult` with evidence + snippet so the UI can
surface WHY a row was filtered (audit drawer).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import pandas as pd

RULES_PATH = Path(__file__).parent / "rights_rules.json"

_STRICTNESS = ("strict", "balanced", "loose")
_VALID_REGIONS = ("AU", "US", "CA", "UK", "NZ", "EU", "GLOBAL")


@dataclass
class MatchResult:
    dropped: bool
    score: int
    rule: str
    region: str
    evidence: List[str] = field(default_factory=list)
    snippet: str = ""


class ExclusionMatcher:
    def __init__(
        self,
        region: str = "GLOBAL",
        strictness: str = "balanced",
        rules: Optional[Sequence[str]] = None,
        rules_path: Optional[Path] = None,
    ) -> None:
        if strictness not in _STRICTNESS:
            raise ValueError(f"strictness must be one of {_STRICTNESS}, got {strictness!r}")
        if region not in _VALID_REGIONS:
            raise ValueError(f"region must be one of {_VALID_REGIONS}, got {region!r}")

        self.region = region
        self.strictness = strictness
        self.rules = set(rules) if rules is not None else {"identity_requirement"}
        self._config = json.loads(Path(rules_path or RULES_PATH).read_text(encoding="utf-8"))
        self._compile()

    # ── Compilation ─────────────────────────────────────────────────────

    def _compile(self) -> None:
        cfg = self._config

        # Anchors — balanced baseline + strict extras
        anchors = list(cfg["hard_anchors"])
        if self.strictness == "strict":
            anchors.extend(cfg.get("strict_only_anchors", []))
        self._anchor_re = self._compile_union(anchors)

        self._negation_re = self._compile_union(cfg["negation_guards"])
        self._soft_invite_re = self._compile_union(cfg["soft_invite"])

        region_cfg = cfg["regions"].get(self.region, {"tokens": [], "standalone_tokens": []})
        self._region_token_re = self._compile_union(region_cfg.get("tokens", []))
        self._region_standalone_re = self._compile_union(region_cfg.get("standalone_tokens", []))

        self._generic_token_re = self._compile_union(cfg["generic_tokens"])
        self._global_hard_re = self._compile_union(cfg["global_hard_patterns"])
        self._sponsorship_re = self._compile_union(cfg["sponsorship_phrases"])
        self._clearance_re = self._compile_union(cfg["clearance_tokens"])

        self._local_only_re = re.compile(
            r"(?i)\blocal\s+(?:candidates|applicants)\s+only\b"
        )
        self._remote_hint_re = re.compile(r"(?i)\b(?:remote|hybrid|work\s+from\s+home|wfh)\b")

        self._weights = cfg["scoring_weights"]
        self._thresholds = cfg["strictness_thresholds"]
        self._proximity = cfg["proximity"]

    @staticmethod
    def _compile_union(patterns: Iterable[str]) -> Optional[re.Pattern]:
        pats = [p for p in patterns if p]
        if not pats:
            return None
        return re.compile(r"(?i)(?:" + "|".join(pats) + r")")

    # ── Scoring helpers ─────────────────────────────────────────────────

    def _is_negated(self, text: str, start: int, end: int) -> bool:
        if self._negation_re is None:
            return False
        window = self._proximity["negation_window_chars"]
        lo = max(0, start - window)
        hi = min(len(text), end + window)
        return bool(self._negation_re.search(text[lo:hi]))

    def _find_anchor_spans(self, text: str) -> List[Tuple[int, int]]:
        if self._anchor_re is None:
            return []
        return [(m.start(), m.end()) for m in self._anchor_re.finditer(text)]

    def _any_anchor_within(self, anchors: Sequence[Tuple[int, int]], t_start: int, t_end: int) -> bool:
        window = self._proximity["anchor_to_token_chars"]
        for a_start, a_end in anchors:
            if a_end <= t_start:
                if t_start - a_end <= window:
                    return True
            elif t_end <= a_start:
                if a_start - t_end <= window:
                    return True
            else:
                return True  # overlap
        return False

    def _snippet_at(self, text: str, start: int, end: int, pad: int = 60) -> str:
        lo = max(0, start - pad)
        hi = min(len(text), end + pad)
        return text[lo:hi].strip()

    # ── Main entrypoint ─────────────────────────────────────────────────

    def match(self, text: Optional[str]) -> MatchResult:
        rule_id = self._build_rule_id()
        if not text or not text.strip():
            return MatchResult(False, 0, rule_id, self.region, [], "")

        body = text.strip()
        score = 0
        evidence: List[str] = []
        first_snippet = ""

        anchors = self._find_anchor_spans(body)

        identity_on = "identity_requirement" in self.rules
        clearance_on = "clearance_requirement" in self.rules
        sponsor_on = "sponsorship_unavailable" in self.rules

        def add_hit(delta: int, span_start: int, span_end: int) -> None:
            nonlocal score, first_snippet
            score += delta
            snip = self._snippet_at(body, span_start, span_end)
            evidence.append(snip)
            if not first_snippet:
                first_snippet = snip

        if identity_on:
            # Layer G — standalone regional tokens (e.g. "five eyes")
            if self._region_standalone_re:
                for m in self._region_standalone_re.finditer(body):
                    if self._is_negated(body, m.start(), m.end()):
                        continue
                    add_hit(self._weights["region_standalone_token"], m.start(), m.end())

            # Layer H — global hard patterns (`citizens only`, `legally authorized …`)
            if self._global_hard_re:
                for m in self._global_hard_re.finditer(body):
                    if self._is_negated(body, m.start(), m.end()):
                        continue
                    add_hit(self._weights["global_hard_pattern"], m.start(), m.end())

            # Layer B/C — region token × anchor proximity
            region_spans: List[Tuple[int, int]] = []
            if self._region_token_re:
                for m in self._region_token_re.finditer(body):
                    if self._is_negated(body, m.start(), m.end()):
                        continue
                    if self._any_anchor_within(anchors, m.start(), m.end()):
                        add_hit(self._weights["region_anchor_token"], m.start(), m.end())
                        region_spans.append((m.start(), m.end()))

            # Layer B/C generic — bare "citizen"/"work rights" × anchor
            if self._generic_token_re:
                for m in self._generic_token_re.finditer(body):
                    # Skip generic if already captured by region regex at same span
                    if any(self._spans_overlap((m.start(), m.end()), s) for s in region_spans):
                        continue
                    if self._is_negated(body, m.start(), m.end()):
                        continue
                    if self._any_anchor_within(anchors, m.start(), m.end()):
                        add_hit(self._weights["generic_anchor_token"], m.start(), m.end())

            # Layer I — sponsorship as co-signal under identity rule
            if self._sponsorship_re:
                for m in self._sponsorship_re.finditer(body):
                    if self._is_negated(body, m.start(), m.end()):
                        continue
                    add_hit(self._weights["sponsorship_phrase_with_identity"], m.start(), m.end())

        # Dedicated sponsorship_unavailable rule (higher standalone weight)
        if sponsor_on and not identity_on and self._sponsorship_re:
            for m in self._sponsorship_re.finditer(body):
                if self._is_negated(body, m.start(), m.end()):
                    continue
                add_hit(self._weights["sponsorship_phrase_standalone"], m.start(), m.end())

        # Layer J — clearance tokens
        if clearance_on and self._clearance_re:
            for m in self._clearance_re.finditer(body):
                if self._is_negated(body, m.start(), m.end()):
                    continue
                add_hit(self._weights["clearance_standalone"], m.start(), m.end())

        # Strict-only — "local candidates only" without remote hint
        if identity_on and self.strictness == "strict":
            local_match = self._local_only_re.search(body)
            if local_match and not self._remote_hint_re.search(body):
                add_hit(self._weights["local_only_no_remote_strict"], local_match.start(), local_match.end())

        # Soft-invite penalty (global)
        if self._soft_invite_re and self._soft_invite_re.search(body):
            score += self._weights["soft_invite_penalty"]

        score = max(0, score)
        threshold = self._thresholds[self.strictness]
        dropped = score >= threshold and bool(evidence)

        return MatchResult(
            dropped=dropped,
            score=score,
            rule=rule_id,
            region=self.region,
            evidence=evidence,
            snippet=first_snippet,
        )

    @staticmethod
    def _spans_overlap(a: Tuple[int, int], b: Tuple[int, int]) -> bool:
        return not (a[1] <= b[0] or b[1] <= a[0])

    def _build_rule_id(self) -> str:
        bits = ["identity_requirement"]
        if self.region != "GLOBAL":
            bits.append(f"region:{self.region}")
        if self.strictness != "balanced":
            bits.append(self.strictness)
        return ".".join(bits)


# ── DataFrame facade (used by run_jobspy.py and tests) ─────────────────


def filter_description_v2(
    df: pd.DataFrame,
    rules: Sequence[str],
    region: str = "GLOBAL",
    strictness: str = "balanced",
    rules_path: Optional[Path] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Return (kept_df, audit_df).

    Audit df contains the dropped rows with `rule`, `score`, `evidence`,
    `snippet` columns appended. Preserves original column order.
    """
    audit_cols = list(df.columns) + ["rule", "score", "evidence", "snippet"]

    if df.empty or "description" not in df.columns or not rules:
        return df.copy(), pd.DataFrame(columns=audit_cols)

    matcher = ExclusionMatcher(
        region=region,
        strictness=strictness,
        rules=rules,
        rules_path=rules_path,
    )

    keep_idx: List[int] = []
    drop_idx: List[int] = []
    audit_rows: List[dict] = []

    for pos, (idx, row) in enumerate(df.iterrows()):
        desc = row["description"] if pd.notna(row["description"]) else ""
        result = matcher.match(str(desc))
        if result.dropped:
            drop_idx.append(idx)
            entry = row.to_dict()
            entry.update(
                {
                    "rule": result.rule,
                    "score": result.score,
                    "evidence": "; ".join(result.evidence),
                    "snippet": result.snippet,
                }
            )
            audit_rows.append(entry)
        else:
            keep_idx.append(idx)

    kept = df.loc[keep_idx].copy()
    audit = (
        pd.DataFrame(audit_rows, columns=audit_cols)
        if audit_rows
        else pd.DataFrame(columns=audit_cols)
    )
    return kept, audit
