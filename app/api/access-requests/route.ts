import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/server/api/routeHandler";
import { checkRateLimit, rateLimitKeyFromRequest } from "@/lib/server/api/rateLimit";
import { submitAccessRequest } from "@/lib/server/access/accessRequestService";

export const runtime = "nodejs";

const BodySchema = z.object({
  email: z.string().trim().email().max(254),
  note: z.string().trim().max(500).optional(),
});

// Public landing endpoint: a visitor requests access. Rate-limited per IP so it
// can't be used to spam the admin queue.
export async function POST(req: Request) {
  const rl = checkRateLimit(rateLimitKeyFromRequest(req, "access-request"), {
    limit: 5,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const parsed = await parseJsonBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  await submitAccessRequest(parsed.data.email, parsed.data.note);
  // Always 202 — never reveal whether the email already applied or has access,
  // so the endpoint can't be used to enumerate users.
  return NextResponse.json({ ok: true }, { status: 202 });
}
