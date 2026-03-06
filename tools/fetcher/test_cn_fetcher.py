"""Basic unit tests for CN fetcher utilities."""
import pytest
from run_cn_fetcher import filter_by_keywords, dedupe_jobs


class TestFilterByKeywords:
    def test_no_keywords_returns_all(self):
        jobs = [{"title": "前端工程师", "description": "React开发"}]
        assert filter_by_keywords(jobs, []) == jobs

    def test_excludes_by_title(self):
        jobs = [
            {"title": "前端实习", "description": ""},
            {"title": "前端工程师", "description": ""},
        ]
        result = filter_by_keywords(jobs, ["实习"])
        assert len(result) == 1
        assert result[0]["title"] == "前端工程师"

    def test_excludes_by_description(self):
        jobs = [
            {"title": "开发", "description": "这是一个兼职岗位"},
            {"title": "开发", "description": "全职工作"},
        ]
        result = filter_by_keywords(jobs, ["兼职"])
        assert len(result) == 1

    def test_multiple_keywords(self):
        jobs = [
            {"title": "实习生", "description": ""},
            {"title": "兼职", "description": ""},
            {"title": "全栈工程师", "description": "正式岗位"},
        ]
        result = filter_by_keywords(jobs, ["实习", "兼职"])
        assert len(result) == 1
        assert result[0]["title"] == "全栈工程师"


class TestDedupeJobs:
    def test_removes_duplicate_urls(self):
        jobs = [
            {"title": "A", "jobUrl": "https://example.com/1"},
            {"title": "B", "jobUrl": "https://example.com/1"},
            {"title": "C", "jobUrl": "https://example.com/2"},
        ]
        result = dedupe_jobs(jobs)
        assert len(result) == 2
        assert result[0]["title"] == "A"
        assert result[1]["title"] == "C"

    def test_keeps_jobs_without_url(self):
        jobs = [
            {"title": "A", "jobUrl": ""},
            {"title": "B", "jobUrl": ""},
        ]
        result = dedupe_jobs(jobs)
        assert len(result) == 2

    def test_empty_list(self):
        assert dedupe_jobs([]) == []
