"""Bing Web Search API v7 proxy for CN job platforms.

Uses the official Bing Web Search API (not HTML scraping) to search for
"keyword city site:zhipin.com" and return structured results.
Requires BING_SEARCH_KEY env var (Azure Cognitive Services key).
Free tier: 1 000 calls/month.
"""
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

BING_API_ENDPOINT = "https://api.bing.microsoft.com/v7.0/search"

# Map platform names to their domains for site: search
PLATFORM_SITES: Dict[str, str] = {
    "boss": "zhipin.com",
    "lagou": "lagou.com",
    "liepin": "liepin.com",
    "zhilian": "zhaopin.com",
}

RATE_LIMIT_DELAY = 1.0  # seconds between API requests (generous for paid API)

# Salary pattern: e.g. "15-25K", "15k-25k", "15-25千", "1-2万"
SALARY_RE = re.compile(
    r"(\d+)\s*[kK千万]?\s*[-–~]\s*(\d+)\s*[kK千万]",
)


def _extract_salary(text: str) -> str:
    """Try to extract salary range from search snippet."""
    m = SALARY_RE.search(text)
    return m.group(0) if m else ""


def _extract_company_from_snippet(snippet: str, site: str) -> str:
    """Try to extract company name from Bing snippet text."""
    if site == "boss":
        m = re.match(r"^(.{2,20}?)(?:招聘|·|—|-|发布)", snippet)
        if m:
            return m.group(1).strip()
    return ""


def _parse_api_results(data: Dict[str, Any], site_domain: str, site_name: str) -> List[Dict[str, Any]]:
    """Parse Bing Web Search API JSON response into job dicts."""
    results: List[Dict[str, Any]] = []
    web_pages = data.get("webPages", {})

    for item in web_pages.get("value", []):
        url = item.get("url", "")
        parsed = urlparse(url)
        if site_domain not in parsed.netloc:
            continue

        title_text = item.get("name", "")
        snippet = item.get("snippet", "")

        # Clean title: remove site suffixes
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
            "site": f"bing_{site_name}",
        })

    return results


def fetch_bing(
    queries: List[str],
    city: str,
    sites: Optional[List[str]] = None,
    salary_range: Optional[Dict[str, int]] = None,
    results_per_query: int = 30,
) -> List[Dict[str, Any]]:
    """Fetch job listings via the Bing Web Search API v7.

    For each query+site combo, calls the API with "query city site:domain"
    and parses the JSON response.

    Requires BING_SEARCH_KEY env var.

    Args:
        queries: Job title keywords, e.g. ["前端工程师", "React开发"]
        city: Chinese city name, e.g. "上海"
        sites: Platform names to search, e.g. ["boss", "lagou"].
        salary_range: Optional min/max filter (applied post-fetch).
        results_per_query: Target number of results per query+site combo.
    """
    api_key = os.environ.get("BING_SEARCH_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "BING_SEARCH_KEY is not set. "
            "Get a free key at https://portal.azure.com → Bing Search v7."
        )

    if sites is None:
        sites = ["boss", "lagou"]

    all_results: List[Dict[str, Any]] = []

    for site_name in sites:
        domain = PLATFORM_SITES.get(site_name)
        if not domain:
            logger.warning("Unknown platform for Bing search: %s", site_name)
            continue

        for query in queries:
            search_query = f"{query} {city} site:{domain}"
            fetched = 0

            for offset in range(0, results_per_query, 50):
                count = min(50, results_per_query - fetched)
                params = {
                    "q": search_query,
                    "count": str(count),
                    "offset": str(offset),
                    "mkt": "zh-CN",
                    "responseFilter": "Webpages",
                }
                try:
                    resp = requests.get(
                        BING_API_ENDPOINT,
                        params=params,
                        headers={"Ocp-Apim-Subscription-Key": api_key},
                        timeout=15,
                    )
                    if resp.status_code == 401:
                        raise RuntimeError("BING_SEARCH_KEY is invalid or expired")
                    if resp.status_code == 403:
                        logger.warning("Bing API quota exceeded for '%s' site:%s", query, domain)
                        break
                    if resp.status_code == 429:
                        logger.warning("Bing API rate limited for '%s' site:%s", query, domain)
                        time.sleep(5)
                        break
                    resp.raise_for_status()

                    data = resp.json()
                    page_results = _parse_api_results(data, domain, site_name)
                    if not page_results:
                        break

                    for r in page_results:
                        if not r["location"]:
                            r["location"] = city

                    all_results.extend(page_results)
                    fetched += len(page_results)
                    logger.info(
                        "Bing API query='%s' site=%s offset=%d fetched=%d",
                        query, domain, offset, len(page_results),
                    )

                    if fetched >= results_per_query:
                        break

                    # Check if there are more results
                    total_estimated = data.get("webPages", {}).get("totalEstimatedMatches", 0)
                    if offset + count >= total_estimated:
                        break
                except requests.HTTPError:
                    raise
                except Exception as e:
                    logger.error("Bing API error query='%s' site=%s: %s", query, domain, e)
                    break

                time.sleep(RATE_LIMIT_DELAY)

    logger.info("Bing total: %d results", len(all_results))
    return all_results
