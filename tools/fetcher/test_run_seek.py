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


def test_build_search_params_includes_and_omits():
    p = rs.build_search_params(keywords="software engineer", classification="6281", page=2, daterange_days=1)
    assert p["keywords"] == "software engineer"
    assert p["classification"] == "6281"
    assert p["page"] == "2"
    assert p["daterange"] == "1"
    assert p["siteKey"] == "AU-Main"
    assert p["pageSize"] == "100"
    bare = rs.build_search_params(daterange_days=0)
    assert "keywords" not in bare and "classification" not in bare and "daterange" not in bare


def test_build_search_params_work_type_and_salary():
    p = rs.build_search_params(work_type="242", salary_min="100000")
    assert p["worktype"] == "242"
    assert p["salaryrange"] == "100000-999999"
    assert p["salarytype"] == "annual"
    # invalid worktype id / non-numeric salary are ignored
    p2 = rs.build_search_params(work_type="999", salary_min="abc")
    assert "worktype" not in p2
    assert "salaryrange" not in p2


def test_build_queries_from_config_threads_filters():
    run = {"queries": {"queries": ["dev"], "workType": "242", "salaryMin": 120000}}
    q = rs.build_queries_from_config(run)[0]
    assert q["work_type"] == "242"
    assert q["salary_min"] == "120000"


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


def test_parse_search_payload():
    out = rs.parse_search_payload({"totalCount": 5, "data": [{"id": 1}]})
    assert out["total_count"] == 5 and len(out["jobs"]) == 1
    assert rs.parse_search_payload({}) == {"total_count": 0, "jobs": []}
    assert rs.parse_search_payload("x")["jobs"] == []


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


def test_filter_relevant_titles_drops_broad_match_noise():
    items = [
        {"title": "AI Software Engineer"},
        {"title": "Elixir Developer"},
        {"title": "Systems Engineer"},
        {"title": "Graduate AI Engineer"},
    ]
    out = rs.filter_relevant_titles(items, ["AI Engineer"])
    assert [i["title"] for i in out] == ["AI Software Engineer", "Graduate AI Engineer"]


def test_filter_relevant_titles_generic_query_keeps_all():
    items = [{"title": "Backend Developer"}, {"title": "Systems Engineer"}]
    assert rs.filter_relevant_titles(items, ["Engineer"]) == items


def test_filter_relevant_titles_never_empties():
    # Nothing matches the domain at all -> fall back to the full list.
    items = [{"title": "Elixir Developer"}]
    assert rs.filter_relevant_titles(items, ["AI Engineer"]) == items


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


# ── Network layer: warm-up / clock ─────────────────────────────────────────
def test_warm_up_success_sets_timestamp(fast):
    sess = FakeSession([FakeResp(200, text="<html>jobs</html>", ct="text/html")])
    f = rs.SeekFetcher(session=sess, clock=Clock(123.0))
    f.warm_up()
    assert f._warmed_at == 123.0
    assert f._needs_warm() is False


def test_warm_up_challenge_raises(fast):
    sess = FakeSession([FakeResp(200, text="Just a moment...", ct="text/html")])
    with pytest.raises(rs.SeekChallengeError):
        rs.SeekFetcher(session=sess, clock=Clock(0)).warm_up()


def test_warm_up_is_gated_by_env(monkeypatch):
    monkeypatch.delenv("SEEK_FETCH_ENABLED", raising=False)
    with pytest.raises(RuntimeError, match="SEEK_FETCH_ENABLED"):
        rs.SeekFetcher().warm_up()


def test_needs_warm_expiry():
    clk = Clock(0)
    f = rs.SeekFetcher(session=FakeSession([]), clock=clk)
    assert f._needs_warm() is True  # never warmed
    f._warmed_at = 0.0
    assert f._needs_warm() is False
    clk.t = rs.WARM_TTL_SEC + 1
    assert f._needs_warm() is True  # cookie aged out


# ── Network layer: _get_json ───────────────────────────────────────────────
def test_get_json_success_when_prewarmed(fast):
    sess = FakeSession([FakeResp(json_data={"totalCount": 1, "data": []})])
    f = rs.SeekFetcher(session=sess, clock=Clock(0))
    f._warmed_at = 0.0
    assert f._get_json("u", {})["totalCount"] == 1
    assert len(sess.calls) == 1


def test_get_json_warms_when_needed(fast):
    sess = FakeSession([FakeResp(200, text="<html>", ct="text/html"), FakeResp(json_data={"ok": 1})])
    f = rs.SeekFetcher(session=sess, clock=Clock(0))  # not pre-warmed
    assert f._get_json("u", {}) == {"ok": 1}
    assert len(sess.calls) == 2  # warm-up + search


def test_get_json_retries_transient_then_succeeds(fast):
    sess = FakeSession([FakeResp(503, ct="application/json"), FakeResp(json_data={"ok": 1})])
    f = rs.SeekFetcher(session=sess, clock=Clock(0))
    f._warmed_at = 0.0
    assert f._get_json("u", {}) == {"ok": 1}
    assert len(sess.calls) == 2


