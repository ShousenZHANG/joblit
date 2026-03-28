import { z } from "zod";

export const UuidParamSchema = z.object({
  id: z.string().uuid(),
});

export const UuidWithTaskParamSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
});
