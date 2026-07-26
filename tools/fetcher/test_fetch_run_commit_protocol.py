import os
import sys
import unittest
from pathlib import Path
from unittest.mock import call, patch

sys.path.append(os.path.dirname(__file__))
import run_jobspy as rj  # noqa: E402


class StubResponse:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body
        self.ok = 200 <= status_code < 300
        self.text = str(body)

    def json(self):
        return self._body


class FetchRunCommandTests(unittest.TestCase):
    def setUp(self):
        self.base = "https://joblit.example"
        self.run_id = "run-123"
        self.attempt_id = "11111111-1111-4111-8111-111111111111"
        self.headers = {
            "x-fetch-run-secret": "secret",
            "Content-Type": "application/json",
        }

    def test_start_uses_run_bound_versioned_command(self):
        response = StubResponse(200, {"ok": True, "status": "RUNNING"})
        with patch.object(rj.requests, "post", return_value=response) as post:
            result = rj._post_fetch_run_command(
                self.base,
                self.run_id,
                self.headers,
                {"command": "start", "attemptId": self.attempt_id},
                timeout=30,
            )

        self.assertEqual(result["status"], "RUNNING")
        post.assert_called_once_with(
            "https://joblit.example/api/fetch-runs/run-123/commit",
            headers=self.headers,
            json={
                "protocol": "fetch-run-commit/v1",
                "command": "start",
                "attemptId": self.attempt_id,
            },
            timeout=30,
        )

    def test_commit_batches_have_stable_keys_indexes_and_one_terminal_batch(self):
        items = [{"job_url": f"https://example.com/jobs/{index}"} for index in range(72)]
        responses = [
            {
                "ok": True,
                "disposition": "APPLIED",
                "batchImported": 50,
                "batchInvalid": 0,
                "totalImported": 50,
                "status": "RUNNING",
            },
            {
                "ok": True,
                "disposition": "APPLIED",
                "batchImported": 22,
                "batchInvalid": 0,
                "totalImported": 72,
                "status": "SUCCEEDED",
            },
        ]
        with patch.object(rj, "_post_fetch_run_command", side_effect=responses) as post:
            imported = rj._commit_items(
                self.base,
                self.run_id,
                self.headers,
                items,
                attempt_id=self.attempt_id,
                batch_size=50,
            )

        self.assertEqual(imported, 72)
        first_command = post.call_args_list[0].args[3]
        second_command = post.call_args_list[1].args[3]
        self.assertEqual(
            {
                key: first_command[key]
                for key in (
                    "command",
                    "attemptId",
                    "batchKey",
                    "batchIndex",
                    "batchCount",
                    "terminal",
                    "discoveredCount",
                )
            },
            {
                "command": "commit",
                "attemptId": self.attempt_id,
                "batchKey": "batch-000000",
                "batchIndex": 0,
                "batchCount": 2,
                "terminal": False,
                "discoveredCount": 72,
            },
        )
        self.assertEqual(len(first_command["items"]), 50)
        self.assertEqual(
            {
                key: second_command[key]
                for key in (
                    "command",
                    "attemptId",
                    "batchKey",
                    "batchIndex",
                    "batchCount",
                    "terminal",
                    "discoveredCount",
                )
            },
            {
                "command": "commit",
                "attemptId": self.attempt_id,
                "batchKey": "batch-000001",
                "batchIndex": 1,
                "batchCount": 2,
                "terminal": True,
                "discoveredCount": 72,
            },
        )
        self.assertEqual(len(second_command["items"]), 22)

    def test_empty_result_still_sends_a_terminal_commit(self):
        response = {
            "ok": True,
            "disposition": "APPLIED",
            "batchImported": 0,
            "batchInvalid": 0,
            "totalImported": 0,
            "status": "SUCCEEDED",
        }
        with patch.object(rj, "_post_fetch_run_command", return_value=response) as post:
            imported = rj._commit_items(
                self.base,
                self.run_id,
                self.headers,
                [],
                attempt_id=self.attempt_id,
            )

        self.assertEqual(imported, 0)
        self.assertEqual(
            post.call_args.args[3],
            {
                "command": "commit",
                "attemptId": self.attempt_id,
                "batchKey": "batch-empty",
                "batchIndex": 0,
                "batchCount": 1,
                "items": [],
                "terminal": True,
                "discoveredCount": 0,
            },
        )

    def test_transient_retry_reuses_the_identical_batch_identity_and_body(self):
        responses = [
            StubResponse(503, {"error": {"code": "UNAVAILABLE"}}),
            StubResponse(
                200,
                {
                    "ok": True,
                    "disposition": "REPLAYED",
                    "executionAttemptId": self.attempt_id,
                    "batchImported": 1,
                    "batchInvalid": 0,
                    "totalImported": 1,
                    "status": "SUCCEEDED",
                },
            ),
        ]
        command = {
            "command": "commit",
            "attemptId": self.attempt_id,
            "batchKey": "batch-000000",
            "batchIndex": 0,
            "batchCount": 1,
            "items": [{"job_url": "https://example.com/jobs/1"}],
            "terminal": True,
            "discoveredCount": 1,
        }
        with (
            patch.object(rj.requests, "post", side_effect=responses) as post,
            patch.object(rj.time, "sleep"),
        ):
            result = rj._post_fetch_run_command(
                self.base,
                self.run_id,
                self.headers,
                command,
            )

        self.assertEqual(result["disposition"], "REPLAYED")
        self.assertEqual(result["executionAttemptId"], self.attempt_id)
        self.assertEqual(post.call_count, 2)
        self.assertEqual(
            post.call_args_list[0].kwargs["json"],
            post.call_args_list[1].kwargs["json"],
        )
        self.assertEqual(
            post.call_args_list[0].kwargs["json"]["batchKey"],
            "batch-000000",
        )

    def test_cancel_conflict_is_a_clean_exit_without_retry(self):
        response = StubResponse(
            409,
            {"error": {"code": "RUN_CANCELLED", "message": "run is cancelled"}},
        )
        with patch.object(rj.requests, "post", return_value=response) as post:
            with self.assertRaises(rj.FetchRunCancelled) as raised:
                rj._post_fetch_run_command(
                    self.base,
                    self.run_id,
                    self.headers,
                    {"command": "start", "attemptId": self.attempt_id},
                )

        self.assertEqual(raised.exception.code, 0)
        self.assertEqual(post.call_count, 1)

    def test_active_execution_lease_stops_a_duplicate_before_discovery(self):
        response = StubResponse(
            409,
            {"error": {"code": "EXECUTION_LEASE_HELD"}},
        )
        with patch.object(rj.requests, "post", return_value=response) as post:
            with self.assertRaises(rj.FetchRunSuperseded):
                rj._post_fetch_run_command(
                    self.base,
                    self.run_id,
                    self.headers,
                    {"command": "start", "attemptId": self.attempt_id},
                )

        self.assertEqual(post.call_count, 1)

    def test_malformed_stream_conflict_is_not_masked_as_superseded(self):
        response = StubResponse(
            409,
            {"error": {"code": "BATCH_OUT_OF_ORDER"}},
        )
        with patch.object(rj.requests, "post", return_value=response) as post:
            with self.assertRaisesRegex(RuntimeError, "BATCH_OUT_OF_ORDER"):
                rj._post_fetch_run_command(
                    self.base,
                    self.run_id,
                    self.headers,
                    {
                        "command": "commit",
                        "attemptId": self.attempt_id,
                        "batchKey": "batch-000001",
                        "batchIndex": 1,
                        "batchCount": 2,
                        "items": [],
                        "terminal": True,
                    },
                )

        self.assertEqual(post.call_count, 1)

    def test_batch_content_conflict_is_reported_as_a_protocol_failure(self):
        response = StubResponse(
            409,
            {"error": {"code": "BATCH_CONTENT_CONFLICT"}},
        )
        with patch.object(rj.requests, "post", return_value=response) as post:
            with self.assertRaisesRegex(RuntimeError, "BATCH_CONTENT_CONFLICT"):
                rj._post_fetch_run_command(
                    self.base,
                    self.run_id,
                    self.headers,
                    {
                        "command": "commit",
                        "attemptId": self.attempt_id,
                        "batchKey": "batch-000000",
                        "batchIndex": 0,
                        "batchCount": 1,
                        "items": [],
                        "terminal": True,
                        "discoveredCount": 0,
                    },
                )

        self.assertEqual(post.call_count, 1)

    def test_non_transient_http_failure_is_not_retried(self):
        response = StubResponse(
            401,
            {"error": {"code": "UNAUTHORIZED"}},
        )
        with patch.object(rj.requests, "post", return_value=response) as post:
            with self.assertRaisesRegex(RuntimeError, "status=401"):
                rj._post_fetch_run_command(
                    self.base,
                    self.run_id,
                    self.headers,
                    {"command": "start", "attemptId": self.attempt_id},
                )

        self.assertEqual(post.call_count, 1)

    def test_failure_report_uses_the_same_run_bound_protocol(self):
        with patch.object(
            rj,
            "_post_fetch_run_command",
            return_value={"ok": True, "status": "FAILED"},
        ) as post:
            rj._report_fetch_run_failure(
                self.base,
                self.run_id,
                self.headers,
                self.attempt_id,
                RuntimeError("fetch exploded"),
            )

        self.assertEqual(
            post.call_args,
            call(
                self.base,
                self.run_id,
                self.headers,
                {
                    "command": "fail",
                    "attemptId": self.attempt_id,
                    "error": "fetch exploded",
                },
                timeout=30,
            ),
        )

    def test_worker_adapter_cannot_regress_to_legacy_import_or_update_endpoints(self):
        repo_root = Path(__file__).resolve().parents[2]
        worker_source = (repo_root / "tools/fetcher/run_jobspy.py").read_text(
            encoding="utf-8"
        )
        workflow_source = (repo_root / ".github/workflows/jobspy-fetch.yml").read_text(
            encoding="utf-8"
        )

        self.assertNotIn("/api/admin/import", worker_source)
        self.assertNotIn("/update", worker_source)
        self.assertNotIn("IMPORT_SECRET", worker_source)
        self.assertNotIn("IMPORT_SECRET", workflow_source)
        self.assertNotIn('run["userEmail"]', worker_source)
        self.assertIn('run.get("config")', worker_source)
        self.assertIn("/api/fetch-runs/{run_id}/commit", worker_source)


if __name__ == "__main__":
    unittest.main()
