"""猎聘网 (liepin.com) job scraper."""
import logging
import time
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

LIEPIN_API = "https://api-c.liepin.com/api/com.liepin.searchfront4c.pc-search-job"

RATE_LIMIT_DELAY = 2.5


def fetch_liepin(
    queries: List[str],
    city: str,
    salary_range: Optional[Dict[str, int]] = None,
    page_limit: int = 3,
) -> List[Dict[str, Any]]:
    """Scrape 猎聘 job listings."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json;charset=UTF-8",
        "Origin": "https://www.liepin.com",
    })
    results: List[Dict[str, Any]] = []

    for query in queries:
        for page in range(0, page_limit):
            try:
                payload = {
                    "data": {
                        "mainSearchPcConditionForm": {
                            "city": city,
                            "dq": city,
                            "key": query,
                            "curPage": page,
                            "pageSize": 40,
                        }
                    }
                }
                resp = session.post(LIEPIN_API, json=payload, timeout=15)
                if resp.status_code != 200:
                    logger.warning("Liepin status=%d at page %d for '%s'", resp.status_code, page, query)
                    break
                data = resp.json()
                jobs = data.get("data", {}).get("data", {}).get("jobCardList", [])
                if not jobs:
                    break
                for job in jobs:
                    results.append({
                        "title": job.get("job", {}).get("title", ""),
                        "company": job.get("comp", {}).get("compName", ""),
                        "location": job.get("job", {}).get("dq", city),
                        "jobUrl": f"https://www.liepin.com/job/{job.get('job', {}).get('jobId', '')}.shtml",
                        "description": "",
                        "salary": job.get("job", {}).get("salary", ""),
                        "site": "liepin",
                    })
                logger.info("Liepin query='%s' page=%d fetched=%d", query, page, len(jobs))
            except Exception as e:
                logger.error("Liepin fetch error query='%s' page=%d: %s", query, page, e)
                break
            time.sleep(RATE_LIMIT_DELAY)

    return results
