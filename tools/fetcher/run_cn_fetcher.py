"""CN domestic job platform fetcher.

Follows same lifecycle as run_jobspy.py:
1. Read RUN_ID + env
2. GET /api/fetch-runs/{id}/config
3. PATCH status=RUNNING
4. Scrape each platform
5. POST /api/admin/import in batches
6. PATCH status=SUCCEEDED
"""
import os
import re
import json
import sys
import time
import logging
from typing import Any, Dict, List

import requests

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(name)s: %(message)s')
logger = logging.getLogger("cn_fetcher")

IMPORT_BATCH_SIZE = 50
CANCELLED_ERROR = "Cancelled by user"


def api_base() -> str:
    base = os.environ.get("JOBFLOW_WEB_URL", "").strip().rstrip("/")
    if not base:
        raise RuntimeError("JOBFLOW_WEB_URL is not set")
    return base


def headers_secret(secret_env: str, header_name: str) -> Dict[str, str]:
    secret = os.environ.get(secret_env, "").strip()
    if not secret:
        raise RuntimeError(f"{secret_env} is not set")
    return {header_name: secret, "Content-Type": "application/json"}


def fetch_run_config(base: str, run_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
    res = requests.get(f"{base}/api/fetch-runs/{run_id}/config", headers=headers, timeout=30)
    res.raise_for_status()
    return res.json()["run"]


def is_cancelled(run: Dict[str, Any]) -> bool:
    return run.get("status") == "FAILED" and run.get("error") == CANCELLED_ERROR


def abort_if_cancelled(base: str, run_id: str, headers: Dict[str, str], stage: str) -> None:
    run = fetch_run_config(base, run_id, headers=headers)
    if is_cancelled(run):
        logger.info("Cancelled at stage=%s. Exiting.", stage)
        sys.exit(0)


def filter_by_keywords(jobs: List[Dict[str, Any]], exclude_keywords: List[str]) -> List[Dict[str, Any]]:
    """Filter jobs by title/description keyword exclusion."""
    if not exclude_keywords:
        return jobs
    pattern = re.compile("|".join(re.escape(kw) for kw in exclude_keywords), re.IGNORECASE)
    return [j for j in jobs if not pattern.search(j.get("title", "")) and not pattern.search(j.get("description", ""))]


def dedupe_jobs(jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate by jobUrl."""
    seen: set = set()
    result: List[Dict[str, Any]] = []
    for job in jobs:
        url = job.get("jobUrl", "")
        if url and url in seen:
            continue
        if url:
            seen.add(url)
        result.append(job)
    return result


def main():
    run_id = os.environ.get("RUN_ID", "").strip()
    if not run_id:
        raise RuntimeError("RUN_ID is not set")

    base = api_base()
    fetch_headers = headers_secret("FETCH_RUN_SECRET", "x-fetch-run-secret")

    # Get run config
    run = fetch_run_config(base, run_id, headers=fetch_headers)
    if is_cancelled(run):
        logger.info("Already cancelled before start. Exiting.")
        sys.exit(0)

    user_email = run["userEmail"]
    raw_queries = run.get("queries") or {}
    if not isinstance(raw_queries, dict):
        raise RuntimeError("CN run.queries must be a dict")

    queries = raw_queries.get("queries") or []
    city = raw_queries.get("city") or "上海"
    platforms = raw_queries.get("platforms") or ["boss", "lagou", "liepin", "zhilian"]
    exclude_keywords = raw_queries.get("excludeKeywords") or []
    salary_range = {}
    if raw_queries.get("salaryMin"):
        salary_range["min"] = int(raw_queries["salaryMin"])
    if raw_queries.get("salaryMax"):
        salary_range["max"] = int(raw_queries["salaryMax"])

    if not queries:
        raise RuntimeError("No queries provided")

    # Mark running
    requests.patch(
        f"{base}/api/fetch-runs/{run_id}/update",
        headers=fetch_headers,
        data=json.dumps({"status": "RUNNING"}),
        timeout=30,
    ).raise_for_status()

    t0 = time.time()
    all_jobs: List[Dict[str, Any]] = []

    # Import platform modules dynamically
    platform_fetchers = {}
    if "boss" in platforms:
        from cn_platforms.boss import fetch_boss
        platform_fetchers["boss"] = fetch_boss
    if "lagou" in platforms:
        from cn_platforms.lagou import fetch_lagou
        platform_fetchers["lagou"] = fetch_lagou
    if "liepin" in platforms:
        from cn_platforms.liepin import fetch_liepin
        platform_fetchers["liepin"] = fetch_liepin
    if "zhilian" in platforms:
        from cn_platforms.zhilian import fetch_zhilian
        platform_fetchers["zhilian"] = fetch_zhilian

    partial_failures: List[str] = []

    for name, fetcher in platform_fetchers.items():
        abort_if_cancelled(base, run_id, headers=fetch_headers, stage=f"before_{name}")
        try:
            logger.info("Fetching from %s: queries=%s city=%s", name, queries, city)
            jobs = fetcher(queries, city, salary_range=salary_range or None)
            logger.info("%s returned %d jobs", name, len(jobs))
            all_jobs.extend(jobs)
        except Exception as e:
            logger.error("Platform %s failed: %s", name, e)
            partial_failures.append(f"{name}: {e}")

    # Filter and dedupe
    all_jobs = filter_by_keywords(all_jobs, exclude_keywords)
    logger.info("After keyword filter: %d jobs", len(all_jobs))
    all_jobs = dedupe_jobs(all_jobs)
    logger.info("After dedup: %d jobs", len(all_jobs))

    # Convert to import format
    items = []
    for job in all_jobs:
        items.append({
            "title": job.get("title", ""),
            "company": job.get("company", ""),
            "location": job.get("location", city),
            "jobUrl": job.get("jobUrl", ""),
            "description": job.get("description", ""),
            "salary": job.get("salary", ""),
            "site": job.get("site", ""),
            "market": "CN",
        })

    # Import in batches
    imported = 0
    if items:
        abort_if_cancelled(base, run_id, headers=fetch_headers, stage="before_import")
        import_headers = headers_secret("IMPORT_SECRET", "x-import-secret")
        for i in range(0, len(items), IMPORT_BATCH_SIZE):
            abort_if_cancelled(base, run_id, headers=fetch_headers, stage=f"before_import_batch_{i}")
            batch = items[i : i + IMPORT_BATCH_SIZE]
            resp = requests.post(
                f"{base}/api/admin/import",
                headers=import_headers,
                data=json.dumps({"userEmail": user_email, "items": batch}),
                timeout=120,
            )
            if not resp.ok:
                logger.error("Import batch failed: status=%d body=%s", resp.status_code, resp.text[:500])
                continue
            imported += int(resp.json().get("imported", 0))

    # Determine final status
    if partial_failures and not items:
        final_status = "FAILED"
        error_msg = "; ".join(partial_failures)
    elif partial_failures:
        final_status = "PARTIAL"
        error_msg = "; ".join(partial_failures)
    else:
        final_status = "SUCCEEDED"
        error_msg = None

    abort_if_cancelled(base, run_id, headers=fetch_headers, stage="before_final_update")
    requests.patch(
        f"{base}/api/fetch-runs/{run_id}/update",
        headers=fetch_headers,
        data=json.dumps({"status": final_status, "importedCount": imported, "error": error_msg}),
        timeout=30,
    ).raise_for_status()

    logger.info("Done. status=%s imported=%d elapsed=%.1fs", final_status, imported, time.time() - t0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        try:
            rid = os.environ.get("RUN_ID", "").strip()
            if rid:
                requests.patch(
                    f"{api_base()}/api/fetch-runs/{rid}/update",
                    headers=headers_secret("FETCH_RUN_SECRET", "x-fetch-run-secret"),
                    data=json.dumps({"status": "FAILED", "error": str(e)}),
                    timeout=30,
                )
        except Exception:
            pass
        raise
