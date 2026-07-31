import { describe, expect, it } from "vitest";

import {
  AGENT_EXECUTION_PROTOCOL_VERSION,
  AgentApplicationPromptRequestSchema,
} from "@/lib/shared/agentExecutionContract";
import { processActiveBatch } from "@/tools/runner/runner.mjs";

const BATCH_ID = "00000000-0000-4000-8000-000000000001";
const TASK_ID = "00000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000003";
const ISSUE_KEY = "00000000-0000-4000-8000-000000000004";
const JOB_ID = "00000000-0000-4000-8000-000000000005";

describe("Agent Runner prompt contract", () => {
  it("sends a versioned Codex Batch request accepted by the server schema", async () => {
    const promptRequests: unknown[] = [];
    let claimCount = 0;

    await processActiveBatch({
      joblit: {
        async activeBatch() {
          return { batchId: BATCH_ID };
        },
        async runOnce() {
          claimCount += 1;
          return {
            batch: {
              id: BATCH_ID,
              status: claimCount === 1 ? "RUNNING" : "SUCCEEDED",
            },
            tasks:
              claimCount === 1
                ? [
                    {
                      taskId: TASK_ID,
                      attemptId: ATTEMPT_ID,
                      issueKey: ISSUE_KEY,
                      protocolVersion: AGENT_EXECUTION_PROTOCOL_VERSION,
                      jobId: JOB_ID,
                      remainingTargets: ["RESUME"] as const,
                    },
                  ]
                : [],
            execution: { stopReason: claimCount === 1 ? null : "done" },
          };
        },
        async prompt(request: unknown) {
          promptRequests.push(request);
          const parsed = AgentApplicationPromptRequestSchema.safeParse(request);
          expect(parsed.success).toBe(true);
          return {
            prompt: { systemPrompt: "system", userPrompt: "user" },
            promptMeta: { promptHash: "sha256:test" },
            tailoringRun: { id: TASK_ID, attemptId: ATTEMPT_ID },
          };
        },
        async importGeneration() {
          return { ok: true };
        },
        async tailoringRunStatus(runId: string) {
          return { run: { id: runId, status: "RUNNING" } };
        },
      },
      hermes: {
        async generate() {
          return '{"cvSummary":"grounded"}';
        },
        async repair() {
          return '{"cvSummary":"repaired"}';
        },
        async acknowledge() {},
      },
      log: () => {},
    });

    expect(promptRequests).toEqual([
      expect.objectContaining({
        protocolVersion: AGENT_EXECUTION_PROTOCOL_VERSION,
        issueKey: ISSUE_KEY,
      }),
    ]);
  });

  it("rejects incomplete or unsupported Codex Batch identities", () => {
    const valid = {
      jobId: JOB_ID,
      target: "resume",
      source: "codex_batch",
      delivery: "FINAL",
      protocolVersion: AGENT_EXECUTION_PROTOCOL_VERSION,
      issueKey: ISSUE_KEY,
      batchId: BATCH_ID,
      batchTaskId: TASK_ID,
      batchAttemptId: ATTEMPT_ID,
    } as const;

    const { issueKey: _missingIssueKey, ...withoutIssueKey } = valid;
    expect(
      AgentApplicationPromptRequestSchema.safeParse(withoutIssueKey).success,
    ).toBe(false);
    expect(
      AgentApplicationPromptRequestSchema.safeParse({
        ...valid,
        protocolVersion: 2,
      }).success,
    ).toBe(false);
  });
});
