"""
Table-driven tests for ExclusionMatcher.

Covers 30+ real-world JD phrasings across AU / US / CA / UK / NZ / EU regions
and three strictness levels (strict / balanced / loose). Validates:
  - Hard-requirement detection across citizen / PR / green card / ILR / SCV
  - Negation-guard suppression ("does not require")
  - Soft-invite whitelist ("citizens of the world welcome")
  - Sponsorship-implication phrases
  - Backward-compatibility wrapper (filter_description_v2)
"""

import os
import sys
import unittest

import pandas as pd

sys.path.append(os.path.dirname(__file__))

from rights_filter import ExclusionMatcher, MatchResult, filter_description_v2  # noqa: E402


class MatcherCorePhraseTests(unittest.TestCase):
    """Every row is: (description, region, strictness, expected_dropped, label)."""

    BALANCED_CASES = [
        # AU — hard drops
        ("Must be an Australian citizen or permanent resident.", "AU", "balanced", True, "au_citizen_or_pr"),
        ("Australian citizens and permanent residents only.", "AU", "balanced", True, "au_only"),
        ("Must hold Australian citizenship or permanent residency.", "AU", "balanced", True, "au_hold_citizenship"),
        ("Applicants must have the right to work in Australia.", "AU", "balanced", True, "au_right_to_work"),
        ("Due to the nature of our clients, only Australian citizens may apply.", "AU", "balanced", True, "au_clients_only"),
        ("Applicants must be a citizen or PR of Australia or NZ.", "AU", "balanced", True, "au_or_nz"),
        ("NZ citizen or SCV holder required.", "AU", "balanced", True, "au_scv"),

        # US — hard drops
        ("US persons only.", "US", "balanced", True, "us_persons_only"),
        ("Must be legally authorized to work in the US without sponsorship now or in the future.", "US", "balanced", True, "us_no_sponsorship_future"),
        ("Unrestricted work authorization required.", "US", "balanced", True, "us_unrestricted_auth"),
        ("Green card holders or US citizens only.", "US", "balanced", True, "us_gc_or_citizen"),
        ("We will not sponsor visas for this role.", "US", "balanced", True, "us_no_sponsor"),
        ("Sponsorship is not available for this role.", "US", "balanced", True, "us_sponsorship_not_available"),

        # CA / UK / NZ / EU
        ("Canadian citizens or PRs only.", "CA", "balanced", True, "ca_citizen_or_pr"),
        ("ILR or British citizenship required.", "UK", "balanced", True, "uk_ilr_or_citizen"),
        ("EU citizens only.", "EU", "balanced", True, "eu_citizens_only"),
        ("Right to work in New Zealand required.", "NZ", "balanced", True, "nz_right_to_work"),

        # Keeps — negation / welcoming / orthogonal
        ("Open to candidates with existing work rights.", "AU", "balanced", False, "keep_existing_rights"),
        ("This role does not require citizenship.", "AU", "balanced", False, "keep_no_citizenship_req"),
        ("No citizenship required.", "AU", "balanced", False, "keep_bare_no_required"),
        ("Visa sponsorship available.", "US", "balanced", False, "keep_sponsorship_available"),
        ("We welcome candidates regardless of citizenship.", "AU", "balanced", False, "keep_regardless"),
        ("Citizens of the world welcome.", "AU", "balanced", False, "keep_world_welcome"),
        ("TN visa holders welcome.", "US", "balanced", False, "keep_tn_welcome"),
        ("H1B candidates encouraged.", "US", "balanced", False, "keep_h1b_encouraged"),

        # PR disambiguation — must NOT trigger on public-relations / PR-friendly
        ("PR-friendly culture and modern media stack.", "AU", "balanced", False, "keep_pr_friendly_culture"),

        # Soft-qualifier adjacency — a soft qualifier softens ONLY the requirement
        # it immediately follows, within the same sentence.
        ("Security clearance preferred but not essential.", "AU", "balanced", False, "keep_soft_clearance_preferred"),
        # ...but a trailing soft qualifier on a DIFFERENT clause (across a period)
        # must NOT rescue a hard citizenship gate. (regression for audit rank-7)
        ("Must be an Australian citizen. AWS certification preferred.", "AU", "balanced", True, "drop_hard_citizen_then_soft_cert"),
        ("Applicants must hold Australian PR. A finance background is a plus.", "AU", "balanced", True, "drop_hard_pr_then_soft_finance"),

        # Clearance pack (Five Eyes) — drops under AU because AU region enables clearance
        ("Citizens of the Five Eyes nations may apply.", "US", "balanced", True, "five_eyes"),
    ]

    def test_balanced_phrase_matrix(self):
        for desc, region, strictness, expected_dropped, label in self.BALANCED_CASES:
            with self.subTest(label=label):
                matcher = ExclusionMatcher(region=region, strictness=strictness)
                result = matcher.match(desc)
                self.assertIsInstance(result, MatchResult)
                self.assertEqual(
                    result.dropped,
                    expected_dropped,
                    f"[{label}] region={region} strictness={strictness} "
                    f"expected dropped={expected_dropped} got={result.dropped} "
                    f"score={result.score} evidence={result.evidence}",
                )


