import json
import unittest
from pathlib import Path

import pandas as pd

try:
    from .au_eligibility_policy import (
        AU_ELIGIBILITY_POLICY_VERSION,
        evaluate_au_eligibility,
        filter_au_eligibility_policy,
    )
except ImportError:
    from au_eligibility_policy import (
        AU_ELIGIBILITY_POLICY_VERSION,
        evaluate_au_eligibility,
        filter_au_eligibility_policy,
    )


CORPUS_PATH = Path(__file__).resolve().parents[2] / "test" / "auEligibilityPolicy.corpus.json"


def slice_utf16(value: str, start: int, end: int) -> str:
    raw = value.encode("utf-16-le")
    return raw[start * 2 : end * 2].decode("utf-16-le")


class AuEligibilityPolicyCorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))

    def test_policy_version_matches_corpus(self):
        self.assertEqual(AU_ELIGIBILITY_POLICY_VERSION, self.corpus["policyVersion"])

    def test_shared_corpus(self):
        for item in self.corpus["cases"]:
            with self.subTest(name=item["name"]):
                rules = set(item["rules"])
                decision = evaluate_au_eligibility(
                    item["description"],
                    identity_requirement="identity_requirement" in rules,
                    clearance_requirement="clearance_requirement" in rules,
                )
                actual = {
                    "verdict": decision.verdict,
                    "reasonCode": decision.reason_code,
                    "evidence": decision.evidence.clause if decision.evidence else None,
                }
                self.assertEqual(actual, item["expected"])

                if decision.evidence and item["description"]:
                    self.assertEqual(
                        slice_utf16(
                            item["description"],
                            decision.evidence.start,
                            decision.evidence.end,
                        ),
                        decision.evidence.clause,
                    )

    def test_unrelated_sentences_do_not_change_the_gate(self):
        base = evaluate_au_eligibility("Must be an Australian citizen.")
        with_noise = evaluate_au_eligibility(
            "Must be an Australian citizen. A degree is not required. "
            "Sponsorship is available for other roles."
        )
        self.assertEqual(with_noise.verdict, base.verdict)
        self.assertEqual(with_noise.reason_code, base.reason_code)
        self.assertEqual(with_noise.evidence.clause, base.evidence.clause)

    def test_preferred_is_not_a_gate(self):
        self.assertEqual(
            evaluate_au_eligibility("NV1 clearance is required.").verdict,
            "EXCLUDE",
        )
        self.assertEqual(
            evaluate_au_eligibility("NV1 clearance is preferred.").verdict,
            "KEEP",
        )

    def test_evidence_offsets_use_utf16_code_units(self):
        decision = evaluate_au_eligibility(
            "About 🚀. Must be an Australian citizen."
        )
        self.assertEqual((decision.evidence.start, decision.evidence.end), (10, 39))

    def test_dataframe_facade_is_fail_open_and_emits_exact_evidence(self):
        frame = pd.DataFrame(
            [
                {"job_url": "keep-missing", "description": None},
                {
                    "job_url": "keep-work-rights",
                    "description": "Applicants must have the right to work in Australia.",
                },
                {
                    "job_url": "drop-citizen",
                    "description": "Applicants must be Australian citizens.",
                },
                {
                    "job_url": "drop-nv1",
                    "description": "Must be eligible to obtain an NV1 clearance.",
                },
                {
                    "job_url": "keep-experience",
                    "description": "At least 8 years of experience is required.",
                },
            ]
        )

        kept, audit = filter_au_eligibility_policy(frame)

        self.assertEqual(
            kept["job_url"].tolist(),
            ["keep-missing", "keep-work-rights", "keep-experience"],
        )
        self.assertEqual(audit["job_url"].tolist(), ["drop-citizen", "drop-nv1"])
        self.assertEqual(
            audit["rule"].tolist(),
            [
                "identity_requirement.AU_CITIZEN_REQUIRED",
                "clearance_requirement.AU_CLEARANCE_OBTAIN_REQUIRED",
            ],
        )
        self.assertEqual(
            audit["evidence"].tolist(),
            [
                "Applicants must be Australian citizens",
                "Must be eligible to obtain an NV1 clearance",
            ],
        )


if __name__ == "__main__":
    unittest.main()
