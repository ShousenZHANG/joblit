import unittest
from unittest.mock import Mock, patch

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

    def test_canonicalize_job_url_preserves_query_job_identity(self):
        self.assertEqual(
            rj._canonicalize_job_url(
                "https://boards.greenhouse.io/acme/jobs?gh_jid=123&utm_source=x"
            ),
            "https://boards.greenhouse.io/acme/jobs?gh_jid=123",
        )
        first = rj._canonicalize_job_url(
            "https://careers.example.com/apply?jobId=100"
        )
        second = rj._canonicalize_job_url(
            "https://careers.example.com/apply?jobId=200"
        )
        self.assertNotEqual(first, second)

    def test_canonicalize_job_url_rejects_non_http_protocols(self):
        self.assertEqual(
            rj._canonicalize_job_url("ftp://example.com/jobs/123"),
            "",
        )

    def test_canonicalize_job_url_uses_stable_alias_priority_and_rfc3986_spaces(self):
        self.assertEqual(
            rj._canonicalize_job_url(
                "https://careers.example.com/apply?"
                "jid=2&job_id=hello%20world%21%27%28%29%2A"
            ),
            "https://careers.example.com/apply?"
            "job_id=hello%20world%21%27%28%29%2A",
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

    def test_filter_title_excludes_seniority_from_job_level(self):
        df = pd.DataFrame(
            [
                {
                    "title": "Software Engineer",
                    "job_level": "Mid-Senior level",
                    "description": "Build APIs",
                },
                {
                    "title": "Software Engineer",
                    "job_level": "Entry level",
                    "description": "Build web applications",
                },
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Software Engineer"],
            enforce_include=True,
            exclude_terms=["senior"],
        )

        self.assertEqual(out["job_level"].tolist(), ["Entry level"])

    def test_filter_title_matches_role_tokens_without_short_word_false_positives(self):
        df = pd.DataFrame(
            [
                {"title": "Senior Java Engineer", "job_level": "Senior"},
                {"title": "Senior JavaScript Engineer", "job_level": "Senior"},
                {"title": "Go Engineer", "job_level": "Entry"},
                {"title": "Google Ads Specialist", "job_level": "Entry"},
            ]
        )

        java = rj.filter_title(
            df,
            queries=["Java Developer"],
            enforce_include=True,
            exclude_terms=[],
        )
        go = rj.filter_title(
            df,
            queries=["Go"],
            enforce_include=True,
            exclude_terms=[],
        )

        self.assertEqual(java["title"].tolist(), ["Senior Java Engineer"])
        self.assertEqual(go["title"].tolist(), ["Go Engineer"])

    def test_filter_title_ai_query_keeps_domain_synonyms(self):
        # An "AI Engineer" search must keep AI-domain titles that never carry
        # the literal token "ai" (ML / GenAI / LLM / Agentic), which previously
        # left the strict include filter fetching nothing.
        df = pd.DataFrame(
            [
                {"title": "Machine Learning Engineer"},
                {"title": "ML Engineer"},
                {"title": "GenAI Engineer"},
                {"title": "LLM Engineer"},
                {"title": "Agentic Engineer"},
                {"title": "AI Engineer"},
                {"title": "Accountant"},
                {"title": "Marketing Manager"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=["AI Engineer"],
            enforce_include=True,
            exclude_terms=[],
            base_queries=["AI Engineer"],
        )

        kept = out["title"].tolist()
        self.assertIn("Machine Learning Engineer", kept)
        self.assertIn("GenAI Engineer", kept)
        self.assertIn("LLM Engineer", kept)
        self.assertIn("Agentic Engineer", kept)
        self.assertIn("AI Engineer", kept)
        self.assertNotIn("Accountant", kept)
        self.assertNotIn("Marketing Manager", kept)

    def test_filter_title_ai_agent_query_requires_both_domain_signals(self):
        df = pd.DataFrame(
            [
                {"title": "Agentic Engineer"},
                {"title": "AI Agent Engineer"},
                {"title": "Backend Engineer"},
            ]
        )
        out = rj.filter_title(
            df,
            queries=["AI Agent Engineer"],
            enforce_include=True,
            exclude_terms=[],
            base_queries=["AI Agent Engineer"],
        )
        kept = out["title"].tolist()
        self.assertIn("Agentic Engineer", kept)
        self.assertIn("AI Agent Engineer", kept)
        self.assertNotIn("Backend Engineer", kept)

    def test_filter_title_ai_query_covers_the_wider_ai_vocabulary(self):
        # AI listings are titled across a whole vocabulary, not just "AI".
        # Every one of these is the role the user searched for; none of them
        # shares a literal token with "AI Engineer".
        df = pd.DataFrame(
            [
                {"title": "MLOps Engineer"},
                {"title": "Data Scientist"},
                {"title": "Senior Data Scientist"},
                {"title": "Computer Vision Engineer"},
                {"title": "Prompt Engineer"},
                {"title": "Deep Learning Engineer"},
                {"title": "NLP Engineer"},
                # Generic engineering must still stay out of an AI search.
                {"title": "Software Engineer"},
                {"title": "Backend Engineer"},
                {"title": "Data Engineer"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=["AI Engineer", "Machine Learning Engineer"],
            enforce_include=True,
            exclude_terms=[],
            base_queries=["AI Engineer"],
        )

        kept = out["title"].tolist()
        for title in (
            "MLOps Engineer",
            "Data Scientist",
            "Senior Data Scientist",
            "Computer Vision Engineer",
            "Prompt Engineer",
            "Deep Learning Engineer",
            "NLP Engineer",
        ):
            self.assertIn(title, kept)
        for title in ("Software Engineer", "Backend Engineer", "Data Engineer"):
            self.assertNotIn(title, kept)

    def test_filter_title_generic_query_keeps_same_family_roles(self):
        # "Software Engineer" carries no domain to narrow on, so every titled
        # engineering role is a legitimate hit. Requiring the literal token
        # "software" previously threw away the bulk of the result set.
        df = pd.DataFrame(
            [
                {"title": "Developer"},
                {"title": "Senior Developer"},
                {"title": "Python Developer"},
                {"title": "Backend Engineer"},
                {"title": "Software Engineer"},
                {"title": "Accountant"},
                {"title": "Registered Nurse"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Software Engineer", "Software Developer"],
            enforce_include=True,
            exclude_terms=[],
            base_queries=["Software Engineer"],
        )

        kept = out["title"].tolist()
        for title in (
            "Developer",
            "Senior Developer",
            "Python Developer",
            "Backend Engineer",
            "Software Engineer",
        ):
            self.assertIn(title, kept)
        self.assertNotIn("Accountant", kept)
        self.assertNotIn("Registered Nurse", kept)

    def test_filter_title_full_stack_query_stays_a_domain_signal(self):
        # "full stack" normalizes to one token; treating it as a generic word
        # erased the only signal the query had and matched every role.
        df = pd.DataFrame(
            [
                {"title": "Full Stack Engineer"},
                {"title": "Fullstack Engineer (React/Node)"},
                {"title": "AI Full Stack Engineer"},
                {"title": "Software Engineer"},
                {"title": "Backend Engineer"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Full Stack Engineer", "Full Stack Developer"],
            enforce_include=True,
            exclude_terms=[],
            base_queries=["Full Stack Engineer"],
        )

        kept = out["title"].tolist()
        self.assertEqual(
            kept,
            [
                "Full Stack Engineer",
                "Fullstack Engineer (React/Node)",
                "AI Full Stack Engineer",
            ],
        )

    def test_filter_title_backend_query_keeps_its_own_role_pack(self):
        # The backend pack expands into API / Platform titles. Without a domain
        # class the base-query gate rejected every one of them, so the fetcher
        # spent LinkedIn budget on rows it could never keep.
        df = pd.DataFrame(
            [
                {"title": "Backend Engineer"},
                {"title": "API Engineer"},
                {"title": "Platform Engineer"},
                {"title": "Senior Backend Developer"},
                # Other domains must stay out.
                {"title": "AI Engineer"},
                {"title": "Data Engineer"},
                {"title": "Accountant"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Backend Engineer", "API Engineer", "Platform Engineer"],
            enforce_include=True,
            exclude_terms=[],
            base_queries=["Backend Engineer"],
        )

        kept = out["title"].tolist()
        for title in (
            "Backend Engineer",
            "API Engineer",
            "Platform Engineer",
            "Senior Backend Developer",
        ):
            self.assertIn(title, kept)
        for title in ("AI Engineer", "Data Engineer", "Accountant"):
            self.assertNotIn(title, kept)

    def test_filter_title_data_query_keeps_its_own_role_pack(self):
        df = pd.DataFrame(
            [
                {"title": "Data Engineer"},
                {"title": "Analytics Engineer"},
                {"title": "ETL Developer"},
                {"title": "Big Data Engineer"},
                {"title": "Backend Engineer"},
                {"title": "Marketing Manager"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Data Engineer", "Analytics Engineer", "ETL Developer"],
            enforce_include=True,
            exclude_terms=[],
            base_queries=["Data Engineer"],
        )

        kept = out["title"].tolist()
        for title in (
            "Data Engineer",
            "Analytics Engineer",
            "ETL Developer",
            "Big Data Engineer",
        ):
            self.assertIn(title, kept)
        for title in ("Backend Engineer", "Marketing Manager"):
            self.assertNotIn(title, kept)

    def test_filter_title_power_platform_query_keeps_the_product_family(self):
        # "Power Platform Developer" requires BOTH "power" and "platform", but
        # none of the products in that ecosystem repeat those tokens — the pack
        # was effectively non-functional under the gate.
        df = pd.DataFrame(
            [
                {"title": "Power Platform Developer"},
                {"title": "Power Apps Developer"},
                {"title": "Power Automate Developer"},
                {"title": "Copilot Studio Developer"},
                {"title": "Dynamics 365 Developer"},
                {"title": "Software Engineer"},
                {"title": "Backend Engineer"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=[
                "Power Platform Developer",
                "Power Apps Developer",
                "Copilot Studio Developer",
                "Dynamics 365 Developer",
            ],
            enforce_include=True,
            exclude_terms=[],
            base_queries=["Power Platform Developer"],
        )

        kept = out["title"].tolist()
        for title in (
            "Power Platform Developer",
            "Power Apps Developer",
            "Power Automate Developer",
            "Copilot Studio Developer",
            "Dynamics 365 Developer",
        ):
            self.assertIn(title, kept)
        for title in ("Software Engineer", "Backend Engineer"):
            self.assertNotIn(title, kept)

    def test_filter_title_platform_query_does_not_pull_the_power_family(self):
        # A plain "Platform Engineer" search must NOT inherit the Power Platform
        # product family: that family is keyed on both of its tokens together.
        df = pd.DataFrame(
            [
                {"title": "Platform Engineer"},
                {"title": "Copilot Studio Developer"},
                {"title": "Dynamics 365 Developer"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Platform Engineer"],
            enforce_include=True,
            exclude_terms=[],
            base_queries=["Platform Engineer"],
        )

        kept = out["title"].tolist()
        self.assertIn("Platform Engineer", kept)
        self.assertNotIn("Copilot Studio Developer", kept)
        self.assertNotIn("Dynamics 365 Developer", kept)

    def test_filter_title_matches_mixed_chinese_and_ascii_role_query(self):
        df = pd.DataFrame(
            [
                {"title": "高级Java后端开发工程师"},
                {"title": "高级JavaScript后端开发工程师"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Java开发工程师"],
            enforce_include=True,
            exclude_terms=[],
        )

        self.assertEqual(out["title"].tolist(), ["高级Java后端开发工程师"])

    def test_domain_search_keeps_the_role_pack_it_expanded_into(self):
        # Smart expand pulls sibling engineering roles into the search, and the
        # fetcher really requests them. The base gate then dropped every one,
        # so the run spent LinkedIn budget on rows it could never keep and the
        # user saw only literal AI titles.
        df = pd.DataFrame(
            [
                {"title": "AI Engineer"},
                {"title": "Machine Learning Engineer"},
                {"title": "Software Engineer"},
                {"title": "Full Stack Engineer"},
                {"title": "Backend Engineer"},
                {"title": "Python Developer"},
                # Nothing outside the engineering family may ride along.
                {"title": "Chef"},
                {"title": "Barista"},
                {"title": "Registered Nurse"},
                {"title": "Accountant"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=[
                "AI Engineer",
                "Machine Learning Engineer",
                "Software Engineer",
                "Full Stack Engineer",
                "Backend Engineer",
            ],
            base_queries=["AI Engineer"],
            enforce_include=True,
            exclude_terms=[],
        )

        kept = out["title"].tolist()
        for title in (
            "AI Engineer",
            "Machine Learning Engineer",
            "Software Engineer",
            "Full Stack Engineer",
            "Backend Engineer",
            "Python Developer",
        ):
            self.assertIn(title, kept)
        for title in ("Chef", "Barista", "Registered Nurse", "Accountant"):
            self.assertNotIn(title, kept)

    def test_expansion_still_cannot_widen_a_named_technology(self):
        # The relaxation is scoped to a domain base query. Naming a specific
        # stack still pins the results to it — searching Java must not return
        # Python roles just because both are "engineering".
        df = pd.DataFrame(
            [
                {"title": "Senior Java Backend Engineer"},
                {"title": "Python Developer"},
                {"title": "Ruby Engineer"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Java Backend Developer", "Backend Engineer", "Software Engineer"],
            base_queries=["Java backend developer"],
            enforce_include=True,
            exclude_terms=[],
        )

        self.assertEqual(out["title"].tolist(), ["Senior Java Backend Engineer"])

    def test_smart_expand_cannot_bypass_original_technical_direction(self):
        df = pd.DataFrame(
            [
                {"title": "Software Engineer"},
                {"title": "Platform Engineer"},
                {"title": "JavaScript Backend Engineer"},
                {"title": "Senior Java Backend Engineer"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=[
                "Java Backend Developer",
                "Backend Engineer",
                "Software Engineer",
                "Platform Engineer",
            ],
            base_queries=["Java backend developer"],
            enforce_include=True,
            exclude_terms=[],
        )

        self.assertEqual(out["title"].tolist(), ["Senior Java Backend Engineer"])

    def test_smart_expand_still_works_when_base_query_has_only_generic_signals(self):
        df = pd.DataFrame(
            [
                {"title": "Software Engineer"},
                {"title": "AI Engineer"},
            ]
        )

        out = rj.filter_title(
            df,
            queries=["Software Engineer", "AI Engineer"],
            base_queries=["Software Engineer"],
            enforce_include=True,
            exclude_terms=[],
        )

        self.assertEqual(out["title"].tolist(), ["Software Engineer", "AI Engineer"])

    def test_resolve_base_queries_supports_new_and_legacy_runs(self):
        self.assertEqual(
            rj._resolve_base_queries(
                {
                    "title": "Java Developer",
                    "queries": ["Java Developer", "Software Engineer"],
                    "baseQueries": ["Java Developer"],
                    "smartExpand": True,
                },
                "Java Developer",
                ["Java Developer", "Software Engineer"],
            ),
            ["Java Developer"],
        )
        self.assertEqual(
            rj._resolve_base_queries(
                {
                    "title": "Java Developer",
                    "queries": ["Java Developer", "Software Engineer"],
                    "smartExpand": True,
                },
                "Java Developer",
                ["Java Developer", "Software Engineer"],
            ),
            ["Java Developer"],
        )
        self.assertEqual(
            rj._resolve_base_queries(
                {
                    "title": "Java Developer",
                    "queries": ["Java Developer", "Backend Developer"],
                    "smartExpand": False,
                },
                "Java Developer",
                ["Java Developer", "Backend Developer"],
            ),
            ["Java Developer", "Backend Developer"],
        )
        self.assertEqual(
            rj._resolve_base_queries(
                ["Java Developer", "Backend Developer"],
                "Java Developer",
                ["Java Developer", "Backend Developer"],
            ),
            ["Java Developer", "Backend Developer"],
        )

    def test_filter_location_drops_known_interstate_noise_without_dropping_remote(self):
        df = pd.DataFrame(
            [
                {"title": "A", "location": "Melbourne VIC"},
                {"title": "B", "location": "Chatswood NSW"},
                {"title": "C", "location": "Remote - Australia"},
                {"title": "D", "location": ""},
            ]
        )

        out, audit = rj.filter_location(
            df,
            requested_location="Sydney, New South Wales, Australia",
        )

        self.assertEqual(out["title"].tolist(), ["B", "C", "D"])
        self.assertEqual(audit.iloc[0]["rule"], "location_mismatch")

    def test_filter_location_prefers_explicit_state_over_ambiguous_place_name(self):
        df = pd.DataFrame(
            [
                {"title": "Keep", "location": "Victoria Point QLD"},
                {"title": "Drop", "location": "Melbourne VIC"},
            ]
        )

        out, audit = rj.filter_location(
            df,
            requested_location="Brisbane QLD, Australia",
        )

        self.assertEqual(out["title"].tolist(), ["Keep"])
        self.assertEqual(audit["title"].tolist(), ["Drop"])

    def test_filter_listing_age_rejects_known_stale_rows_but_keeps_unknown_dates(self):
        df = pd.DataFrame(
            [
                {"title": "Fresh", "listing_date": "2026-07-19T10:00:00Z"},
                {"title": "Stale", "listing_date": "2026-07-14T10:00:00Z"},
                {"title": "Unknown", "listing_date": ""},
            ]
        )

        out, audit = rj.filter_listing_age(
            df,
            hours_old=48,
            now=pd.Timestamp("2026-07-19T12:00:00Z"),
        )

        self.assertEqual(out["title"].tolist(), ["Fresh", "Unknown"])
        self.assertEqual(audit.iloc[0]["rule"], "listing_too_old")

    def test_filter_job_quality_blocks_access_walls_and_unverifiable_empty_jd(self):
        df = pd.DataFrame(
            [
                {
                    "job_url": "https://linkedin.com/jobs/view/1",
                    "title": "Software Engineer",
                    "description": "Build reliable APIs and distributed systems.",
                },
                {
                    "job_url": "https://linkedin.com/jobs/view/2",
                    "title": "Data Engineer",
                    "description": "Sign in to view this job",
                },
                {
                    "job_url": "https://linkedin.com/jobs/view/3",
                    "title": "Frontend Engineer",
                    "description": "",
                },
            ]
        )

        out, audit = rj.filter_job_quality(df, require_description=True)

        self.assertEqual(out["title"].tolist(), ["Software Engineer"])
        self.assertEqual(
            audit["rule"].tolist(),
            ["invalid_description", "missing_description"],
        )

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

    def test_keep_columns_preserves_normalized_listing_date(self):
        df = pd.DataFrame(
            [
                {
                    "job_url": "https://linkedin.com/jobs/view/1",
                    "title": "Software Engineer",
                    "date_posted": pd.Timestamp("2026-07-19T10:00:00Z"),
                }
            ]
        )

        out = rj.keep_columns(df)

        self.assertEqual(out.iloc[0]["listing_date"], "2026-07-19T10:00:00+00:00")

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

    def test_detail_url_guard_rejects_private_dns_and_non_https(self):
        def private_resolver(host, port, type):
            self.assertEqual(host, "jobs.example.com")
            self.assertEqual(port, 443)
            self.assertEqual(type, rj.socket.SOCK_STREAM)
            return [(rj.socket.AF_INET, type, 6, "", ("169.254.169.254", port))]

        with self.assertRaisesRegex(ValueError, "non_public"):
            rj._assert_safe_detail_url(
                "https://jobs.example.com/role/1",
                resolver=private_resolver,
            )
        with self.assertRaisesRegex(ValueError, "https_required"):
            rj._assert_safe_detail_url("http://1.1.1.1/role/1")

    def test_detail_url_guard_requires_every_dns_answer_to_be_public(self):
        def split_horizon_resolver(host, port, type):
            return [
                (rj.socket.AF_INET, type, 6, "", ("1.1.1.1", port)),
                (rj.socket.AF_INET, type, 6, "", ("127.0.0.1", port)),
            ]

        with self.assertRaisesRegex(ValueError, "non_public"):
            rj._assert_safe_detail_url(
                "https://jobs.example.com/role/1",
                resolver=split_horizon_resolver,
            )

    def test_detail_url_guard_uses_dot_anchored_allowlist(self):
        with self.assertRaisesRegex(ValueError, "host_not_allowed"):
            rj._assert_safe_detail_url(
                "https://evil-linkedin.com/role/1",
                allowed_hosts=["linkedin.com"],
                resolver=lambda *_args, **_kwargs: [],
            )

    def test_detail_redirect_is_revalidated_before_second_request(self):
        class RedirectResponse:
            status_code = 302
            headers = {"location": "https://127.0.0.1/admin"}
            encoding = "utf-8"

            def close(self):
                return None

            def iter_content(self, chunk_size):
                return iter(())

        request = Mock(return_value=RedirectResponse())
        with patch.object(rj.requests, "get", request):
            with self.assertRaisesRegex(ValueError, "non_public"):
                rj._request_safe_detail_text(
                    "https://1.1.1.1/start",
                    timeout_sec=1,
                    headers={"User-Agent": "test"},
                    proxies=None,
                )
        self.assertEqual(request.call_count, 1)

if __name__ == "__main__":
    unittest.main()