def test_get_json_retries_connection_error(fast):
    sess = FakeSession([requests.ConnectionError("boom"), FakeResp(json_data={"ok": 1})])
    f = rs.SeekFetcher(session=sess, clock=Clock(0))
    f._warmed_at = 0.0
    assert f._get_json("u", {}) == {"ok": 1}


def test_get_json_transient_exhausts_to_runtime_error(fast):
    sess = FakeSession([FakeResp(503, ct="application/json") for _ in range(3)])
    f = rs.SeekFetcher(session=sess, clock=Clock(0))
    f._warmed_at = 0.0
    with pytest.raises(RuntimeError, match="failed after retries"):
        f._get_json("u", {})
    assert len(sess.calls) == 3


def test_get_json_client_error_no_retry(fast):
    sess = FakeSession([FakeResp(404, text="missing", ct="application/json")])
    f = rs.SeekFetcher(session=sess, clock=Clock(0))
    f._warmed_at = 0.0
    with pytest.raises(RuntimeError, match="client error"):
        f._get_json("u", {})
    assert len(sess.calls) == 1


def test_get_json_non_json_ok_raises(fast):
    sess = FakeSession([FakeResp(200, text="<html>", ct="text/html", raise_json=True)])
    f = rs.SeekFetcher(session=sess, clock=Clock(0))
    f._warmed_at = 0.0
    with pytest.raises(RuntimeError, match="non-JSON"):
        f._get_json("u", {})


def test_get_json_challenge_rewarms_once_then_stops(fast):
    chal = FakeResp(403, text="blocked", ct="text/html")
    warm = FakeResp(200, text="<html>", ct="text/html")
    sess = FakeSession([chal, warm, chal])
    f = rs.SeekFetcher(session=sess, clock=Clock(0))
    f._warmed_at = 0.0
    with pytest.raises(rs.SeekChallengeError):
        f._get_json("u", {})
    assert len(sess.calls) == 3  # challenge, re-warm, challenge


def test_get_json_challenge_rewarm_then_recovers(fast):
    chal = FakeResp(403, text="blocked", ct="text/html")
    warm = FakeResp(200, text="<html>", ct="text/html")
    data = FakeResp(json_data={"ok": 1})
    sess = FakeSession([chal, warm, data])
    f = rs.SeekFetcher(session=sess, clock=Clock(0))
    f._warmed_at = 0.0
    assert f._get_json("u", {}) == {"ok": 1}
    assert len(sess.calls) == 3


# ── Network layer: search_paginated ────────────────────────────────────────
def _patch_get_json(monkeypatch, fetcher, seq):
    def fake_get(url, params):
        item = seq.pop(0)
        if isinstance(item, Exception):
            raise item
        return item
    monkeypatch.setattr(fetcher, "_get_json", fake_get)


def test_search_paginated_stops_on_empty(monkeypatch, fast):
    f = rs.SeekFetcher(session=FakeSession([]), clock=Clock(0))
    f._warmed_at = 0.0
    _patch_get_json(monkeypatch, f, [
        {"totalCount": 300, "data": [{"id": i} for i in range(100)]},
        {"totalCount": 300, "data": [{"id": 100 + i} for i in range(100)]},
        {"totalCount": 300, "data": []},
    ])
    assert len(f.search_paginated(max_pages=5)) == 200


def test_search_paginated_caps_at_five_pages(monkeypatch, fast):
    f = rs.SeekFetcher(session=FakeSession([]), clock=Clock(0))
    f._warmed_at = 0.0
    monkeypatch.setattr(f, "_get_json", lambda url, params: {"totalCount": 9999, "data": [{"id": 1}]})
    assert len(f.search_paginated(max_pages=99)) == rs.SEEK_PAGE_CEILING


def test_search_paginated_keeps_partial_on_page_error(monkeypatch, fast):
    f = rs.SeekFetcher(session=FakeSession([]), clock=Clock(0))
    f._warmed_at = 0.0
    _patch_get_json(monkeypatch, f, [
        {"totalCount": 300, "data": [{"id": i} for i in range(100)]},
        RuntimeError("boom"),
    ])
    assert len(f.search_paginated(max_pages=5)) == 100  # page 1 kept


def test_search_paginated_propagates_challenge(monkeypatch, fast):
    f = rs.SeekFetcher(session=FakeSession([]), clock=Clock(0))
    f._warmed_at = 0.0
    _patch_get_json(monkeypatch, f, [rs.SeekChallengeError("blocked")])
    with pytest.raises(rs.SeekChallengeError):
        f.search_paginated(max_pages=5)


# ── Orchestration: collect_jobs ────────────────────────────────────────────
class _Fetcher:
    def __init__(self, per_query, enrich_val="FULL"):
        self._per_query = per_query
        self._i = 0
        self.enriched = []
        self._enrich_val = enrich_val

    def search_paginated(self, **q):
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
        {"title": "T", "company": "C", "location": "L", "job_url": "u"}
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
        "where": "Sydney",
        "daterange_days": 3,
        "max_pages": rs.SEEK_PAGE_CEILING,
        "work_type": "",
        "salary_min": "",
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
    monkeypatch.setattr(rs, "collect_jobs", lambda fetcher, queries, **k: [{"job_url": "u", "title": "t"}])
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
