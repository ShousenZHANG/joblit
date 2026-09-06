import { progressSchema } from "@/lib/server/localTailoring/contract";
import { localTaskBody, localTaskJson, withLocalTaskRoute } from "@/lib/server/localTailoring/http";
import { progressLocalTask } from "@/lib/server/localTailoring/tasks";

export const runtime = "nodejs";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withLocalTaskRoute(req, ctx, async ({ id, access }) => {
    const input = await localTaskBody(req, progressSchema, 4096);
    return localTaskJson(await progressLocalTask(id, access, input.attempt));
  });
}
