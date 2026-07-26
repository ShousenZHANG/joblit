import { createHash } from "node:crypto";
import type { FetchRunCommitBatchCommand } from "@/lib/shared/schemas/fetchRunCommit";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

export function hashFetchRunBatch(
  command: FetchRunCommitBatchCommand,
): string {
  return createHash("sha256")
    .update(
      stableJson({
        batchIndex: command.batchIndex,
        batchCount: command.batchCount,
        items: command.items,
        terminal: command.terminal,
        discoveredCount: command.discoveredCount,
        terminalOutcome: command.terminalOutcome,
        error: command.error,
      }),
    )
    .digest("hex");
}
