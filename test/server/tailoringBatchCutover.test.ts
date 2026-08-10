import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applicationBatchTailoringIssueKey,
  applicationBatchTargetProgress,
} from "@/lib/server/applicationBatches/tailoringTaskContract";

describe("TailoringRun batch cutover", () => {
  it("derives a stable public UUID and preserves partial target progress", () => {
    const taskId = "660e8400-e29b-41d4-a716-446655440000";
    const issueKey = applicationBatchTailoringIssueKey(taskId);

    expect(applicationBatchTailoringIssueKey(taskId)).toBe(issueKey);
    expect(issueKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(issueKey).not.toContain("run_");
    expect(
      applicationBatchTargetProgress({
        requiredTargetMask: 3,
        acceptedTargetMask: 1,
      }),
    ).toEqual({
      acceptedTargets: ["RESUME"],
      remainingTargets: ["COVER"],
      publishedTargets: [],
      remainingPublicationTargets: [],
    });
  });

  it("keeps historical rows legacy and gates v1 success on the current attempt proof", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260726090000_tailoring_run_acceptance_protocol/migration.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      'ADD COLUMN "tailoringProtocolVersion" INTEGER NOT NULL DEFAULT 0',
    );
    expect(migration).toContain(
      'CONSTRAINT "ApplicationBatchTask_tailoringCompletionProof_check"',
    );
    expect(migration).toMatch(
      /"tailoringProtocolVersion"\s*=\s*1[\s\S]*"status"\s*=\s*'SUCCEEDED'[\s\S]*"completionAttemptId"\s*=\s*"executionAttemptId"/,
    );
    expect(migration).toMatch(
      /"tailoringProtocolVersion"\s*=\s*0\s+AND\s+"completionAttemptId"\s+IS\s+NULL/,
    );
  });
});
