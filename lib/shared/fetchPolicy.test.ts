import { describe, expect, expectTypeOf, it } from "vitest";
import rawManifest from "./fetchPolicy.config.json";
import {
  ACTIVE_AU_FETCH_POLICY_ID,
  AU_FETCH_POLICY,
  AU_FETCH_POLICY_MANIFEST,
  AU_RECALL_SAFE_V1_POLICY_ID,
  parseAuFetchPolicyManifest,
  parseRegisteredAuFetchPolicy,
} from "./fetchPolicy";

describe("AU fetch policy manifest", () => {
  it("exports the shared manifest and a stable v1 policy identity", () => {
    expect(AU_FETCH_POLICY_MANIFEST).toEqual(rawManifest);
    expect(ACTIVE_AU_FETCH_POLICY_ID).toBe("au-recall-safe-v1");
    expect(AU_RECALL_SAFE_V1_POLICY_ID).toBe("au-recall-safe-v1");
    expect(AU_FETCH_POLICY).toEqual(
      rawManifest.policies[AU_RECALL_SAFE_V1_POLICY_ID],
    );

    expectTypeOf(AU_RECALL_SAFE_V1_POLICY_ID).toEqualTypeOf<
      "au-recall-safe-v1"
    >();
    expectTypeOf(AU_FETCH_POLICY.id).toEqualTypeOf<string>();
    expectTypeOf(AU_FETCH_POLICY.seniorityCeiling).toEqualTypeOf<"mid">();
    expectTypeOf(AU_FETCH_POLICY.experienceYears).toEqualTypeOf<
      "never-exclude"
    >();
  });

  it.each([
    [
      "missing policy field",
      {
        ...rawManifest,
        policies: {
          "au-recall-safe-v1": {
            ...rawManifest.policies["au-recall-safe-v1"],
            experienceYears: undefined,
          },
        },
      },
    ],
    [
      "unknown policy field",
      {
        ...rawManifest,
        policies: {
          "au-recall-safe-v1": {
            ...rawManifest.policies["au-recall-safe-v1"],
            futureRule: true,
          },
        },
      },
    ],
    [
      "unsupported policy value",
      {
        ...rawManifest,
        policies: {
          "au-recall-safe-v1": {
            ...rawManifest.policies["au-recall-safe-v1"],
            experienceYears: "exclude-4-plus",
          },
        },
      },
    ],
    ["unregistered active policy", { ...rawManifest, policies: {} }],
    [
      "registry key mismatch",
      {
        ...rawManifest,
        policies: {
          alias: rawManifest.policies["au-recall-safe-v1"],
        },
      },
    ],
    ["unknown manifest field", { ...rawManifest, futureField: true }],
  ])("fails closed for an invalid manifest: %s", (_name, value) => {
    expect(() => parseAuFetchPolicyManifest(value)).toThrow();
  });

  it("resolves an old registered snapshot after the active pointer advances", () => {
    const v1 = rawManifest.policies[AU_RECALL_SAFE_V1_POLICY_ID];
    const v2 = { ...v1, id: "au-recall-safe-v2" };
    const upgraded = parseAuFetchPolicyManifest({
      ...rawManifest,
      activePolicyId: v2.id,
      policies: {
        [AU_RECALL_SAFE_V1_POLICY_ID]: v1,
        [v2.id]: v2,
      },
    });

    expect(upgraded.activePolicyId).toBe(v2.id);
    expect(
      parseRegisteredAuFetchPolicy(v1, upgraded.policies),
    ).toEqual(v1);
  });

  it("rejects unknown policy ids and mutated registered snapshots", () => {
    const v1 = rawManifest.policies[AU_RECALL_SAFE_V1_POLICY_ID];

    expect(() =>
      parseRegisteredAuFetchPolicy({ ...v1, id: "unknown-policy" }),
    ).toThrow(/not registered/i);
    expect(() =>
      parseRegisteredAuFetchPolicy({
        ...v1,
        experienceYears: "exclude-4-plus",
      }),
    ).toThrow();
  });
});
