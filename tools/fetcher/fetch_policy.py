"""Strict loader for the AU Fetch Pipeline policy manifest.

The JSON file is the cross-runtime source of truth. Every Python consumer uses
the immutable values exported here so a TypeScript/Python policy drift becomes
an import-time failure instead of silently changing which roles are removed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping, Optional


AU_RECALL_SAFE_V1_POLICY_ID = "au-recall-safe-v1"
AU_RECALL_SAFE_V2_POLICY_ID = "au-recall-safe-v2"
AU_RECALL_SAFE_V3_POLICY_ID = "au-recall-safe-v3"
_IMMUTABLE_POLICY_CEILINGS = {
    AU_RECALL_SAFE_V1_POLICY_ID: "mid",
    AU_RECALL_SAFE_V2_POLICY_ID: "senior",
    AU_RECALL_SAFE_V3_POLICY_ID: "mid",
}

FETCH_POLICY_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "lib"
    / "shared"
    / "fetchPolicy.config.json"
)

_MANIFEST_FIELDS = {"schemaVersion", "activePolicyId", "policies"}
_POLICY_FIELDS = {
    "id",
    "seniorityCeiling",
    "seniorityEvidence",
    "citizenshipOrPr",
    "governmentSecurityClearance",
    "experienceYears",
}
_SUPPORTED_POLICY_VALUES = {
    "seniorityCeiling": {"mid", "senior"},
    "seniorityEvidence": {"visible-title-only"},
    "citizenshipOrPr": {"exclude-explicit-required"},
    "governmentSecurityClearance": {
        "exclude-required-or-explicitly-eligible-to-obtain"
    },
    "experienceYears": {"never-exclude"},
}


class FetchPolicyManifestError(RuntimeError):
    """The shared manifest is unreadable or violates its closed contract."""


@dataclass(frozen=True)
class AuFetchPolicy:
    id: str
    seniority_ceiling: str
    seniority_evidence: str
    citizenship_or_pr: str
    government_security_clearance: str
    experience_years: str

    def as_config(self) -> dict[str, str]:
        return {
            "id": self.id,
            "seniorityCeiling": self.seniority_ceiling,
            "seniorityEvidence": self.seniority_evidence,
            "citizenshipOrPr": self.citizenship_or_pr,
            "governmentSecurityClearance": self.government_security_clearance,
            "experienceYears": self.experience_years,
        }


@dataclass(frozen=True)
class AuFetchPolicyManifest:
    schema_version: int
    active_policy_id: str
    policies: Mapping[str, AuFetchPolicy]

    @property
    def active_policy(self) -> AuFetchPolicy:
        return self.policies[self.active_policy_id]


def _policy_from_mapping(
    value: Mapping[str, Any],
    location: str,
) -> AuFetchPolicy:
    _expect_exact_fields(value, _POLICY_FIELDS, location)
    fields = {
        field: _non_empty_string(value[field], f"{location}.{field}")
        for field in _POLICY_FIELDS
    }
    for field, supported in _SUPPORTED_POLICY_VALUES.items():
        if fields[field] not in supported:
            raise FetchPolicyManifestError(
                f"Unsupported {location}.{field}: {fields[field]}"
            )
    expected_ceiling = _IMMUTABLE_POLICY_CEILINGS.get(fields["id"])
    if expected_ceiling and fields["seniorityCeiling"] != expected_ceiling:
        raise FetchPolicyManifestError(
            f"{fields['id']} must retain its {expected_ceiling}-level ceiling"
        )
    return AuFetchPolicy(
        id=fields["id"],
        seniority_ceiling=fields["seniorityCeiling"],
        seniority_evidence=fields["seniorityEvidence"],
        citizenship_or_pr=fields["citizenshipOrPr"],
        government_security_clearance=fields["governmentSecurityClearance"],
        experience_years=fields["experienceYears"],
    )


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise FetchPolicyManifestError(f"Duplicate manifest key: {key}")
        value[key] = item
    return value


def _expect_exact_fields(
    value: Mapping[str, Any],
    expected: set[str],
    location: str,
) -> None:
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        unknown = sorted(actual - expected)
        raise FetchPolicyManifestError(
            f"Invalid {location} fields: missing={missing} unknown={unknown}"
        )


def _non_empty_string(value: Any, location: str) -> str:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise FetchPolicyManifestError(f"{location} must be a non-empty trimmed string")
    return value


def load_fetch_policy_manifest(
    path: Optional[Path] = None,
) -> AuFetchPolicyManifest:
    manifest_path = path or FETCH_POLICY_MANIFEST_PATH
    try:
        raw = json.loads(
            manifest_path.read_text(encoding="utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
        )
    except FetchPolicyManifestError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise FetchPolicyManifestError(
            f"Unable to load AU fetch policy manifest: {error}"
        ) from error

    if not isinstance(raw, dict):
        raise FetchPolicyManifestError("AU fetch policy manifest must be an object")
    _expect_exact_fields(raw, _MANIFEST_FIELDS, "manifest")
    if type(raw["schemaVersion"]) is not int or raw["schemaVersion"] != 1:
        raise FetchPolicyManifestError("Unsupported fetch policy manifest schemaVersion")

    active_policy_id = _non_empty_string(
        raw["activePolicyId"], "activePolicyId"
    )
    raw_policies = raw["policies"]
    if not isinstance(raw_policies, dict) or not raw_policies:
        raise FetchPolicyManifestError("policies must be a non-empty object")

    policies: dict[str, AuFetchPolicy] = {}
    for raw_policy_id, raw_policy in raw_policies.items():
        policy_id = _non_empty_string(raw_policy_id, "policy registry key")
        if not isinstance(raw_policy, dict):
            raise FetchPolicyManifestError(f"policies.{policy_id} must be an object")
        policy = _policy_from_mapping(raw_policy, f"policies.{policy_id}")
        if policy.id != policy_id:
            raise FetchPolicyManifestError(
                f"Policy registry key {policy_id} must match policy.id"
            )
        policies[policy_id] = policy

    if active_policy_id not in policies:
        raise FetchPolicyManifestError("activePolicyId must name a registered policy")
    return AuFetchPolicyManifest(
        schema_version=raw["schemaVersion"],
        active_policy_id=active_policy_id,
        policies=MappingProxyType(policies),
    )


def resolve_registered_au_fetch_policy(
    value: Mapping[str, Any],
    registry: Optional[Mapping[str, Any]] = None,
) -> AuFetchPolicy:
    """Resolve an exact persisted snapshot by its own immutable policy id."""

    if not isinstance(value, Mapping):
        raise FetchPolicyManifestError("Persisted AU fetch policy must be an object")
    parsed = _policy_from_mapping(value, "persisted policy")
    active_registry = (
        registry if registry is not None else AU_FETCH_POLICY_MANIFEST.policies
    )
    registered = active_registry.get(parsed.id)
    if registered is None:
        raise FetchPolicyManifestError(
            f"AU fetch policy is not registered: {parsed.id}"
        )
    registered_snapshot = (
        registered.as_config()
        if isinstance(registered, AuFetchPolicy)
        else dict(registered)
        if isinstance(registered, Mapping)
        else None
    )
    if parsed.as_config() != registered_snapshot:
        raise FetchPolicyManifestError(
            f"AU fetch policy snapshot does not match registry: {parsed.id}"
        )
    return parsed


AU_FETCH_POLICY_MANIFEST = load_fetch_policy_manifest()
AU_FETCH_POLICY_REGISTRY = AU_FETCH_POLICY_MANIFEST.policies
AU_RECALL_SAFE_V1_POLICY = AU_FETCH_POLICY_REGISTRY.get(
    AU_RECALL_SAFE_V1_POLICY_ID
)
if AU_RECALL_SAFE_V1_POLICY is None:
    raise FetchPolicyManifestError("AU recall-safe v1 policy is not registered")
AU_RECALL_SAFE_V2_POLICY = AU_FETCH_POLICY_REGISTRY.get(
    AU_RECALL_SAFE_V2_POLICY_ID
)
if AU_RECALL_SAFE_V2_POLICY is None:
    raise FetchPolicyManifestError("AU recall-safe v2 policy is not registered")
AU_RECALL_SAFE_V3_POLICY = AU_FETCH_POLICY_REGISTRY.get(
    AU_RECALL_SAFE_V3_POLICY_ID
)
if AU_RECALL_SAFE_V3_POLICY is None:
    raise FetchPolicyManifestError("AU recall-safe v3 policy is not registered")
ACTIVE_AU_FETCH_POLICY_ID = AU_FETCH_POLICY_MANIFEST.active_policy_id
ACTIVE_AU_FETCH_POLICY = MappingProxyType(
    AU_FETCH_POLICY_MANIFEST.active_policy.as_config()
)
