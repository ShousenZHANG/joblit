import { localTaskJson, withLocalTaskRoute } from "@/lib/server/localTailoring/http";
import { cancelLocalTask } from "@/lib/server/localTailoring/tasks";

export const runtime = "nodejs";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withLocalTaskRoute(req, ctx, async ({ id, access }) => localTaskJson({ task: await cancelLocalTask(id, access) }), true);
}
