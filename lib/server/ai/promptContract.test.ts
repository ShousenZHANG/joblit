import { describe, expect, it } from "vitest";
import { buildPromptMeta, validatePromptMetaForImport } from "./promptContract";

describe("prompt contract", () => {
  const expected = buildPromptMeta({
    target: "resume",
    ruleSetId: "rules-1",
    resumeSnapshotUpdatedAt: "2026-02-22T10:00:00.000Z",
  });

  it("accepts legacy import metadata with only required fields", () => {
    const result = validatePromptMetaForImport({
      expected,
      received: {
        ruleSetId: expected.ruleSetId,
        resumeSnapshotUpdatedAt: expected.resumeSnapshotUpdatedAt,
      },
    });

    expect(result).toEqual({ ok: true });
  });

  it("accepts complete matching import metadata", () => {
    const result = validatePromptMetaForImport({
      expected,
      received: expected,
    });

    expect(result).toEqual({ ok: true });
  });

  it("returns field-level mismatches for stale prompt metadata", () => {
    const result = validatePromptMetaForImport({
      expected,
      received: {
        ruleSetId: "rules-2",
        resumeSnapshotUpdatedAt: expected.resumeSnapshotUpdatedAt,
        skillPackVersion: "stale-pack",
        promptHash: "stale-prompt",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mismatches).toEqual([
      { field: "ruleSetId", expected: expected.ruleSetId, received: "rules-2" },
      {
        field: "skillPackVersion",
        expected: expected.skillPackVersion,
        received: "stale-pack",
      },
      { field: "promptHash", expected: expected.promptHash, received: "stale-prompt" },
    ]);
    expect(result.expected).toBe(expected);
  });
});
