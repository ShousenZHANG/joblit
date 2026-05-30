import unittest

import os
import sys
import threading
import time

import pandas as pd

sys.path.append(os.path.dirname(__file__))
import run_jobspy as rj  # noqa: E402


class RunJobspyDedupeTests(unittest.TestCase):
    def test_resolve_search_terms_prefers_queries_and_dedupes(self):
        terms = rj._resolve_search_terms(
            title_query="Software Engineer",
            queries=["Frontend Engineer", "Software Engineer", "Frontend Engineer", "Backend Engineer"],
        )
        self.assertEqual(terms, ["Frontend Engineer", "Software Engineer", "Backend Engineer"])

    def test_dedupe_jobs_collapses_tracking_variants_of_same_url(self):
        df = pd.DataFrame(
            [
                {
                    "job_url": "https://example.com/a?ref=1",
                    "title": "Frontend Engineer",
                    "company": "Acme",
                    "location": "Sydney",
                },
                {
                    "job_url": "https://example.com/a?ref=2",
                    "title": "Frontend Engineer",
                    "company": "Acme",
                    "location": "Sydney",
                },
            ]
        )

        deduped = rj.dedupe_jobs(df)
        self.assertEqual(len(deduped), 1)

    def test_dedupe_jobs_keeps_distinct_urls_with_same_title_company_location(self):
        df = pd.DataFrame(
            [
                {
                    "job_url": "https://example.com/jobs/100?tracking=abc",
                    "title": "Frontend Engineer",
                    "company": "Acme",
                    "location": "Sydney",
                },
                {
                    "job_url": "https://example.com/jobs/200?tracking=def",
                    "title": "Frontend Engineer",
                    "company": "Acme",
                    "location": "Sydney",
                },
            ]
        )

        deduped = rj.dedupe_jobs(df)
        self.assertEqual(len(deduped), 2)

    def test_canonicalize_job_url_removes_query_and_fragment(self):
        self.assertEqual(
            rj._canonicalize_job_url("HTTPS://Example.com/jobs/view/123/?utm_source=x#top"),
            "https://example.com/jobs/view/123",
        )

    def test_canonicalize_job_url_normalizes_www_hostname(self):
        self.assertEqual(
            rj._canonicalize_job_url("https://www.linkedin.com/jobs/view/123?trk=abc"),
            "https://linkedin.com/jobs/view/123",
        )

    def test_canonicalize_job_url_normalizes_linkedin_current_job_id(self):
        self.assertEqual(
            rj._canonicalize_job_url(
                "https://www.linkedin.com/jobs/search/?keywords=Software%20Engineer&currentJobId=999&trk=public_jobs_jobs-search-bar_search-submit"
            ),
            "https://linkedin.com/jobs/view/999",
        )

    def test_results_per_query_splits_budget_across_terms(self):
        self.assertEqual(rj._results_per_query(100, 8), 13)
        self.assertEqual(rj._results_per_query(100, 1), 100)

    def test_build_results_budget_assigns_full_budget_to_each_term(self):
        budget = rj._build_results_budget_by_term(
            ["Software Engineer", "Frontend Engineer", "Backend Engineer"],
            100,
        )
        self.assertEqual(budget["Software Engineer"], 100)
        self.assertEqual(budget["Frontend Engineer"], 100)
        self.assertEqual(budget["Backend Engineer"], 100)

    def test_build_results_budget_single_term_is_unchanged(self):
        budget = rj._build_results_budget_by_term(["Software Engineer"], 80)
        self.assertEqual(budget, {"Software Engineer": 80})

    def test_resolve_fetch_query_workers_uses_safe_defaults_and_limits(self):
        original = os.environ.get("FETCH_QUERY_CONCURRENCY")
        try:
            os.environ.pop("FETCH_QUERY_CONCURRENCY", None)
            self.assertEqual(rj._resolve_fetch_query_workers(10), 2)

            os.environ["FETCH_QUERY_CONCURRENCY"] = "99"
            self.assertEqual(rj._resolve_fetch_query_workers(10), 6)

            os.environ["FETCH_QUERY_CONCURRENCY"] = "1"
            self.assertEqual(rj._resolve_fetch_query_workers(10), 1)
        finally:
            if original is None:
                os.environ.pop("FETCH_QUERY_CONCURRENCY", None)
            else:
                os.environ["FETCH_QUERY_CONCURRENCY"] = original

    def test_is_rate_limited_error_detects_429_messages(self):
        self.assertTrue(rj._is_rate_limited_error(Exception("too many 429 error responses")))
        self.assertTrue(rj._is_rate_limited_error(Exception("Rate limit exceeded")))
        self.assertFalse(rj._is_rate_limited_error(Exception("connection reset by peer")))

    def test_fetch_terms_uses_multiple_threads_when_workers_gt1(self):
        queries = ["q1", "q2", "q3", "q4"]
        thread_names = set()
        lock = threading.Lock()

        def fake_fetch(term: str):
            time.sleep(0.02)
            with lock:
                thread_names.add(threading.current_thread().name)
            return pd.DataFrame(
                [
                    {
                        "job_url": f"https://example.com/{term}",
                        "title": term,
                        "company": "Acme",
                        "location": "Sydney",
                    }
                ]
            )

        pairs = rj._fetch_terms(queries, fake_fetch, max_workers=4)
        self.assertEqual(len(pairs), 4)
        self.assertGreater(len(thread_names), 1)

    def test_filter_title_includes_description_match_when_enforced(self):
        df = pd.DataFrame(
            [
                {
                    "title": "Senior Software Engineer",
                    "description": "Build web apps.",
                    "company": "Acme",
                    "location": "Sydney",
                },
                {
                    "title": "Software Engineer",
                    "description": "Work on product.",
                    "company": "Beta",
                    "location": "Sydney",
                },
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Software Engineer"],
            enforce_include=True,
            exclude_terms=["senior"],
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out.iloc[0]["title"], "Software Engineer")

    def test_filter_title_enforce_include_drops_non_matching_titles(self):
        df = pd.DataFrame(
            [
                {
                    "title": "Software Engineer",
                    "description": "Build APIs",
                    "company": "Acme",
                    "location": "Sydney",
                },
                {
                    "title": "Product Designer",
                    "description": "Design product experiences",
                    "company": "Beta",
                    "location": "Sydney",
                },
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Software Engineer"],
            enforce_include=True,
            exclude_terms=[],
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out.iloc[0]["title"], "Software Engineer")

    def test_filter_title_without_enforce_include_keeps_non_matching_titles(self):
        df = pd.DataFrame(
            [
                {
                    "title": "Software Engineer",
                    "description": "Build APIs",
                    "company": "Acme",
                    "location": "Sydney",
                },
                {
                    "title": "Product Designer",
                    "description": "Design product experiences",
                    "company": "Beta",
                    "location": "Sydney",
                },
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Software Engineer"],
            enforce_include=False,
            exclude_terms=[],
        )
        self.assertEqual(len(out), 2)

    def test_filter_description_only_drops_hard_rights_requirement(self):
        from rights_filter import filter_description_v2

        df = pd.DataFrame(
            [
                {
                    "title": "Software Engineer",
                    "description": "Australian citizen required for this role.",
                    "company": "Acme",
                    "location": "Sydney",
                },
                {
                    "title": "Data Engineer",
                    "description": (
                        "Applicant must be an Australian Citizen or Australian Permanent Resident "
                        "to be considered."
                    ),
                    "company": "Gamma",
                    "location": "Sydney",
                },
                {
                    "title": "Frontend Engineer",
                    "description": "Australian citizens and PR welcome to apply.",
                    "company": "Beta",
                    "location": "Sydney",
                },
            ]
        )

        out, _audit = filter_description_v2(df, rules=["identity_requirement"])
        self.assertEqual(len(out), 1)
        self.assertEqual(out.iloc[0]["title"], "Frontend Engineer")

    def test_filter_description_only_drops_hard_clearance_requirement(self):
        from rights_filter import filter_description_v2

        df = pd.DataFrame(
            [
                {
                    "title": "Software Engineer",
                    "description": "Baseline clearance required.",
                    "company": "Acme",
                    "location": "Sydney",
                },
                {
                    "title": "Frontend Engineer",
                    "description": "Security clearance preferred.",
                    "company": "Beta",
                    "location": "Sydney",
                },
            ]
        )

        out, _audit = filter_description_v2(df, rules=["clearance_requirement"])
        self.assertEqual(len(out), 1)
        self.assertEqual(out.iloc[0]["title"], "Frontend Engineer")

    def test_filter_description_only_drops_hard_sponsorship_requirement(self):
        from rights_filter import filter_description_v2

        df = pd.DataFrame(
            [
                {
                    "title": "Software Engineer",
                    "description": "Sponsorship not available for this role.",
                    "company": "Acme",
                    "location": "Sydney",
                },
                {
                    "title": "Frontend Engineer",
                    "description": "Sponsorship may be available for the right candidate.",
                    "company": "Beta",
                    "location": "Sydney",
                },
            ]
        )

        out, _audit = filter_description_v2(df, rules=["sponsorship_unavailable"])
        self.assertEqual(len(out), 1)
        self.assertEqual(out.iloc[0]["title"], "Frontend Engineer")

    def test_filter_experience_requirements_drops_only_explicit_minimum_years(self):
        df = pd.DataFrame(
            [
                {
                    "title": "Senior Backend Engineer",
                    "description": "Must have 5+ years of professional experience with backend systems.",
                },
                {
                    "title": "Frontend Engineer",
                    "description": "4 years of experience preferred, but not required.",
                },
                {
                    "title": "Graduate Engineer",
                    "description": "Suitable for candidates with up to 5 years of experience.",
                },
                {
                    "title": "Full Stack Engineer",
                    "description": "Looking for 3 years of commercial experience in React.",
                },
            ]
        )

        out, audit = rj.filter_experience_requirements(
            df,
            rules=["experience_requirement_4_plus"],
        )

        self.assertEqual(
            out["title"].tolist(),
            ["Frontend Engineer", "Graduate Engineer", "Full Stack Engineer"],
        )
        self.assertEqual(audit["rule"].tolist(), ["experience_requirement_4_plus"])

    def test_filter_experience_requirements_supports_four_plus_and_chinese_jd(self):
        df = pd.DataFrame(
            [
                {
                    "title": "Python Engineer",
                    "description": "至少4年工作经验，熟悉 Python 和数据平台。",
                },
                {
                    "title": "React Engineer",
                    "description": "Minimum 4 years experience required building production web apps.",
                },
                {
                    "title": "Junior Engineer",
                    "description": "1-3 years experience required.",
                },
            ]
        )

        out, audit = rj.filter_experience_requirements(
            df,
            rules=["experience_requirement_4_plus"],
        )

        self.assertEqual(out["title"].tolist(), ["Junior Engineer"])
        self.assertEqual(
            audit["rule"].tolist(),
            ["experience_requirement_4_plus", "experience_requirement_4_plus"],
        )

    def test_clean_description_lightweight_preserves_structure(self):
        raw = "<p>Minimum of 5 years required.</p> Must-have: Python."
        cleaned = rj._clean_description_text(raw)
        self.assertIn("Minimum of 5 years required.", cleaned)
        self.assertIn("Must-have: Python.", cleaned)
        self.assertNotIn("<p>", cleaned)

    def test_parse_csv_list_dedupes_and_trims(self):
        out = rj._parse_csv_list(" alpha , beta , ,BETA ")
        self.assertEqual(out, ["alpha", "beta"])

    def test_merge_phase_details_prefers_non_empty_description(self):
        base = pd.DataFrame(
            [
                {
                    "job_url": "https://linkedin.com/jobs/view/1?trk=a",
                    "title": "Software Engineer",
                    "company": "Acme",
                    "location": "Sydney",
                    "description": "",
                }
            ]
        )
        details = pd.DataFrame(
            [
                {
                    "job_url": "https://www.linkedin.com/jobs/view/1?tracking=xyz",
                    "title": "Software Engineer",
                    "company": "Acme",
                    "location": "Sydney",
                    "description": "Detailed JD body",
                }
            ]
        )

        merged = rj._merge_phase_details(base, details)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged.iloc[0]["description"], "Detailed JD body")

    def test_extract_linkedin_job_id_from_url(self):
        self.assertEqual(
            rj._extract_linkedin_job_id("https://www.linkedin.com/jobs/view/1234567890/?ref=abc"),
            "1234567890",
        )
        self.assertEqual(rj._extract_linkedin_job_id("https://example.com/jobs/view/1"), "")

    def test_enrich_descriptions_for_urls_only_fetches_missing_and_deduped_urls(self):
        base = pd.DataFrame(
            [
                {
                    "job_url": "https://www.linkedin.com/jobs/view/123/?trk=a",
                    "title": "Software Engineer",
                    "description": "",
                },
                {
                    "job_url": "https://linkedin.com/jobs/view/123?tracking=b",
                    "title": "Software Engineer",
                    "description": "",
                },
                {
                    "job_url": "https://linkedin.com/jobs/view/999",
                    "title": "Backend Engineer",
                    "description": "Already has details",
                },
            ]
        )
        calls = []

        def fake_fetch(url: str):
            calls.append(rj._canonicalize_job_url(url))
            return "Fetched JD for 123"

        out = rj._enrich_descriptions_for_urls(
            base,
            fetch_fn=fake_fetch,
        )
        self.assertEqual(calls, ["https://linkedin.com/jobs/view/123"])
        self.assertEqual(out.iloc[0]["description"], "Fetched JD for 123")
        self.assertEqual(out.iloc[2]["description"], "Already has details")

if __name__ == "__main__":
    unittest.main()
