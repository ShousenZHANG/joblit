import { describe, expect, it } from "vitest";
import {
  completeGuideTask,
  type GuideJourneyState,
} from "./guideJourney";

function freshJourney(): GuideJourneyState {
  return {
    stage: "NEW_USER",
    checklist: {
      resume_setup: false,
      first_fetch: false,
      review_jobs: false,
      generate_first_pdf: false,
      mark_applied: false,
    },
    completedCount: 0,
    totalCount: 5,
    isComplete: false,
    dismissed: false,
    dismissedAt: null,
    completedAt: null,
    persisted: true,
  };
}

describe("guide journey", () => {
  it("completes a task and decides its persistence and celebration atomically", () => {
    const current = freshJourney();

    expect(completeGuideTask(current, "resume_setup")).toEqual({
      changed: true,
      state: {
        ...current,
        checklist: {
          ...current.checklist,
          resume_setup: true,
        },
        completedCount: 1,
        isComplete: false,
      },
      checklist: {
        resume_setup: true,
        first_fetch: false,
        review_jobs: false,
        generate_first_pdf: false,
        mark_applied: false,
      },
      celebration: {
        completedTaskId: "resume_setup",
        nextTask: {
          id: "first_fetch",
          href: "/fetch",
        },
      },
    });
  });
});
