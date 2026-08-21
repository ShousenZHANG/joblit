import json
import os
import sys
import unittest

import pandas as pd

from tools.fetcher.title_seniority_policy import (
    evaluate_legacy_title_exclusions,
    evaluate_title_seniority_for_policy,
)
from tools.fetcher.fetch_policy import (
    ACTIVE_AU_FETCH_POLICY,
    AU_FETCH_POLICY_REGISTRY,
    AU_RECALL_SAFE_V1_POLICY_ID,
    AU_RECALL_SAFE_V2_POLICY_ID,
    AU_RECALL_SAFE_V3_POLICY_ID,
)


class SharedTitleSeniorityPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        corpus_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "test",
            "titleSeniorityPolicy.corpus.json",
        )
        with open(corpus_path, encoding="utf-8") as handle:
            cls.corpus = json.load(handle)

    def test_corpus_contains_high_confidence_and_fail_open_examples(self):
        self.assertGreater(len(self.corpus["cases"]), 20)

    def test_python_matches_the_shared_contract(self):
        for case in self.corpus["cases"]:
            with self.subTest(case=case["name"]):
                decision = evaluate_title_seniority_for_policy(
                    case["title"],
                    self.corpus["policyId"],
                )
                self.assertEqual(decision["outcome"], case["expectedOutcome"])
                self.assertEqual(decision["ruleId"], case["expectedRuleId"])
                if decision["outcome"] == "EXCLUDE":
                    self.assertTrue(decision["evidence"])

    def test_python_matches_the_shared_versioned_policy_cases(self):
        for case in self.corpus["policyCases"]:
            with self.subTest(case=case["name"]):
                decision = evaluate_title_seniority_for_policy(
                    case["title"], case["policyId"]
                )
                self.assertEqual(decision["outcome"], case["expectedOutcome"])
                self.assertEqual(decision["ruleId"], case["expectedRuleId"])

    def test_v2_keeps_senior_and_preserves_every_other_hard_exclusion(self):
        for case in self.corpus["cases"]:
            with self.subTest(case=case["name"]):
                decision = evaluate_title_seniority_for_policy(
                    case["title"],
                    AU_RECALL_SAFE_V2_POLICY_ID,
                )
                if case["expectedRuleId"] == "TITLE_SENIOR":
                    self.assertEqual(decision["outcome"], "KEEP")
                elif case["expectedOutcome"] == "EXCLUDE":
                    self.assertEqual(decision["outcome"], "EXCLUDE")
                    self.assertEqual(decision["ruleId"], case["expectedRuleId"])
                else:
                    self.assertEqual(decision["outcome"], "KEEP")

    def test_python_matches_the_shared_v1_compatibility_contract(self):
        for case in self.corpus["legacyCases"]:
            with self.subTest(case=case["name"]):
                decision = evaluate_legacy_title_exclusions(
                    case["title"],
                    case["configuredTerms"],
                )
                self.assertEqual(decision["outcome"], case["expectedOutcome"])
                self.assertEqual(decision["ruleId"], case["expectedRuleId"])

    def test_active_policy_id_drives_the_worker_title_filter(self):
        sys.path.append(os.path.dirname(__file__))
        import run_jobspy as worker

        config = {
            "schemaVersion": 2,
            "market": "AU",
            "smartExpand": True,
            "includeFromQueries": True,
            "titleMatch": "relaxed",
            "policy": dict(ACTIVE_AU_FETCH_POLICY),
        }
        policy_id = worker._resolve_au_recall_policy_id(config)
        rows = pd.DataFrame(
            [
                {"title": "Software Engineer", "job_level": "Mid-Senior level"},
                {"title": "Senior Software Engineer", "job_level": "Entry level"},
                {"title": "Staff Software Engineer", "job_level": "Entry level"},
            ]
        )

        kept = worker.filter_title(
            rows,
            queries=[],
            enforce_include=False,
            seniority_policy_id=policy_id,
        )

        self.assertEqual(
            kept["title"].tolist(),
            ["Software Engineer", "Senior Software Engineer"],
        )

    def test_persisted_v1_config_still_excludes_senior(self):
        sys.path.append(os.path.dirname(__file__))
        import run_jobspy as worker

        config = {
            "schemaVersion": 2,
            "market": "AU",
            "smartExpand": True,
            "includeFromQueries": True,
            "titleMatch": "relaxed",
            "policy": AU_FETCH_POLICY_REGISTRY[
                AU_RECALL_SAFE_V1_POLICY_ID
            ].as_config(),
        }
        policy_id = worker._resolve_au_recall_policy_id(config)
        rows = pd.DataFrame(
            [
                {"title": "Software Engineer"},
                {"title": "Senior Software Engineer"},
                {"title": "Staff Software Engineer"},
            ]
        )

        kept = worker.filter_title(
            rows,
            queries=[],
            enforce_include=False,
            seniority_policy_id=policy_id,
        )

        self.assertEqual(kept["title"].tolist(), ["Software Engineer"])


class RecallSafeV3TitlePolicyTests(unittest.TestCase):
    """Mirror of the TypeScript v3 suite; both runtimes must agree."""

    def _decide(self, title: str) -> tuple[str, str]:
        decision = evaluate_title_seniority_for_policy(
            title, AU_RECALL_SAFE_V3_POLICY_ID
        )
        return decision["outcome"], decision["ruleId"]

    def test_excludes_visible_senior_titles(self):
        for title in (
            "Senior Software Engineer",
            "Senior AI Engineer",
            "Sr. Data Analyst",
            "Snr Developer",
            # v2's levelled-role grammar misses these; v3 catches them.
            "Senior Associate",
            "Senior Partner, Digital",
            "Senior Consultant - Cloud",
        ):
            with self.subTest(title=title):
                self.assertEqual(
                    self._decide(title), ("EXCLUDE", "TITLE_SENIOR")
                )

    def test_keeps_senior_domain_phrases(self):
        for title in (
            "Senior Living Platform Engineer",
            "Software Engineer, Senior Care Services",
            "Developer - Senior School Systems",
        ):
            with self.subTest(title=title):
                self.assertEqual(self._decide(title)[0], "KEEP")

    def test_keeps_target_level_roles(self):
        for title in (
            "Graduate Software Engineer",
            "Junior Data Analyst",
            "AI Engineer",
            "Software Developer",
        ):
            with self.subTest(title=title):
                self.assertEqual(
                    self._decide(title), ("KEEP", "TITLE_ALLOWED")
                )

    def test_early_career_wording_overrides_senior(self):
        self.assertEqual(
            self._decide("Senior Graduate Program Engineer")[0], "KEEP"
        )

    def test_keeps_excluding_leader_which_v1_traded_away(self):
        self.assertEqual(
            self._decide("Engineering Leader"), ("EXCLUDE", "TITLE_LEAD")
        )


if __name__ == "__main__":
    unittest.main()
