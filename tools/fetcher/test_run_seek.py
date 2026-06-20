import json
import sys

import pytest
import requests

import run_seek as rs

REAL_RAW = {
    "id": "92521602",
    "title": "AI Software Engineer",
    "companyName": "Opus Recruitment Solutions",
    "advertiser": {"description": "Opus"},
    "locations": [{"label": "Sydney NSW"}],
    "workTypes": ["Full time"],
    "teaser": "Forefront of AI",
    "bulletPoints": ["$200,000 - $300,000", "Be part of a global AI Leader"],
}


# ── Test doubles ───────────────────────────────────────────────────────────
class Clock:
    def __init__(self, t=0.0):
        self.t = t

    def __call__(self):
        return self.t


class FakeResp:
    def __init__(self, status=200, text="{}", json_data=None, ct="application/json",
                 headers=None, raise_json=False):
        self.status_code = status
        self.text = text
        self._json = {} if json_data is None else json_data
        self._raise_json = raise_json
        self.headers = {"content-type": ct}
        if headers:
            self.headers.update(headers)
        self.ok = 200 <= status < 300

    def json(self):
        if self._raise_json:
            raise ValueError("no json")
        return self._json


class FakeSession:
    def __init__(self, responses):
        self._responses = list(responses)
        self.headers = {}
        self.calls = []

    def get(self, url, params=None, timeout=None, **kw):
        self.calls.append((url, params))
        item = self._responses.pop(0) if self._responses else FakeResp()
        if isinstance(item, Exception):
            raise item
        return item

    def post(self, url, data=None, headers=None, timeout=None, **kw):
        self.calls.append((url, data))
        item = self._responses.pop(0) if self._responses else FakeResp()
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture
def fast(monkeypatch):
    monkeypatch.setenv("SEEK_FETCH_ENABLED", "true")
    monkeypatch.setattr(rs.time, "sleep", lambda *a, **k: None)
    monkeypatch.setattr(rs.random, "uniform", lambda *a, **k: 0.0)


# ── Pure helpers ───────────────────────────────────────────────────────────
def test_seek_job_url_valid_and_invalid():
    assert rs.seek_job_url("123") == "https://au.seek.com/job/123"
    assert rs.seek_job_url("1/../x") == ""
    assert rs.seek_job_url("") == ""


def test_is_valid_seek_id():
    assert rs.is_valid_seek_id("92521602") is True
    assert rs.is_valid_seek_id("12ab") is False
    assert rs.is_valid_seek_id(None) is False


def test_is_seek_host():
    assert rs.is_seek_host("https://au.seek.com/job/1") is True
    assert rs.is_seek_host("https://evil.com/job/1") is False
    assert rs.is_seek_host("https://au.seek.com.evil.com/x") is False


def test_build_queries_from_config_threads_filters():
    run = {
        "queries": {
            "queries": ["dev"],
            "classification": "6281",
            "subClassification": "6290",
            "workType": "242",
        }
    }
    q = rs.build_queries_from_config(run)[0]
    assert q["work_type"] == "242"
    assert q["sub_classification"] == "6290"
    assert "salary_min" not in q


@pytest.mark.parametrize(
    "status,ct,body,expected",
    [
        (200, "application/json", "{}", "ok"),
        (200, "text/html", "<html>jobs</html>", "ok"),  # warm-up page is fine
        (403, "text/html", "blocked", "challenge"),
        (200, "text/html", "<title>Just a moment...</title>", "challenge"),
        (200, "text/html", "cf-mitigated", "challenge"),
        (200, "text/html", "Attention Required", "challenge"),
        (429, "application/json", "{}", "transient"),
        (503, "application/json", "{}", "transient"),
        (500, "text/plain", "err", "transient"),
        (404, "application/json", "{}", "client_error"),
        (400, "application/json", "{}", "client_error"),
    ],
)
def test_classify_response(status, ct, body, expected):
    assert rs.classify_response(status, ct, body) == expected


def test_retry_after_seconds():
    assert rs.retry_after_seconds({"Retry-After": "10"}) == 10.0
    assert rs.retry_after_seconds({"Retry-After": "99999"}) == rs.RETRY_AFTER_CAP_SEC
    assert rs.retry_after_seconds({}) is None
    assert rs.retry_after_seconds({"Retry-After": "soon"}) is None


