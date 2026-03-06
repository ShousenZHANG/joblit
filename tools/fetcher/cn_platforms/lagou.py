"""拉勾网 (lagou.com) job scraper."""
import logging
import os
import time
import json
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

LAGOU_API = "https://www.lagou.com/jobs/positionAjax.json"

RATE_LIMIT_DELAY = 2.0


def fetch_lagou(
    queries: List[str],
    city: str,
    salary_range: Optional[Dict[str, int]] = None,
    page_limit: int = 3,
) -> List[Dict[str, Any]]:
    """Scrape 拉勾网 job listings."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.lagou.com/jobs/list",
        "X-Requested-With": "XMLHttpRequest",
    })
    # Initialize cookies by visiting the search page
    try:
        session.get(f"https://www.lagou.com/jobs/list?city={city}", timeout=10)
    except Exception:
        pass

    results: List[Dict[str, Any]] = []
    for query in queries:
        for page in range(1, page_limit + 1):
            try:
                resp = session.post(
                    f"{LAGOU_API}?needAddtionalResult=false&city={city}",
                    data={"first": "true" if page == 1 else "false", "pn": str(page), "kd": query},
                    timeout=15,
                )
                if resp.status_code == 403:
                    logger.warning("Lagou rate limited at page %d for '%s'", page, query)
                    break
                data = resp.json()
                positions = (
                    data.get("content", {})
                    .get("positionResult", {})
                    .get("result", [])
                )
                if not positions:
                    break
                for pos in positions:
                    results.append({
                        "title": pos.get("positionName", ""),
                        "company": pos.get("companyFullName", ""),
                        "location": pos.get("city", city),
                        "jobUrl": f"https://www.lagou.com/jobs/{pos.get('positionId', '')}.html",
                        "description": pos.get("positionDetail", ""),
                        "salary": pos.get("salary", ""),
                        "site": "lagou",
                    })
                logger.info("Lagou query='%s' page=%d fetched=%d", query, page, len(positions))
            except Exception as e:
                logger.error("Lagou fetch error query='%s' page=%d: %s", query, page, e)
                break
            time.sleep(RATE_LIMIT_DELAY)

    return results
