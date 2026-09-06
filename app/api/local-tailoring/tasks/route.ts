import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { enforceAiRateLimit } from "@/lib/server/api/aiRateLimit";
import { createTaskSchema } from "@/lib/server/localTailoring/contract";
import { assertLocalTaskSessionOrigin, localTaskBody, localTaskJson } from "@/lib/server/localTailoring/http";
import { createLocalTask, latestLocalTask, taskError } from "@/lib/server/localTailoring/tasks";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    assertLocalTaskSessionOrigin(req);
    const limited = enforceAiRateLimit(userId, requestId);
    if (limited) return limited;
    const input = await localTaskBody(req, createTaskSchema, 4096);
    return localTaskJson(await createLocalTask(userId, input));
  });
}

export async function GET(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const params = new URL(req.url).searchParams;
    const parsed = createTaskSchema.safeParse({ jobId: params.get("jobId"), target: params.get("target") });
    if (!parsed.success) throw taskError("INVALID_PARAMS", "A valid job and document target are required.", 400);
    return localTaskJson({ task: await latestLocalTask(userId, parsed.data) });
  });
}