def test_map_job_real_record():
    m = rs.map_job(REAL_RAW)
    assert m["job_url"] == "https://au.seek.com/job/92521602"
    assert m["title"] == "AI Software Engineer"
    assert m["company"] == "Opus Recruitment Solutions"
    assert m["location"] == "Sydney NSW"
    assert m["job_type"] == "Full time"
    assert "Forefront of AI" in m["description"]
    assert "$200,000 - $300,000" in m["description"]


def test_map_job_captures_salary_arrangement_listing():
    raw = {
        **REAL_RAW,
        "salaryLabel": "$200,000 - $300,000 per year",
        "workArrangements": {"data": [{"label": "Remote"}]},
        "listingDate": "2026-06-04T09:56:12Z",
    }
    m = rs.map_job(raw)
    assert m["salary"] == "$200,000 - $300,000 per year"
    assert m["work_arrangement"] == "Remote"
    assert m["listing_date"] == "2026-06-04T09:56:12Z"


def test_map_job_company_fallback_to_advertiser():
    assert rs.map_job({"id": "1", "title": "T", "advertiser": {"description": "AdCo"}})["company"] == "AdCo"


def test_map_job_rejects_missing_or_nonnumeric_id():
    assert rs.map_job({"title": "T"}) is None
    assert rs.map_job({"id": "1"}) is None
    assert rs.map_job({"id": "1/../evil", "title": "T"}) is None  # SSRF guard
    assert rs.map_job({"id": "abc", "title": "T"}) is None
    assert rs.map_job("x") is None


def test_map_job_truncates_long_title():
    assert len(rs.map_job({"id": "1", "title": "A" * 1000})["title"]) == rs.MAX_TITLE


def test_dedupe_by_url():
    items = [{"job_url": "a"}, {"job_url": "a"}, {"job_url": "b"}, {"job_url": ""}]
    assert [i["job_url"] for i in rs.dedupe_by_url(items)] == ["a", "b"]


def test_build_exclude_title_re_word_boundary():
    rx = rs.build_exclude_title_re(["lead"])
    assert rx.search("Tech Lead")
    assert not rx.search("Leadership Program")  # word-boundary, not a prefix match
    assert rs.build_exclude_title_re([]) is None


def test_apply_title_exclusions():
    items = [{"title": "Senior Manager, AI"}, {"title": "AI Engineer"}, {"title": "Principal Architect"}]
    out = rs.apply_title_exclusions(items, ["senior", "manager", "principal", "architect"])
    assert [i["title"] for i in out] == ["AI Engineer"]
    assert rs.apply_title_exclusions(items, []) == items


def test_extract_domain_tokens():
    assert rs.extract_domain_tokens(["AI Engineer"]) == {"ai"}
    assert rs.extract_domain_tokens(["Software Engineer"]) == {"software"}
    assert rs.extract_domain_tokens(["Engineer"]) == set()  # all-generic -> no domain
    assert rs.extract_domain_tokens(["Machine Learning"]) == {"machine", "learning"}


def test_filter_relevant_titles_recall_keeps_role_family_drops_unrelated():
    # Recall-oriented: a title sharing ANY query token (domain word "ai" OR role
    # word "engineer") is kept; only titles sharing no token are dropped.
    items = [
        {"title": "AI Software Engineer"},  # ai + engineer
        {"title": "Elixir Developer"},       # shares nothing -> dropped
        {"title": "Systems Engineer"},       # engineer -> kept (role family)
        {"title": "Graduate AI Engineer"},   # ai + engineer
    ]
    out = rs.filter_relevant_titles(items, ["AI Engineer"])
    assert [i["title"] for i in out] == [
        "AI Software Engineer",
        "Systems Engineer",
        "Graduate AI Engineer",
    ]


def test_filter_relevant_titles_matches_on_token_boundary_not_substring():
    # "ai" must NOT match inside "Maintainer" — relevance is token-anchored, not
    # a naive substring search (the precompiled boundary regex guarantees this).
    items = [{"title": "Maintainer"}, {"title": "AI Specialist"}]
    out = [i["title"] for i in rs.filter_relevant_titles(items, ["AI Engineer"])]
    assert out == ["AI Specialist"]


def test_filter_relevant_titles_generic_query_keeps_all():
    items = [{"title": "Backend Developer"}, {"title": "Systems Engineer"}]
    assert rs.filter_relevant_titles(items, ["Engineer"]) == items


