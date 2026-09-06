import { localTaskJson, withLocalTaskRoute } from "@/lib/server/localTailoring/http";
import { authorisedTask, taskView } from "@/lib/server/localTailoring/tasks";

export const runtime = "nodejs";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withLocalTaskRoute(req, ctx, async ({ id, access }) => localTaskJson(taskView(await authorisedTask(id, access))), true);
}
