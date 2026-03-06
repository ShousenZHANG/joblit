"""Boss直聘 (zhipin.com) job scraper.

Requires BOSS_COOKIE env var for authentication.
Uses requests with cookie-based session to avoid heavy Playwright dependency.
"""
import logging
import os
import re
import time
import json
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import requests

logger = logging.getLogger(__name__)

# Boss API endpoint for job search
BOSS_API = "https://www.zhipin.com/wapi/zpgeek/search/joblist.json"

# City code mapping (Boss uses numeric codes)
CITY_CODES: Dict[str, str] = {
    "北京": "101010100",
    "上海": "101020100",
    "深圳": "101280600",
    "杭州": "101210100",
    "成都": "101270100",
    "南京": "101190100",
    "广州": "101280100",
    "武汉": "101200100",
    "西安": "101110100",
    "苏州": "101190400",
    "长沙": "101250100",
    "郑州": "101180100",
    "天津": "101030100",
    "重庆": "101040100",
}

RATE_LIMIT_DELAY = 3.0  # seconds between requests


def _build_session() -> requests.Session:
    """Build a requests session with Boss cookie."""
    cookie = os.environ.get("BOSS_COOKIE", "").strip()
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.zhipin.com/",
    })
    if cookie:
        s.headers["Cookie"] = cookie
    return s


def _parse_job_card(item: Dict[str, Any]) -> Dict[str, Any]:
    """Parse a Boss job card JSON into our standard format."""
    info = item.get("jobInfo", {})
    brand = item.get("brandComInfo", {})
    return {
        "title": info.get("jobName", ""),
        "company": brand.get("brandName", ""),
        "location": info.get("cityName", ""),
        "jobUrl": f"https://www.zhipin.com/job_detail/{info.get('encryptJobId', '')}.html",
        "description": "",  # Boss only provides descriptions on detail page
        "salary": info.get("salaryDesc", ""),
        "site": "boss",
    }


def fetch_boss(
    queries: List[str],
    city: str,
    salary_range: Optional[Dict[str, int]] = None,
    page_limit: int = 3,
) -> List[Dict[str, Any]]:
    """Scrape Boss直聘 job listings.
    
    Returns list of standardized job dicts.
    """
    city_code = CITY_CODES.get(city, "101020100")
    session = _build_session()
    results: List[Dict[str, Any]] = []

    for query in queries:
        for page in range(1, page_limit + 1):
            params = {
                "query": query,
                "city": city_code,
                "page": str(page),
                "pageSize": "30",
            }
            if salary_range:
                # Boss salary filter uses parameter codes, simplified here
                pass
            try:
                resp = session.get(BOSS_API, params=params, timeout=15)
                if resp.status_code == 403:
                    logger.warning("Boss rate limited / auth required at page %d for '%s'", page, query)
                    break
                resp.raise_for_status()
                data = resp.json()
                job_list = data.get("zpData", {}).get("jobList", [])
                if not job_list:
                    break
                for item in job_list:
                    results.append(_parse_job_card(item))
                logger.info("Boss query='%s' page=%d fetched=%d", query, page, len(job_list))
            except Exception as e:
                logger.error("Boss fetch error query='%s' page=%d: %s", query, page, e)
                break
            time.sleep(RATE_LIMIT_DELAY)

    return results