def test_filter_relevant_titles_drops_all_when_nothing_matches():
    # Nothing carries the domain token -> return NOTHING, not the full list.
    # Dumping the unfiltered list here is what surfaced unrelated roles (e.g.
    # "Network Engineer" for a "Software Engineer" query).
    items = [{"title": "Elixir Developer"}]
    assert rs.filter_relevant_titles(items, ["AI Engineer"]) == []


def test_token_boundary_handles_tech_symbols():
    # \b breaks inside c++/c#; lookaround boundaries must keep them working for
    # both exclusions and relevance, and single-char domain tokens (r) survive.
    rx = rs.build_exclude_title_re(["c++"])
    assert rx.search("C++ Lead Engineer")
    assert not rx.search("C Sharp Engineer")
    items = [{"title": "C++ Engineer"}, {"title": "Python Developer"}]
    assert [i["title"] for i in rs.filter_relevant_titles(items, ["C++ Engineer"])] == ["C++ Engineer"]
    assert rs.extract_domain_tokens(["R Developer"]) == {"r"}


def test_classify_response_ignores_needle_in_json_body():
    assert rs.classify_response(200, "application/json", '{"title":"Attention Required: Officer"}') == "ok"
    assert rs.classify_response(200, "text/html", "Attention Required") == "challenge"


def test_import_items_partial_failure_preserves_count(monkeypatch):
    monkeypatch.setenv("IMPORT_SECRET", "s")
    monkeypatch.setattr(rs.time, "sleep", lambda *a, **k: None)
    calls = {"n": 0}

    def fake_post(url, headers=None, data=None, timeout=None):
        calls["n"] += 1
        body = json.loads(data)
        if calls["n"] == 1:
            return FakeResp(200, json_data={"imported": len(body["items"])})
        return FakeResp(500, text="err")

    monkeypatch.setattr(rs.requests, "post", fake_post)
    items = [{"job_url": str(i)} for i in range(60)]  # 50 + 10
    with pytest.raises(rs.PartialImportError) as excinfo:
        rs.import_items("https://x", "e", items)
    assert excinfo.value.imported == 50


def test_run_from_config_reports_partial_import_count(monkeypatch):
    monkeypatch.setenv("JOBLIT_WEB_URL", "https://w")
    monkeypatch.setenv("FETCH_RUN_SECRET", "s")
    monkeypatch.setattr(rs, "fetch_run_config", lambda *a, **k: {"userEmail": "e@x", "queries": {"queries": ["ai"]}})
    updates = []
    monkeypatch.setattr(rs, "update_run", lambda base, rid, h, payload: updates.append(payload))
    monkeypatch.setattr(rs, "collect_jobs", lambda *a, **k: [{"job_url": "u", "title": "AI Engineer"}])

    def boom(*a, **k):
        raise rs.PartialImportError(50, RuntimeError("import status=500"))

    monkeypatch.setattr(rs, "import_items", boom)
    assert rs.run_from_config("rid") == 1
    assert any(u.get("status") == "FAILED" and u.get("importedCount") == 50 for u in updates)


def test_run_from_config_reports_blocked_when_challenge_and_no_rows(monkeypatch):
    # Anti-bot challenge before any row arrived must surface as FAILED with a
    # challenge marker (so the UI shows "blocked / rate-limited"), NOT a silent
    # SUCCEEDED imported=0 that reads as "Seek finds nothing".
    monkeypatch.setenv("JOBLIT_WEB_URL", "https://w")
    monkeypatch.setenv("FETCH_RUN_SECRET", "s")
    monkeypatch.setattr(rs, "fetch_run_config", lambda *a, **k: {"userEmail": "e@x", "queries": {"queries": ["ai"]}})
    updates = []
    monkeypatch.setattr(rs, "update_run", lambda base, rid, h, payload: updates.append(payload))

    def blocked(fetcher, queries, *, stats_out=None, **k):
        if stats_out is not None:
            stats_out.update({"queries": 1, "raw": 0, "mapped": 0, "challenges": 1})
        return []

    monkeypatch.setattr(rs, "collect_jobs", blocked)
    # Exit 0: an upstream anti-bot block is not a worker fault, so it must not
    # red the CI run — but the DB run is still marked FAILED with a challenge
    # marker so the app surfaces it.
    assert rs.run_from_config("rid") == 0
    assert any(
        u.get("status") == "FAILED" and "challenge" in (u.get("error") or "")
        for u in updates
    )


