import { resultSchema } from "@/lib/server/localTailoring/contract";
import { localTaskBody, localTaskJson, withLocalTaskRoute } from "@/lib/server/localTailoring/http";
import { submitLocalResult } from "@/lib/server/localTailoring/results";

export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withLocalTaskRoute(req, ctx, async ({ id, access }) => {
    const input = await localTaskBody(req, resultSchema);
    const result = await submitLocalResult(id, access, input);
    return localTaskJson(result, result.status === "publishing" ? 202 : 200);
  });
}
