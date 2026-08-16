import { fetchJson } from "@/lib/api/fetchJson";
import {
  discardResultSchema,
  finalizeResultSchema,
  type DiscardResponse,
  type FinalizeResponse,
} from "./tailorResponseSchemas";

/**
 * The Edit phase's server actions, owned once.
 *
 * There is no preview action. Rendering an uncommitted draft used to be a third
 * call here, and it bought a PDF the user could not act on: `FINAL` asserts that
 * the stored PDF reflects committed AI Content, so a preview had to render
 * through a separate route that published nothing. Finalize is the only render,
 * and the UI says so.
 */

export type TailorTarget = "resume" | "cover";

export function extractMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export type FinalizeResult = FinalizeResponse;

/** Commit the draft and publish its PDF. */
export async function finalizeApplication(input: {
  applicationId: string;
  target: TailorTarget;
  expectedHash: string | null;
}): Promise<FinalizeResult> {
  return fetchJson(
    `/api/applications/${input.applicationId}/finalize?target=${input.target}`,
    {
      method: "POST",
      body: JSON.stringify({ expectedHash: input.expectedHash }),
      schema: finalizeResultSchema,
    },
  );
}

export type DiscardResult = DiscardResponse;

/** Throw away the user's edits and return the server's canonical content. */
export async function discardDraft(input: {
  applicationId: string;
  expectedHash: string | null;
}): Promise<DiscardResult> {
  return fetchJson(
    `/api/applications/${input.applicationId}/discard`,
    {
      method: "POST",
      body: JSON.stringify({ expectedHash: input.expectedHash }),
      schema: discardResultSchema,
    },
  );
}