def test_run_from_config_genuine_empty_stays_succeeded(monkeypatch):
    # No challenge + zero rows = a real "no new jobs" result. Must stay a clean
    # SUCCEEDED imported=0, never the blocked/FAILED path.
    monkeypatch.setenv("JOBLIT_WEB_URL", "https://w")
    monkeypatch.setenv("FETCH_RUN_SECRET", "s")
    monkeypatch.setattr(rs, "fetch_run_config", lambda *a, **k: {"userEmail": "e@x", "queries": {"queries": ["ai"]}})
    updates = []
    monkeypatch.setattr(rs, "update_run", lambda base, rid, h, payload: updates.append(payload))

    def empty(fetcher, queries, *, stats_out=None, **k):
        if stats_out is not None:
            stats_out.update({"queries": 1, "raw": 0, "mapped": 0, "challenges": 0})
        return []

    monkeypatch.setattr(rs, "collect_jobs", empty)
    assert rs.run_from_config("rid") == 0
    assert any(u.get("status") == "SUCCEEDED" and u.get("importedCount") == 0 for u in updates)
    assert not any(u.get("status") == "FAILED" for u in updates)


# ── Orchestration: collect_jobs ────────────────────────────────────────────
class _Fetcher:
    def __init__(self, per_query, enrich_val="FULL"):
        self._per_query = per_query
        self._i = 0
        self.enriched = []
        self._enrich_val = enrich_val

    def search_graphql_paginated(self, **q):
        item = self._per_query[self._i]
        self._i += 1
        if isinstance(item, Exception):
            raise item
        return item

    def enrich_description(self, url):
        self.enriched.append(url)
        return self._enrich_val


def test_collect_jobs_maps_and_dedupes():
    raw = [REAL_RAW, dict(REAL_RAW), {"id": "2", "title": "Dev", "companyName": "X"}]
    out = rs.collect_jobs(_Fetcher([raw]), [{}])
    assert [r["job_url"] for r in out] == [
        "https://au.seek.com/job/92521602",
        "https://au.seek.com/job/2",
    ]


def test_collect_jobs_stops_on_challenge_keeps_partial():
    f = _Fetcher([[{"id": "1", "title": "A"}], rs.SeekChallengeError("blocked"), [{"id": "9", "title": "B"}]])
    out = rs.collect_jobs(f, [{}, {}, {}])
    assert [r["job_url"] for r in out] == ["https://au.seek.com/job/1"]


def test_collect_jobs_skips_failed_query_keeps_rest():
    f = _Fetcher([RuntimeError("oops"), [{"id": "9", "title": "B"}]])
    out = rs.collect_jobs(f, [{}, {}])
    assert [r["job_url"] for r in out] == ["https://au.seek.com/job/9"]


def test_collect_jobs_respects_max_total():
    raw = [{"id": str(i), "title": "t"} for i in range(10)]
    assert len(rs.collect_jobs(_Fetcher([raw]), [{}], max_total=3)) == 3


# ── graphql JobSearchV6 (current Seek search stack) ────────────────────────
REAL_GQL = {
    "id": "92319306",
    "title": "Software engineer",
    "teaser": "Flynt is a new ERP platform.",
    "companyName": "Sorensen Engineering",
    "advertiser": {"description": "Sorensen Engineering"},
    "bulletPoints": ["Get in early", "See your work"],
    "salaryLabel": "",
    "workTypes": ["Contract/Temp"],
    "listingDate": {"dateTimeUtc": "2026-05-25T08:56:36.000Z"},
    "locations": [{"label": "Brookvale, Sydney NSW"}],
    "workArrangements": {"displayText": "Hybrid"},
}


def test_build_graphql_variables_uses_only_confirmed_fields():
    v = rs.build_graphql_variables(keywords="software engineer", page=2, page_size=50)
    p = v["params"]
    assert p["keywords"] == "software engineer"
    assert p["siteKey"] == "AU"  # not the legacy "AU-Main"
    assert p["page"] == 2 and p["pageSize"] == 50
    assert p["source"] == "FE_SERP"
    # No unverified filter fields are guessed into the input.
    for guessed in ("where", "classification", "subclassification", "workType", "dateRange"):
        assert guessed not in p


