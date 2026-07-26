import { describe, expect, it } from "vitest";
import { FETCH_RUN_COMMIT_PROTOCOL } from "@/lib/shared/fetchRunProtocol";
import {
  FetchRunCommitBatchCommandSchema,
  FetchRunCommitWireCommandSchema,
} from "./fetchRunCommit";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

describe("FetchRun commit wire contract", () => {
  it("parses every public command through one discriminated schema", () => {
    const commands = [
      {
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "start",
        attemptId: ATTEMPT_ID,
      },
      {
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "commit",
        attemptId: ATTEMPT_ID,
        batchKey: "batch-000000",
        batchIndex: 0,
        batchCount: 1,
        items: [{ job_url: "https://example.com/jobs/1", title: "Engineer" }],
        terminal: true,
        discoveredCount: 1,
      },
      {
        protocol: FETCH_RUN_COMMIT_PROTOCOL,
        command: "fail",
        attemptId: ATTEMPT_ID,
        error: "worker failed",
      },
    ];

    expect(
      commands.map(
        (command) => FetchRunCommitWireCommandSchema.parse(command).command,
      ),
    ).toEqual(["start", "commit", "fail"]);
  });

  it("canonicalizes imported items and strips caller-selected authority", () => {
    const parsed = FetchRunCommitWireCommandSchema.parse({
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "commit",
      attemptId: ATTEMPT_ID,
      runId: "forged-run",
      userId: "forged-user",
      batchKey: "batch-000000",
      batchIndex: 0,
      batchCount: 1,
      items: [
        {
          job_url: "https://example.com/jobs/1",
          title: "Engineer",
          untrusted: "drop-me",
        },
      ],
      terminal: true,
      discoveredCount: 1,
    });

    expect(parsed).not.toHaveProperty("runId");
    expect(parsed).not.toHaveProperty("userId");
    if (parsed.command !== "commit") throw new Error("expected commit command");
    expect(parsed.items).toEqual([
      {
        job_url: "https://example.com/jobs/1",
        title: "Engineer",
        market: "AU",
      },
    ]);
  });

  it("rejects malformed batch streams at the shared boundary", () => {
    const base = {
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "commit" as const,
      attemptId: ATTEMPT_ID,
      batchKey: "batch-000000",
      batchIndex: 0,
      batchCount: 1,
      items: [],
      terminal: true,
      discoveredCount: 0,
    };

    expect(
      FetchRunCommitBatchCommandSchema.safeParse({
        ...base,
        batchIndex: 1,
      }).success,
    ).toBe(false);
    expect(
      FetchRunCommitBatchCommandSchema.safeParse({
        ...base,
        terminal: false,
        terminalOutcome: "SUCCEEDED",
      }).success,
    ).toBe(false);
    const { discoveredCount: _discoveredCount, ...withoutDiscoveredCount } =
      base;
    expect(
      FetchRunCommitBatchCommandSchema.safeParse(
        withoutDiscoveredCount,
      ).success,
    ).toBe(false);
  });

  it("does not expose the internal stale-cleanup guard on the wire", () => {
    const parsed = FetchRunCommitWireCommandSchema.parse({
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "fail",
      attemptId: ATTEMPT_ID,
      error: "worker failed",
      staleBefore: "2026-07-24T00:00:00.000Z",
    });

    expect(parsed).not.toHaveProperty("staleBefore");
  });
});
