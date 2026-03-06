"""智联招聘 (zhaopin.com) job scraper."""
import logging
import time
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

ZHILIAN_API = "https://fe-api.zhaopin.com/c/i/sou"

RATE_LIMIT_DELAY = 2.0


def fetch_zhilian(
    queries: List[str],
    city: str,
    salary_range: Optional[Dict[str, int]] = None,
    page_limit: int = 3,
) -> List[Dict[str, Any]]:
    """Scrape 智联招聘 job listings."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://sou.zhaopin.com/",
    })
    results: List[Dict[str, Any]] = []

    for query in queries:
        for page in range(1, page_limit + 1):
            try:
                params = {
                    "kw": query,
                    "cityId": "",  # Zhilian uses city names directly in some endpoints
                    "city": city,
                    "start": str((page - 1) * 90),
                    "pageSize": "90",
                    "kt": "3",
                }
                resp = session.get(ZHILIAN_API, params=params, timeout=15)
                if resp.status_code != 200:
                    logger.warning("Zhilian status=%d at page %d for '%s'", resp.status_code, page, query)
                    break
                data = resp.json()
                positions = data.get("data", {}).get("results", [])
                if not positions:
                    break
                for pos in positions:
                    results.append({
                        "title": pos.get("jobName", ""),
                        "company": pos.get("company", {}).get("name", ""),
                        "location": pos.get("city", {}).get("display", city),
                        "jobUrl": pos.get("positionURL", ""),
                        "description": "",
                        "salary": pos.get("salary", ""),
                        "site": "zhilian",
                    })
                logger.info("Zhilian query='%s' page=%d fetched=%d", query, page, len(positions))
            except Exception as e:
                logger.error("Zhilian fetch error query='%s' page=%d: %s", query, page, e)
                break
            time.sleep(RATE_LIMIT_DELAY)

    return results