def test_build_graphql_variables_omits_blank_keywords():
    assert "keywords" not in rs.build_graphql_variables(keywords="  ")["params"]


def test_parse_graphql_payload_extracts_rows_and_total():
    payload = {"data": {"jobSearchV6": {"data": [REAL_GQL], "totalCount": 1784}}}
    parsed = rs.parse_graphql_payload(payload)
    assert parsed["total_count"] == 1784
    assert parsed["jobs"] == [REAL_GQL]


def test_parse_graphql_payload_surfaces_errors_as_empty():
    parsed = rs.parse_graphql_payload({"errors": [{"message": "Unknown field where"}]})
    assert parsed["jobs"] == [] and parsed["total_count"] == 0
    assert "where" in (parsed.get("error") or "")


def test_parse_graphql_payload_tolerates_garbage():
    assert rs.parse_graphql_payload({})["jobs"] == []
    assert rs.parse_graphql_payload(None)["jobs"] == []
    assert rs.parse_graphql_payload({"data": {"jobSearchV6": None}})["jobs"] == []


def test_map_job_handles_graphql_shape():
    row = rs.map_job(REAL_GQL)
    assert row is not None
    assert row["job_url"] == "https://au.seek.com/job/92319306"
    assert row["title"] == "Software engineer"
    assert row["company"] == "Sorensen Engineering"
    assert row["location"] == "Brookvale, Sydney NSW"
    assert row["work_arrangement"] == "Hybrid"  # graphql displayText
    assert row["listing_date"] == "2026-05-25T08:56:36.000Z"  # graphql dateTimeUtc
    assert row["job_type"] == "Contract/Temp"


def test_search_graphql_returns_json_when_ok(fast):
    sess = FakeSession([FakeResp(json_data={"data": {"jobSearchV6": {"data": [REAL_GQL], "totalCount": 1}}})])
    f = rs.SeekFetcher(session=sess)
    out = f.search_graphql(rs.build_graphql_variables(keywords="x"))
    assert out["data"]["jobSearchV6"]["totalCount"] == 1
    assert sess.calls[0][0] == rs.SEEK_GRAPHQL_URL  # hit the BFF, not /jobs or v5


def test_search_graphql_challenge_raises(fast):
    sess = FakeSession([FakeResp(403, text="blocked", ct="text/html")])
    with pytest.raises(rs.SeekChallengeError):
        rs.SeekFetcher(session=sess).search_graphql({"params": {}})


def test_search_graphql_paginated_no_warmup_stops_on_empty(fast):
    # graphql path must NOT warm up (/jobs) — it should go straight to the BFF,
    # and stop paginating on the first empty page.
    sess = FakeSession([
        FakeResp(json_data={"data": {"jobSearchV6": {"data": [REAL_GQL], "totalCount": 1}}}),
        FakeResp(json_data={"data": {"jobSearchV6": {"data": [], "totalCount": 1}}}),
    ])
    f = rs.SeekFetcher(session=sess)
    rows = f.search_graphql_paginated(keywords="software engineer", where="Sydney")
    assert [r["id"] for r in rows] == ["92319306"]
    assert all(c[0] == rs.SEEK_GRAPHQL_URL for c in sess.calls)  # no /jobs warm-up


