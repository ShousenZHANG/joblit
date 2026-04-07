import { describe, expect, it } from "vitest";

import {
  ONBOARDING_TASKS,
  defaultOnboardingChecklist,
  isOnboardingComplete,
  mergeOnboardingChecklists,
  normalizeOnboardingChecklist,
} from "@/lib/onboarding";

describe("onboarding task model", () => {
  it("defines five ordered guide tasks", () => {
    expect(ONBOARDING_TASKS.map((task) => task.id)).toEqual([
      "resume_setup",
      "first_fetch",
      "review_jobs",
      "generate_first_pdf",
      "mark_applied",
    ]);
  });

  it("each task has only id and href fields", () => {
    for (const task of ONBOARDING_TASKS) {
      expect(Object.keys(task)).toEqual(expect.arrayContaining(["id", "href"]));
      expect((task as Record<string, unknown>).title).toBeUndefined();
      expect((task as Record<string, unknown>).description).toBeUndefined();
    }
  });

  it("tasks map to correct hrefs", () => {
    const hrefMap = Object.fromEntries(ONBOARDING_TASKS.map((t) => [t.id, t.href]));
    expect(hrefMap).toEqual({
      resume_setup: "/resume",
      first_fetch: "/fetch",
      review_jobs: "/jobs",
      generate_first_pdf: "/jobs",
      mark_applied: "/jobs",
    });
  });

  it("creates a checklist with all five tasks defaulting to false", () => {
    expect(defaultOnboardingChecklist()).toEqual({
      resume_setup: false,
      first_fetch: false,
      review_jobs: false,
      generate_first_pdf: false,
      mark_applied: false,
    });
  });

  it("normalizes invalid values and keeps valid booleans", () => {
    expect(
      normalizeOnboardingChecklist({
        resume_setup: true,
        first_fetch: "yes",
        review_jobs: true,
      }),
    ).toEqual({
      resume_setup: true,
      first_fetch: false,
      review_jobs: true,
      generate_first_pdf: false,
      mark_applied: false,
    });
  });

  it("normalizes null/undefined to all-false defaults", () => {
    expect(normalizeOnboardingChecklist(null)).toEqual(defaultOnboardingChecklist());
    expect(normalizeOnboardingChecklist(undefined)).toEqual(defaultOnboardingChecklist());
  });

  it("normalizes non-object to defaults", () => {
    expect(normalizeOnboardingChecklist("bad")).toEqual(defaultOnboardingChecklist());
    expect(normalizeOnboardingChecklist(42)).toEqual(defaultOnboardingChecklist());
  });

  it("treats onboarding as complete when all five tasks are done", () => {
    const partiallyComplete = {
      resume_setup: true,
      first_fetch: true,
      review_jobs: true,
      generate_first_pdf: true,
      mark_applied: false,
    };
    const fullyComplete = {
      ...partiallyComplete,
      mark_applied: true,
    };

    expect(isOnboardingComplete(partiallyComplete)).toBe(false);
    expect(isOnboardingComplete(fullyComplete)).toBe(true);
  });

  it("merges task updates without regressing completed items", () => {
    const afterFirstTask = {
      ...defaultOnboardingChecklist(),
      resume_setup: true,
    };
    const staleSecondPayload = {
      resume_setup: false,
      first_fetch: true,
      review_jobs: true,
    };

    expect(
      mergeOnboardingChecklists(afterFirstTask, staleSecondPayload),
    ).toEqual({
      resume_setup: true,
      first_fetch: true,
      review_jobs: true,
      generate_first_pdf: false,
      mark_applied: false,
    });
  });

  it("merge treats null/undefined incoming as all-false without regressing base", () => {
    const base = { ...defaultOnboardingChecklist(), resume_setup: true };
    expect(mergeOnboardingChecklists(base, null)).toEqual({
      ...defaultOnboardingChecklist(),
      resume_setup: true,
    });
    expect(mergeOnboardingChecklists(base, undefined)).toEqual({
      ...defaultOnboardingChecklist(),
      resume_setup: true,
    });
  });
});
