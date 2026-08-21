import json
import tempfile
import unittest
from pathlib import Path

from tools.fetcher.fetch_policy import (
    ACTIVE_AU_FETCH_POLICY,
    ACTIVE_AU_FETCH_POLICY_ID,
    AU_FETCH_POLICY_MANIFEST,
    AU_RECALL_SAFE_V1_POLICY_ID,
    AU_RECALL_SAFE_V2_POLICY_ID,
    FETCH_POLICY_MANIFEST_PATH,
    FetchPolicyManifestError,
    load_fetch_policy_manifest,
    resolve_registered_au_fetch_policy,
)


class FetchPolicyManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = json.loads(FETCH_POLICY_MANIFEST_PATH.read_text(encoding="utf-8"))

    def _load(self, value):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            return load_fetch_policy_manifest(path)

    def test_default_loader_matches_the_shared_manifest(self):
        self.assertEqual(
            AU_FETCH_POLICY_MANIFEST.schema_version,
            self.raw["schemaVersion"],
        )
        self.assertEqual(ACTIVE_AU_FETCH_POLICY_ID, self.raw["activePolicyId"])
        self.assertEqual(
            dict(ACTIVE_AU_FETCH_POLICY),
            self.raw["policies"][self.raw["activePolicyId"]],
        )
        self.assertEqual(AU_RECALL_SAFE_V1_POLICY_ID, "au-recall-safe-v1")
        self.assertEqual(AU_RECALL_SAFE_V2_POLICY_ID, "au-recall-safe-v2")
        self.assertEqual(ACTIVE_AU_FETCH_POLICY_ID, AU_RECALL_SAFE_V2_POLICY_ID)
        self.assertEqual(
            self.raw["policies"][AU_RECALL_SAFE_V1_POLICY_ID]["seniorityCeiling"],
            "mid",
        )
        self.assertEqual(ACTIVE_AU_FETCH_POLICY["seniorityCeiling"], "senior")

    def test_old_registered_snapshot_survives_an_active_pointer_upgrade(self):
        v1 = self.raw["policies"][AU_RECALL_SAFE_V1_POLICY_ID]
        v2 = self.raw["policies"][AU_RECALL_SAFE_V2_POLICY_ID]
        # A hypothetical future id, deliberately not one the registry pins a
        # ceiling for - au-recall-safe-v3 is now a real, ceiling-locked entry.
        future = {**v2, "id": "au-recall-safe-v9"}
        upgraded = self._load(
            {
                **self.raw,
                "activePolicyId": future["id"],
                "policies": {
                    **self.raw["policies"],
                    future["id"]: future,
                },
            }
        )

        self.assertEqual(upgraded.active_policy_id, future["id"])
        self.assertEqual(
            resolve_registered_au_fetch_policy(v1, upgraded.policies).as_config(),
            v1,
        )

    def test_registered_snapshot_must_match_exactly(self):
        v1 = self.raw["policies"][AU_RECALL_SAFE_V1_POLICY_ID]
        with self.assertRaises(FetchPolicyManifestError):
            resolve_registered_au_fetch_policy(
                {**v1, "experienceYears": "exclude-4-plus"}
            )
        with self.assertRaises(FetchPolicyManifestError):
            resolve_registered_au_fetch_policy({**v1, "id": "unknown-policy"})
        with self.assertRaises(FetchPolicyManifestError):
            resolve_registered_au_fetch_policy(
                {**v1, "seniorityCeiling": "senior"}
            )

    def test_loaded_registry_is_immutable(self):
        with self.assertRaises(TypeError):
            AU_FETCH_POLICY_MANIFEST.policies["other"] = (  # type: ignore[index]
                AU_FETCH_POLICY_MANIFEST.active_policy
            )
        with self.assertRaises(TypeError):
            ACTIVE_AU_FETCH_POLICY["id"] = "other"  # type: ignore[index]

    def test_loader_rejects_incomplete_or_unknown_policy_fields(self):
        active_id = self.raw["activePolicyId"]
        for name, mutate in (
            (
                "missing",
                lambda policy: policy.pop("experienceYears"),
            ),
            (
                "unknown",
                lambda policy: policy.__setitem__("futureRule", "on"),
            ),
        ):
            with self.subTest(name=name):
                value = json.loads(json.dumps(self.raw))
                mutate(value["policies"][active_id])
                with self.assertRaises(FetchPolicyManifestError):
                    self._load(value)

    def test_loader_rejects_policy_semantics_not_supported_by_typescript(self):
        active_id = self.raw["activePolicyId"]
        invalid_values = {
            "seniorityCeiling": "staff",
            "seniorityEvidence": "source-metadata",
            "citizenshipOrPr": "exclude-work-rights",
            "governmentSecurityClearance": "exclude-any-security-word",
            "experienceYears": "exclude-4-plus",
        }
        for field, invalid in invalid_values.items():
            with self.subTest(field=field):
                value = json.loads(json.dumps(self.raw))
                value["policies"][active_id][field] = invalid
                with self.assertRaisesRegex(
                    FetchPolicyManifestError,
                    rf"Unsupported .*\.{field}",
                ):
                    self._load(value)

    def test_loader_rejects_known_policy_semantic_drift(self):
        value = json.loads(json.dumps(self.raw))
        value["policies"][AU_RECALL_SAFE_V1_POLICY_ID][
            "seniorityCeiling"
        ] = "senior"
        with self.assertRaisesRegex(FetchPolicyManifestError, "must retain"):
            self._load(value)

    def test_loader_rejects_registry_and_active_id_drift(self):
        value = json.loads(json.dumps(self.raw))
        value["activePolicyId"] = "not-registered"
        with self.assertRaises(FetchPolicyManifestError):
            self._load(value)

        value = json.loads(json.dumps(self.raw))
        active_id = value["activePolicyId"]
        value["policies"][active_id]["id"] = "other"
        with self.assertRaises(FetchPolicyManifestError):
            self._load(value)

    def test_loader_rejects_wrong_types_schema_and_duplicate_keys(self):
        for name, value in (
            ("schema", {**self.raw, "schemaVersion": 2}),
            ("type", {**self.raw, "policies": []}),
            ("extra", {**self.raw, "futureField": True}),
        ):
            with self.subTest(name=name):
                with self.assertRaises(FetchPolicyManifestError):
                    self._load(value)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.json"
            path.write_text(
                '{"schemaVersion":1,"schemaVersion":1,'
                '"activePolicyId":"x","policies":{}}',
                encoding="utf-8",
            )
            with self.assertRaises(FetchPolicyManifestError):
                load_fetch_policy_manifest(path)


if __name__ == "__main__":
    unittest.main()