# ── Orchestration: import_items ────────────────────────────────────────────
def test_import_items_requires_secret(monkeypatch):
    monkeypatch.delenv("IMPORT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="IMPORT_SECRET"):
        rs.import_items("https://x", "e", [{"job_url": "a"}])


def test_validate_import_base():
    assert rs._validate_import_base("https://w/") == "https://w"
    assert rs._validate_import_base("http://localhost:3000/") == "http://localhost:3000"
    with pytest.raises(RuntimeError, match="non-HTTPS"):
        rs._validate_import_base("http://evil.com")


def test_import_items_batches_and_sums(monkeypatch):
    monkeypatch.setenv("IMPORT_SECRET", "s")
    posts = []

    def fake_post(url, headers=None, data=None, timeout=None):
        body = json.loads(data)
        posts.append(body)
        return FakeResp(200, json_data={"imported": len(body["items"])})

    monkeypatch.setattr(rs.requests, "post", fake_post)
    items = [{"job_url": str(i)} for i in range(120)]
    assert rs.import_items("https://x", "e@x", items) == 120
    assert len(posts) == 3  # 50 + 50 + 20
    assert posts[0]["userEmail"] == "e@x"


def test_import_items_retries_then_succeeds(monkeypatch):
    monkeypatch.setenv("IMPORT_SECRET", "s")
    monkeypatch.setattr(rs.time, "sleep", lambda *a, **k: None)
    seq = [FakeResp(502, text="bad"), FakeResp(200, json_data={"imported": 1})]
    monkeypatch.setattr(rs.requests, "post", lambda *a, **k: seq.pop(0))
    assert rs.import_items("https://x", "e", [{"job_url": "a"}]) == 1


def test_import_items_permanent_failure_raises(monkeypatch):
    monkeypatch.setenv("IMPORT_SECRET", "s")
    monkeypatch.setattr(rs.time, "sleep", lambda *a, **k: None)
    monkeypatch.setattr(rs.requests, "post", lambda *a, **k: FakeResp(500, text="err"))
    with pytest.raises(RuntimeError, match="import status=500"):
        rs.import_items("https://x", "e", [{"job_url": "a"}])


# ── main ───────────────────────────────────────────────────────────────────
def test_main_dry_run_skips_import(monkeypatch):
    monkeypatch.setattr(rs, "collect_jobs", lambda *a, **k: [
        {"title": "T", "company": "C", "location": "L", "job_url": "u"}
    ])
    spy = []
    monkeypatch.setattr(rs, "import_items", lambda *a, **k: spy.append(1) or 0)
    monkeypatch.setattr(sys, "argv", ["run_seek.py", "--keywords", "x", "--dry-run"])
    assert rs.main() == 0
    assert spy == []


def test_main_imports_when_args_present(monkeypatch):
    monkeypatch.setattr(rs, "collect_jobs", lambda *a, **k: [
        {"title": "X Engineer", "company": "C", "location": "L", "job_url": "u"}
    ])
    called = []
    monkeypatch.setattr(rs, "import_items", lambda base, email, items: called.append((base, email, len(items))) or 5)
    monkeypatch.setattr(sys, "argv",
                        ["run_seek.py", "--keywords", "x", "--import-base", "https://w", "--user-email", "e@x"])
    assert rs.main() == 0
    assert called == [("https://w", "e@x", 1)]


def test_main_missing_email_falls_to_dry_run(monkeypatch):
    monkeypatch.delenv("SEEK_USER_EMAIL", raising=False)
    monkeypatch.delenv("JOBLIT_WEB_URL", raising=False)
    monkeypatch.setattr(rs, "collect_jobs", lambda *a, **k: [])
    spy = []
    monkeypatch.setattr(rs, "import_items", lambda *a, **k: spy.append(1) or 0)
    monkeypatch.setattr(sys, "argv", ["run_seek.py", "--import-base", "https://w"])
    assert rs.main() == 0
    assert spy == []


def test_main_returns_1_on_failure(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(rs, "collect_jobs", boom)
    monkeypatch.setattr(sys, "argv", ["run_seek.py", "--keywords", "x", "--dry-run"])
    assert rs.main() == 1


# ── Run-config mode ────────────────────────────────────────────────────────
def test_normalize_seek_where():
    # LinkedIn-style "City, State, Country" -> Seek city token (the bug fix).
    assert rs.normalize_seek_where("Sydney, New South Wales, Australia") == "Sydney"
    assert rs.normalize_seek_where("Sydney NSW") == "Sydney NSW"
    assert rs.normalize_seek_where("All Australia") == "All Australia"
    assert rs.normalize_seek_where("") == rs.DEFAULT_WHERE
    assert rs.normalize_seek_where(None) == rs.DEFAULT_WHERE


def test_build_queries_from_config():
    # The UI sends a LinkedIn-style location; the worker must normalize it to a
    # Seek-accepted `where` token, else Seek returns zero results.
    run = {
        "location": "Sydney, New South Wales, Australia",
        "queries": {"queries": ["dev", "data"], "classification": "6281", "daterange": 3},
    }
    qs = rs.build_queries_from_config(run)
    assert len(qs) == 2
    assert qs[0] == {
        "keywords": "dev",
        "classification": "6281",
        "sub_classification": "",
        "where": "Sydney",
        "daterange_days": 3,
        "max_pages": rs.SEEK_PAGE_CEILING,
        "work_type": "",
    }


def test_build_queries_from_config_falls_back_to_title():
    qs = rs.build_queries_from_config({"queries": {"title": "engineer"}})
    assert qs[0]["keywords"] == "engineer"
    assert qs[0]["where"] == rs.DEFAULT_WHERE
    assert qs[0]["daterange_days"] == rs.DEFAULT_DATERANGE_DAYS


def test_is_cancelled():
    assert rs.is_cancelled({"status": "FAILED", "error": "Cancelled by user"}) is True
    assert rs.is_cancelled({"status": "RUNNING"}) is False


def test_run_from_config_success(monkeypatch):
    monkeypatch.setenv("JOBLIT_WEB_URL", "https://w")
    monkeypatch.setenv("FETCH_RUN_SECRET", "s")
    run = {"userEmail": "e@x", "location": "Sydney NSW", "queries": {"queries": ["dev"]}}
    monkeypatch.setattr(rs, "fetch_run_config", lambda *a, **k: run)
    updates = []
    monkeypatch.setattr(rs, "update_run", lambda base, rid, h, payload: updates.append(payload))
    # Title must carry the query token ("dev") — relevance now drops non-matches
    # instead of dumping the full list.
    monkeypatch.setattr(rs, "collect_jobs", lambda fetcher, queries, **k: [{"job_url": "u", "title": "Dev Engineer"}])
    monkeypatch.setattr(rs, "import_items", lambda base, email, items: 7)
    assert rs.run_from_config("rid") == 0
    assert {"status": "RUNNING"} in updates
    assert any(u.get("status") == "SUCCEEDED" and u.get("importedCount") == 7 for u in updates)


def test_run_from_config_cancelled_before_start(monkeypatch):
    monkeypatch.setenv("JOBLIT_WEB_URL", "https://w")
    monkeypatch.setenv("FETCH_RUN_SECRET", "s")
    monkeypatch.setattr(rs, "fetch_run_config", lambda *a, **k: {"status": "FAILED", "error": "Cancelled by user"})
    updates = []
    monkeypatch.setattr(rs, "update_run", lambda *a, **k: updates.append(a))
    assert rs.run_from_config("rid") == 0
    assert updates == []  # never marked RUNNING


def test_run_from_config_failure_marks_failed(monkeypatch):
    monkeypatch.setenv("JOBLIT_WEB_URL", "https://w")
    monkeypatch.setenv("FETCH_RUN_SECRET", "s")
    monkeypatch.setattr(rs, "fetch_run_config", lambda *a, **k: {"userEmail": "e@x", "queries": {"queries": ["dev"]}})
    updates = []
    monkeypatch.setattr(rs, "update_run", lambda base, rid, h, payload: updates.append(payload))

    def boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(rs, "collect_jobs", boom)
    assert rs.run_from_config("rid") == 1
    assert any(u.get("status") == "FAILED" for u in updates)


def test_run_from_config_applies_title_exclusions(monkeypatch):
    monkeypatch.setenv("JOBLIT_WEB_URL", "https://w")
    monkeypatch.setenv("FETCH_RUN_SECRET", "s")
    run = {
        "userEmail": "e@x",
        "queries": {"queries": ["ai"], "applyExcludes": True, "excludeTitleTerms": ["manager"]},
    }
    monkeypatch.setattr(rs, "fetch_run_config", lambda *a, **k: run)
    monkeypatch.setattr(rs, "update_run", lambda *a, **k: None)
    monkeypatch.setattr(rs, "collect_jobs", lambda *a, **k: [
        {"job_url": "u1", "title": "Senior Manager AI"},
        {"job_url": "u2", "title": "AI Engineer"},
    ])
    captured = {}
    monkeypatch.setattr(rs, "import_items", lambda base, email, items: captured.update(items=items) or len(items))
    assert rs.run_from_config("rid") == 0
    assert [i["title"] for i in captured["items"]] == ["AI Engineer"]  # "manager" excluded


def test_main_dispatches_run_config_when_run_id_set(monkeypatch):
    monkeypatch.setenv("RUN_ID", "rid")
    monkeypatch.setattr(rs, "run_from_config", lambda rid: 0 if rid == "rid" else 1)
    monkeypatch.setattr(sys, "argv", ["run_seek.py"])
    assert rs.main() == 0
