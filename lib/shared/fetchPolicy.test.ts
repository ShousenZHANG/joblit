import { describe, expect, expectTypeOf, it } from "vitest";
import rawManifest from "./fetchPolicy.config.json";
import {
  ACTIVE_AU_FETCH_POLICY_ID,
  AU_FETCH_POLICY,
  AU_FETCH_POLICY_MANIFEST,
  AU_RECALL_SAFE_V1_POLICY_ID,
  AU_RECALL_SAFE_V2_POLICY_ID,
  parseAuFetchPolicyManifest,
  parseRegisteredAuFetchPolicy,
} from "./fetchPolicy";

describe("AU fetch policy manifest", () => {
  it("exports the active v2 policy while retaining the immutable v1 snapshot", () => {
    expect(AU_FETCH_POLICY_MANIFEST).toEqual(rawManifest);
    expect(ACTIVE_AU_FETCH_POLICY_ID).toBe("au-recall-safe-v2");
    expect(AU_RECALL_SAFE_V1_POLICY_ID).toBe("au-recall-safe-v1");
    expect(AU_RECALL_SAFE_V2_POLICY_ID).toBe("au-recall-safe-v2");
    expect(AU_FETCH_POLICY).toEqual(
      rawManifest.policies[AU_RECALL_SAFE_V2_POLICY_ID],
    );
    expect(
      rawManifest.policies[AU_RECALL_SAFE_V1_POLICY_ID].seniorityCeiling,
    ).toBe("mid");
    expect(AU_FETCH_POLICY.seniorityCeiling).toBe("senior");

    expectTypeOf(AU_RECALL_SAFE_V1_POLICY_ID).toEqualTypeOf<
      "au-recall-safe-v1"
    >();
    expectTypeOf(AU_RECALL_SAFE_V2_POLICY_ID).toEqualTypeOf<
      "au-recall-safe-v2"
    >();
    expectTypeOf(AU_FETCH_POLICY.id).toEqualTypeOf<string>();
    expectTypeOf(AU_FETCH_POLICY.seniorityCeiling).toEqualTypeOf<
      "mid" | "senior"
    >();
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
          ...rawManifest.policies,
          "au-recall-safe-v2": {
            ...rawManifest.policies["au-recall-safe-v2"],
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
          ...rawManifest.policies,
          "au-recall-safe-v2": {
            ...rawManifest.policies["au-recall-safe-v2"],
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
          ...rawManifest.policies,
          "au-recall-safe-v2": {
            ...rawManifest.policies["au-recall-safe-v2"],
            experienceYears: "exclude-4-plus",
          },
        },
      },
    ],
    [
      "known policy semantic drift",
      {
        ...rawManifest,
        policies: {
          ...rawManifest.policies,
          "au-recall-safe-v1": {
            ...rawManifest.policies["au-recall-safe-v1"],
            seniorityCeiling: "senior",
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
          ...rawManifest.policies,
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
    const v2 = rawManifest.policies[AU_RECALL_SAFE_V2_POLICY_ID];
    // A hypothetical future id, deliberately not one the registry pins a
    // ceiling for - au-recall-safe-v3 is now a real, ceiling-locked entry.
    const future = { ...v2, id: "au-recall-safe-v9" };
    const upgraded = parseAuFetchPolicyManifest({
      ...rawManifest,
      activePolicyId: future.id,
      policies: {
        ...rawManifest.policies,
        [future.id]: future,
      },
    });

    expect(upgraded.activePolicyId).toBe(future.id);
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
    expect(() =>
      parseRegisteredAuFetchPolicy({
        ...v1,
        seniorityCeiling: "senior",
      }),
    ).toThrow(/must retain/i);
  });
});
