import pytest

import run_seek as rs

REAL_RAW = {
    "id": "92521602",
    "title": "AI Software Engineer",
    "companyName": "Opus Recruitment Solutions",
    "advertiser": {"description": "Opus"},
    "locations": [{"label": "Sydney NSW"}],
    "workTypes": ["Full time"],
    "salaryLabel": "$200,000 – $300,000 per year",
    "teaser": "Forefront of AI",
    "bulletPoints": ["$200,000 - $300,000", "Be part of a global AI Leader"],
}


def test_seek_job_url():
    assert rs.seek_job_url("123") == "https://au.seek.com/job/123"


def test_build_search_params_includes_keywords_class_daterange():
    p = rs.build_search_params(
        keywords="software engineer", classification="6281", page=2, daterange_days=1
    )
    assert p["keywords"] == "software engineer"
    assert p["classification"] == "6281"
    assert p["page"] == "2"
    assert p["daterange"] == "1"
    assert p["siteKey"] == "AU-Main"
    assert p["pageSize"] == "100"


def test_build_search_params_omits_empty_and_zero_daterange():
    p = rs.build_search_params(daterange_days=0)
    assert "keywords" not in p
    assert "classification" not in p
    assert "daterange" not in p


@pytest.mark.parametrize(
    "status,ct,body,expected",
    [
        (200, "application/json; charset=utf-8", "{}", False),
        (403, "text/html", "x", True),
        (429, "application/json", "{}", True),
        (503, "application/json", "{}", True),
        (200, "text/html", "<title>Just a moment...</title>", True),
        (200, "text/html", "<html>challenges.cloudflare.com</html>", True),
        (200, "text/html", "<html>ok</html>", False),
    ],
)
def test_is_challenge_response(status, ct, body, expected):
    assert rs.is_challenge_response(status, ct, body) is expected


def test_parse_search_payload():
    out = rs.parse_search_payload({"totalCount": 5, "data": [{"id": 1}]})
    assert out["total_count"] == 5
    assert len(out["jobs"]) == 1
    assert rs.parse_search_payload({}) == {"total_count": 0, "jobs": []}
    assert rs.parse_search_payload("x")["jobs"] == []


def test_map_job_real_record():
    m = rs.map_job(REAL_RAW)
    assert m["job_url"] == "https://au.seek.com/job/92521602"
    assert m["title"] == "AI Software Engineer"
    assert m["company"] == "Opus Recruitment Solutions"
    assert m["location"] == "Sydney NSW"
    assert m["job_type"] == "Full time"
    assert m["job_level"] == ""
    assert "Forefront of AI" in m["description"]
    assert "$200,000 - $300,000" in m["description"]


def test_map_job_company_fallback_to_advertiser():
    raw = {"id": "1", "title": "T", "advertiser": {"description": "AdCo"}}
    assert rs.map_job(raw)["company"] == "AdCo"


def test_map_job_rejects_missing_id_or_title():
    assert rs.map_job({"title": "T"}) is None
    assert rs.map_job({"id": "1"}) is None
    assert rs.map_job("x") is None


def test_dedupe_by_url():
    items = [{"job_url": "a"}, {"job_url": "a"}, {"job_url": "b"}, {"job_url": ""}]
    out = rs.dedupe_by_url(items)
    assert [i["job_url"] for i in out] == ["a", "b"]


def test_extract_jsonld_description():
    html = (
        '<script type="application/ld+json">'
        '{"@type":"JobPosting","description":"Hello <b>world</b>"}</script>'
    )
    assert rs.extract_jsonld_description(html) == "Hello world"
    assert rs.extract_jsonld_description("") == ""


class FakeFetcher:
    def __init__(self, pages):
        self.pages = pages
        self.enriched = []

    def search_paginated(self, **q):
        return self.pages

    def enrich_description(self, url):
        self.enriched.append(url)
        return "FULL " + url


def test_collect_jobs_maps_and_dedupes():
    raw = [REAL_RAW, dict(REAL_RAW), {"id": "2", "title": "Dev", "companyName": "X"}]
    out = rs.collect_jobs(FakeFetcher(raw), [{}])
    assert [r["job_url"] for r in out] == [
        "https://au.seek.com/job/92521602",
        "https://au.seek.com/job/2",
    ]


def test_collect_jobs_enrich_fills_empty_description():
    raw = [{"id": "2", "title": "Dev", "companyName": "X"}]  # no teaser => empty desc
    fetcher = FakeFetcher(raw)
    out = rs.collect_jobs(fetcher, [{}], enrich=True)
    assert out[0]["description"].startswith("FULL ")
    assert fetcher.enriched == ["https://au.seek.com/job/2"]


def test_search_paginated_stops_on_empty_and_respects_ceiling(monkeypatch):
    fetcher = rs.SeekFetcher()
    monkeypatch.setattr(fetcher, "_ensure_enabled", lambda: None)
    fetcher._warmed = True
    monkeypatch.setattr(rs.time, "sleep", lambda s: None)
    pages = [
        {"totalCount": 300, "data": [{"id": i, "title": "t"} for i in range(100)]},
        {"totalCount": 300, "data": [{"id": 100 + i, "title": "t"} for i in range(100)]},
        {"totalCount": 300, "data": []},  # empty => stop
    ]
    calls = {"n": 0}

    def fake_get(url, params):
        result = pages[calls["n"]]
        calls["n"] += 1
        return result

    monkeypatch.setattr(fetcher, "_get_json", fake_get)
    out = fetcher.search_paginated(keywords="x", max_pages=5)
    assert len(out) == 200
    assert calls["n"] == 3


def test_search_paginated_caps_at_five_pages(monkeypatch):
    fetcher = rs.SeekFetcher()
    monkeypatch.setattr(fetcher, "_ensure_enabled", lambda: None)
    fetcher._warmed = True
    monkeypatch.setattr(rs.time, "sleep", lambda s: None)
    monkeypatch.setattr(
        fetcher, "_get_json", lambda url, params: {"totalCount": 9999, "data": [{"id": 1, "title": "t"}]}
    )
    out = fetcher.search_paginated(max_pages=99)
    assert len(out) == rs.SEEK_PAGE_CEILING  # clamped to 5


def test_live_fetch_is_gated_by_env(monkeypatch):
    monkeypatch.delenv("SEEK_FETCH_ENABLED", raising=False)
    with pytest.raises(RuntimeError, match="SEEK_FETCH_ENABLED"):
        rs.SeekFetcher().warm_up()
