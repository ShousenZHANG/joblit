import type { FetchRunCommitBatchCommand } from "@/lib/shared/schemas/fetchRunCommit";

export interface InlineFetchRunAdapterInput {
  userId: string;
  queries: unknown;
}

interface InlineFetchRunTerminalBase {
  /**
   * Runs only after the terminal write is durable and belongs to the current
   * attempt. Adapters use this for non-authoritative projections such as
   * source health; the hook must not perform network discovery.
   */
  postTerminal?: () => Promise<void>;
}

export type InlineFetchRunTerminalPlan =
  | (InlineFetchRunTerminalBase & {
      kind: "commit";
      batchKey: string;
      items: FetchRunCommitBatchCommand["items"];
      discovered: number;
      terminalOutcome: "SUCCEEDED" | "PARTIAL";
      error?: string;
    })
  | (InlineFetchRunTerminalBase & {
      kind: "fail";
      error: string;
    });

export type InlineFetchRunAdapter = (
  input: InlineFetchRunAdapterInput,
) => Promise<InlineFetchRunTerminalPlan>;