class MatcherStrictnessTests(unittest.TestCase):
    def test_loose_requires_stronger_signal(self):
        """`Applicants must have the right to work in Australia` is a balanced drop,
        but loose mode (threshold 80) should NOT drop it — single generic-token hit."""
        desc = "Applicants must have the right to work in Australia."
        loose = ExclusionMatcher(region="AU", strictness="loose")
        self.assertFalse(loose.match(desc).dropped)

        balanced = ExclusionMatcher(region="AU", strictness="balanced")
        self.assertTrue(balanced.match(desc).dropped)

    def test_strict_drops_local_candidates_only(self):
        """`Local candidates only` is ambiguous — keep under balanced, drop under strict."""
        desc = "Local candidates only. Must be based in Sydney office full-time."
        strict = ExclusionMatcher(region="AU", strictness="strict")
        balanced = ExclusionMatcher(region="AU", strictness="balanced")
        self.assertTrue(strict.match(desc).dropped)
        self.assertFalse(balanced.match(desc).dropped)

    def test_strict_catches_truncated_description(self):
        """Truncated LinkedIn excerpts — strict should still match on prefix."""
        desc = "...senior role open to Australian citize"
        strict = ExclusionMatcher(region="AU", strictness="strict")
        self.assertTrue(strict.match(desc).dropped)


class MatcherEvidenceTests(unittest.TestCase):
    def test_match_result_contains_evidence(self):
        matcher = ExclusionMatcher(region="AU", strictness="balanced")
        result = matcher.match("Must be an Australian citizen or permanent resident.")
        self.assertTrue(result.dropped)
        self.assertGreater(len(result.evidence), 0)
        self.assertTrue(any("citizen" in ev.lower() for ev in result.evidence))
        self.assertIn("identity_requirement", result.rule)

    def test_match_result_snippet_surrounds_hit(self):
        matcher = ExclusionMatcher(region="US", strictness="balanced")
        long_text = "We are hiring. " * 20 + "Must be a US citizen. " + "Apply today. " * 20
        result = matcher.match(long_text)
        self.assertTrue(result.dropped)
        self.assertIn("citizen", result.snippet.lower())
        self.assertLessEqual(len(result.snippet), 400)

    def test_empty_description_returns_keep(self):
        matcher = ExclusionMatcher(region="AU", strictness="balanced")
        result = matcher.match("")
        self.assertFalse(result.dropped)
        self.assertEqual(result.score, 0)


class MatcherNegationTests(unittest.TestCase):
    def test_sponsorship_available_overrides_citizen_mention(self):
        desc = "We welcome candidates from all backgrounds. Visa sponsorship available for the right person — US citizens and green card holders too."
        matcher = ExclusionMatcher(region="US", strictness="balanced")
        result = matcher.match(desc)
        self.assertFalse(result.dropped, f"expected keep, got drop score={result.score} evidence={result.evidence}")


class MatcherRegionIsolationTests(unittest.TestCase):
    def test_us_phrase_under_au_region_still_matches_via_global_sponsorship(self):
        """A US-phrased JD loaded under AU region should still drop via sponsorship-implication
        (global layer), even though `US persons only` is not in AU token pack."""
        desc = "Must be a US citizen. We will not sponsor visas now or in the future."
        matcher = ExclusionMatcher(region="AU", strictness="balanced")
        result = matcher.match(desc)
        self.assertTrue(result.dropped)


class DataframeFilterTests(unittest.TestCase):
    def test_filter_description_v2_drops_hard_rows_keeps_soft(self):
        df = pd.DataFrame(
            [
                {"description": "Must be an Australian citizen.", "job_url": "1"},
                {"description": "Visa sponsorship available.", "job_url": "2"},
                {"description": "We welcome candidates regardless of citizenship.", "job_url": "3"},
                {"description": "Canadian citizens or PRs only.", "job_url": "4"},
            ]
        )
        kept, audit = filter_description_v2(
            df,
            rules=["identity_requirement"],
            region="AU",
            strictness="balanced",
        )
        self.assertEqual(len(kept), 2)
        self.assertEqual(len(audit), 2)
        # CA-phrased row should be kept under AU region (region-isolated identity pack).
        self.assertIn("2", kept["job_url"].tolist())
        self.assertIn("3", kept["job_url"].tolist())

    def test_filter_description_v2_honors_empty_rules(self):
        df = pd.DataFrame([{"description": "Must be a US citizen.", "job_url": "1"}])
        kept, audit = filter_description_v2(df, rules=[], region="US", strictness="balanced")
        self.assertEqual(len(kept), 1)
        self.assertEqual(len(audit), 0)

    def test_filter_description_v2_respects_clearance_rule(self):
        df = pd.DataFrame(
            [
                {"description": "Requires NV1 clearance.", "job_url": "1"},
                {"description": "Must have baseline clearance.", "job_url": "2"},
                {"description": "Regular role, no clearance needed.", "job_url": "3"},
            ]
        )
        kept, audit = filter_description_v2(
            df,
            rules=["clearance_requirement"],
            region="AU",
            strictness="balanced",
        )
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept.iloc[0]["job_url"], "3")


if __name__ == "__main__":
    unittest.main()
