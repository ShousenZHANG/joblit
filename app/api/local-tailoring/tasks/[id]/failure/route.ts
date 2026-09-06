import { z } from "zod";
import { localTaskBody, localTaskJson, withLocalTaskRoute } from "@/lib/server/localTailoring/http";
import { failLocalTask } from "@/lib/server/localTailoring/tasks";

export const runtime = "nodejs";
const failureSchema = z.object({ code: z.string().max(100), message: z.string().max(500).optional() }).strict();
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withLocalTaskRoute(req, ctx, async ({ id, access }) => {
    await localTaskBody(req, failureSchema, 4096);
    return localTaskJson(await failLocalTask(id, access));
  });
}
