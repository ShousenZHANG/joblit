import { z } from "zod";

export const TAILORING_RUN_PROTOCOL = "tailoring-run/v1" as const;

export const TailoringRunHandleSchema = z
  .object({
    id: z.string().uuid(),
    attemptId: z.string().uuid(),
  })
  .strict();

export type TailoringRunHandle = z.infer<typeof TailoringRunHandleSchema>;

export const TailoringRunPromptSourceSchema = z.enum([
  "manual_import",
  "codex_batch",
]);
