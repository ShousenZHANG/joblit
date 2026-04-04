import { NextResponse } from "next/server";
import { requireExtensionToken, ExtensionTokenError } from "@/lib/server/auth/requireExtensionToken";
import { unauthorizedError, errorJson } from "@/lib/server/api/errorResponse";
import { prisma } from "@/lib/server/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const AppliedSchema = z.object({
  jobId: z.string().uuid(),
});

/**
 * POST /api/ext/jobs/applied
 * Mark a job as APPLIED from the extension after a form submission.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await requireExtensionToken(req);
    const body = await req.json().catch(() => ({}));
    const parsed = AppliedSchema.safeParse(body);

    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    // Verify the job belongs to this user
    const job = await prisma.job.findFirst({
      where: { id: parsed.data.jobId, userId },
    });

    if (!job) {
      return errorJson("NOT_FOUND", "Job not found", 404);
    }

    // Only transition from NEW to APPLIED
    if (job.status === "NEW") {
      const updated = await prisma.job.update({
        where: { id: job.id },
        data: { status: "APPLIED" },
        select: { id: true, status: true, title: true, company: true },
      });
      return NextResponse.json({ data: updated });
    }

    // Already in a terminal state — return current without modifying
    return NextResponse.json({
      data: { id: job.id, status: job.status, title: job.title, company: job.company },
    });
  } catch (err) {
    if (err instanceof ExtensionTokenError) return unauthorizedError();
    throw err;
  }
}
