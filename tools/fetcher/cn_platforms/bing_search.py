"""Serper.dev Google Search proxy for CN job platforms.

Uses Serper.dev API to search for "keyword city site:zhipin.com"
and return structured results. Free tier: 2500 searches.
Requires SERPER_API_KEY env var.
"""
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

SERPER_API_ENDPOINT = "https://google.serper.dev/search"

# Map platform names to their domains for site: search
PLATFORM_SITES: Dict[str, str] = {
    "boss": "zhipin.com",
    "lagou": "lagou.com",
    "liepin": "liepin.com",
    "zhilian": "zhaopin.com",
}

RATE_LIMIT_DELAY = 1.0

# Salary pattern: e.g. "15-25K", "15k-25k", "15-25千", "1-2万"
SALARY_RE = re.compile(
    r"(\d+)\s*[kK千万]?\s*[-–~]\s*(\d+)\s*[kK千万]",
)


def _extract_salary(text: str) -> str:
    m = SALARY_RE.search(text)
    return m.group(0) if m else ""


def _extract_company_from_snippet(snippet: str, site: str) -> str:
    if site == "boss":
        m = re.match(r"^(.{2,20}?)(?:招聘|·|—|-|发布)", snippet)
        if m:
            return m.group(1).strip()
    return ""


def _parse_serper_results(data: Dict[str, Any], site_domain: str, site_name: str) -> List[Dict[str, Any]]:
    """Parse Serper API JSON response into job dicts."""
    results: List[Dict[str, Any]] = []

    for item in data.get("organic", []):
        url = item.get("link", "")
        parsed = urlparse(url)
        if site_domain not in parsed.netloc:
            continue

        title_text = item.get("title", "")
        snippet = item.get("snippet", "")

        clean_title = re.sub(
            r"\s*[-–|_·]\s*(Boss直聘|BOSS直聘|拉勾网|拉勾|猎聘|猎聘网|智联招聘)\s*$",
            "",
            title_text,
        ).strip()
        if not clean_title:
            clean_title = title_text

        salary = _extract_salary(title_text + " " + snippet)
        company = _extract_company_from_snippet(snippet, site_name)

        results.append({
            "title": clean_title,
            "company": company,
            "location": "",
            "jobUrl": url,
            "description": snippet,
            "salary": salary,
            "site": f"serper_{site_name}",
        })

    return results


def fetch_bing(
    queries: List[str],
    city: str,
    sites: Optional[List[str]] = None,
    salary_range: Optional[Dict[str, int]] = None,
    results_per_query: int = 30,
) -> List[Dict[str, Any]]:
    """Fetch job listings via Serper.dev Google Search API.

    Keeps the same function name (fetch_bing) for backward compatibility
    with run_cn_fetcher.py.

    Requires SERPER_API_KEY env var (free at https://serper.dev).
    """
    api_key = os.environ.get("SERPER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "SERPER_API_KEY is not set. "
            "Get a free key at https://serper.dev"
        )

    if sites is None:
        sites = ["boss", "lagou"]

    all_results: List[Dict[str, Any]] = []

    for site_name in sites:
        domain = PLATFORM_SITES.get(site_name)
        if not domain:
            logger.warning("Unknown platform for search: %s", site_name)
            continue

        for query in queries:
            search_query = f"{query} {city} site:{domain}"
            fetched = 0

            # Serper supports up to 100 results per call via num param
            # Paginate with page param (1-indexed)
            page = 1
            while fetched < results_per_query:
                num = min(10, results_per_query - fetched)
                payload = {
                    "q": search_query,
                    "gl": "cn",
                    "hl": "zh-cn",
                    "num": num,
                    "page": page,
                }
                try:
                    resp = requests.post(
                        SERPER_API_ENDPOINT,
                        json=payload,
                        headers={
                            "X-API-KEY": api_key,
                            "Content-Type": "application/json",
                        },
                        timeout=15,
                    )
                    if resp.status_code == 401:
                        raise RuntimeError("SERPER_API_KEY is invalid")
                    if resp.status_code == 429:
                        logger.warning("Serper rate limited for '%s' site:%s", query, domain)
                        break
                    resp.raise_for_status()

                    data = resp.json()
                    page_results = _parse_serper_results(data, domain, site_name)
                    if not page_results:
                        break

                    for r in page_results:
                        if not r["location"]:
                            r["location"] = city

                    all_results.extend(page_results)
                    fetched += len(page_results)
                    logger.info(
                        "Serper query='%s' site=%s page=%d fetched=%d",
                        query, domain, page, len(page_results),
                    )

                    if fetched >= results_per_query:
                        break
                    page += 1
                except requests.HTTPError:
                    raise
                except Exception as e:
                    logger.error("Serper error query='%s' site=%s: %s", query, domain, e)
                    break

                time.sleep(RATE_LIMIT_DELAY)

    logger.info("Serper total: %d results", len(all_results))
    return all_results
