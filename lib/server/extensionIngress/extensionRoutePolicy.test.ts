import { describe, expect, it } from "vitest";

import {
  EXTENSION_ROUTE_OPERATIONS,
  getExtensionRoutePolicy,
} from "./extensionRoutePolicy";

const WINDOW_SECONDS = 60;

const expectedPolicies = {
  "tokens.list": ["session", "ext:token:list", 30, 30],
  "tokens.create": ["session", "ext:token:create", 10, 10],
  "tokens.revoke": ["session", "ext:token:revoke", 20, 20],
  "profile.read": ["bearer", "ext:profile", 30, 30],
  "profile.flat.read": ["bearer", "ext:profile:flat", 60, 60],
  "fieldMappings.list": ["bearer", "ext:map:get", 60, 60],
  "fieldMappings.upsert": ["bearer", "ext:map:put", 30, 30],
  "jobs.match": ["bearer", "ext:jobs:match", 60, 60],
  "jobs.markApplied": ["bearer", "ext:jobs:applied", 20, 20],
  "jobs.import": ["bearer", "ext:jobs:import", 30, 30],
  "submissions.list": ["bearer", "ext:sub:get", 60, 60],
  "submissions.create": ["bearer", "ext:sub:post", 30, 30],
  "applications.prompt": ["bearer", "ext:applications:prompt", 80, 20],
  "jobs.triagePrompt": ["bearer", "ext:jobs:triage-prompt", 80, 20],
  "localAiSettings.read": ["bearer", "ext:local-ai:settings:get", 120, 60],
  "localAiSettings.write": ["bearer", "ext:local-ai:settings:put", 120, 30],
} as const;

describe("extension route policy registry", () => {
  it("covers every supported operation exactly once", () => {
    expect(EXTENSION_ROUTE_OPERATIONS).toHaveLength(16);
    expect(new Set(EXTENSION_ROUTE_OPERATIONS).size).toBe(
      EXTENSION_ROUTE_OPERATIONS.length,
    );
    expect([...EXTENSION_ROUTE_OPERATIONS]).toEqual(Object.keys(expectedPolicies));
  });

  it.each(EXTENSION_ROUTE_OPERATIONS)(
    "owns auth and both abuse budgets for %s",
    (operation) => {
      const [auth, scope, preAuthLimit, postAuthLimit] =
        expectedPolicies[operation];

      expect(getExtensionRoutePolicy(operation)).toEqual({
        auth,
        scope,
        preAuthIpBudget: {
          limit: preAuthLimit,
          windowSeconds: WINDOW_SECONDS,
        },
        postAuthUserBudget: {
          limit: postAuthLimit,
          windowSeconds: WINDOW_SECONDS,
        },
      });
    },
  );

  it("uses unique scopes and valid positive integer budgets", () => {
    const policies = EXTENSION_ROUTE_OPERATIONS.map(getExtensionRoutePolicy);

    expect(new Set(policies.map((policy) => policy.scope)).size).toBe(
      policies.length,
    );
    for (const policy of policies) {
      for (const budget of [
        policy.preAuthIpBudget,
        policy.postAuthUserBudget,
      ]) {
        expect(Number.isInteger(budget.limit)).toBe(true);
        expect(budget.limit).toBeGreaterThan(0);
        expect(Number.isInteger(budget.windowSeconds)).toBe(true);
        expect(budget.windowSeconds).toBeGreaterThan(0);
      }
    }
  });

  it("returns immutable policy values", () => {
    const policy = getExtensionRoutePolicy("applications.prompt");

    expect(Object.isFrozen(EXTENSION_ROUTE_OPERATIONS)).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.preAuthIpBudget)).toBe(true);
    expect(Object.isFrozen(policy.postAuthUserBudget)).toBe(true);
  });
});
