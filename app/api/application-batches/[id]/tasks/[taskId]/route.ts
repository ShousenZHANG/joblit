import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidWithTaskParamSchema } from "@/lib/shared/schemas/common";
import { z } from "zod";
import { BatchRunnerError, completeBatchTask } from "@/lib/server/applicationBatches/runner";

export const runtime = "nodejs";

const BodySchema = z.object({
  status: z.enum(["SUCCEEDED", "FAILED", "SKIPPED"]),
  error: z.string().trim().max(500).optional().nullable(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const json = await req.json().catch(() => null);
      const parsedBody = BodySchema.safeParse(json);
      if (!parsedBody.success) {
        return NextResponse.json(
          { error: "INVALID_BODY", details: parsedBody.error.flatten() },
          { status: 400 },
        );
      }

      try {
        const result = await completeBatchTask({
          userId,
          batchId: params.id,
          taskId: params.taskId,
          status: parsedBody.data.status,
          error: parsedBody.data.error,
        });
        return NextResponse.json(result, { status: 200 });
      } catch (error) {
        if (error instanceof BatchRunnerError && error.code === "NOT_FOUND") {
          return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
        }
        if (error instanceof BatchRunnerError && error.code === "INVALID_STATE") {
          return NextResponse.json({ error: "INVALID_STATE" }, { status: 409 });
        }
        throw error;
      }
    },
    { params: ctx.params, schema: UuidWithTaskParamSchema },
  );
}
