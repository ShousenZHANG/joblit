import { describe, expect, it } from "vitest";
import {
  buildCooldownFilter,
  evaluateApplicationCooldown,
  type ApplicationCooldownRule,
} from "@/lib/server/jobs/applicationCooldown";

const NOW = "2026-07-20T00:00:00Z";

describe("duplicate application cooldown", () => {
  const rules: ApplicationCooldownRule[] = [
    {
      company: "Acme Pty Ltd",
      lastApplyDate: "2026-07-10T00:00:00Z",
      sameRoleDays: 30,
      appliedTo: ["Senior Backend Engineer"],
      crossRoleBucket: ["backend", "platform"],
    },
  ];

  it("suppresses an exact role at the same normalized company", () => {
    expect(
      evaluateApplicationCooldown(
        {
          company: "ACME",
          title: "Senior Backend Engineer",
          roleFamily: "engineering",
        },
        rules,
        NOW,
      ),
    ).toMatchObject({
      suppressed: true,
      match: "exact_role",
      daysRemaining: 20,
    });
  });

  it("suppresses another title in the configured cross-role family", () => {
    expect(
      evaluateApplicationCooldown(
        {
          company: "Acme",
          title: "Site Reliability Engineer",
          roleFamily: "platform",
        },
        rules,
        NOW,
      ),
    ).toMatchObject({ suppressed: true, match: "role_family" });
  });

  it("allows other role families and expired windows", () => {
    expect(
      evaluateApplicationCooldown(
        { company: "Acme", title: "Product Designer", roleFamily: "design" },
        rules,
        NOW,
      ).suppressed,
    ).toBe(false);
    expect(
      evaluateApplicationCooldown(
        { company: "Acme", title: "Backend Engineer" },
        [
          {
            company: "Acme",
            lastApplyDate: "2026-01-01T00:00:00Z",
            sameRoleDays: 30,
          },
        ],
        NOW,
      ).suppressed,
    ).toBe(false);
  });

  it("supports company-wide rules and fails open on invalid dates", () => {
    expect(
      evaluateApplicationCooldown(
        { company: "Globex", title: "Any Role" },
        [
          {
            company: "Globex",
            lastApplyDate: "2026-07-19T00:00:00Z",
            sameRoleDays: 7,
          },
        ],
        NOW,
      ),
    ).toMatchObject({ suppressed: true, match: "company" });
    expect(
      evaluateApplicationCooldown(
        { company: "Globex", title: "Any Role" },
        [
          {
            company: "Globex",
            lastApplyDate: "not-a-date",
            sameRoleDays: 7,
          },
        ],
        NOW,
      ).suppressed,
    ).toBe(false);
  });

  it("clamps a future application timestamp to the policy window", () => {
    expect(
      evaluateApplicationCooldown(
        { company: "Globex", title: "Any Role" },
        [
          {
            company: "Globex",
            lastApplyDate: "2036-01-01T00:00:00Z",
            sameRoleDays: 7,
          },
        ],
        NOW,
      ),
    ).toMatchObject({ suppressed: true, daysRemaining: 7 });
  });

  it("normalizes Chinese company suffixes", () => {
    expect(
      evaluateApplicationCooldown(
        {
          company: "星河科技",
          title: "后端工程师",
          roleFamily: "backend",
        },
        [
          {
            company: "星河科技有限公司",
            lastApplyDate: "2026-07-19T00:00:00Z",
            sameRoleDays: 30,
            appliedTo: ["后端工程师"],
          },
        ],
        NOW,
      ),
    ).toMatchObject({
      suppressed: true,
      match: "exact_role",
    });
  });

  it("builds an Array.filter-compatible predicate", () => {
    const candidates = [
      { company: "Acme", title: "Senior Backend Engineer" },
      { company: "Acme", title: "Product Designer", roleFamily: "design" },
      { company: "Globex", title: "Senior Backend Engineer" },
    ];
    expect(candidates.filter(buildCooldownFilter(rules, NOW))).toEqual([
      candidates[1],
      candidates[2],
    ]);
  });
});
