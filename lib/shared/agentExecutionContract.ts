import { z } from "zod";

/**
 * The prompt request contract.
 *
 * This file used to carry a versioned protocol spoken by unattended Runners —
 * a numeric protocol version, batch/task/attempt identity, and a FINAL vs
 * DRAFT delivery split. All of it existed so an external worker could prove
 * which claimed task a prompt belonged to. With the queue gone there is one
 * caller, the browser, and it is asking for one job's prompt.
 *
 * `.strict()` stays: a field the server no longer understands is a client
 * running against a contract that has moved, and failing loudly beats
 * silently ignoring it.
 */
export const ManualPromptRequestSchema = z
  .object({
    jobId: z.string().uuid(),
    target: z.enum(["resume", "cover"]),
  })
  .strict();
