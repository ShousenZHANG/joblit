import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { appendApplicationEvent } from "@/lib/server/applications/applicationEvents";
import { withExtensionRoute } from "@/lib/server/extensionIngress/withExtensionRoute";
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
  return withExtensionRoute(
    req,
    "jobs.markApplied",
    async ({ userId, requestId }) => {
      const body = await req.json().catch(() => ({}));
      const parsed = AppliedSchema.safeParse(body);

      if (!parsed.success) {
        return errorJson("INVALID_BODY", "Invalid request body", 400, {
          details: parsed.error.flatten(),
          requestId,
        });
      }

      // Verify the job belongs to this user
      const job = await prisma.job.findFirst({
        where: { id: parsed.data.jobId, userId },
      });

      if (!job) {
        return errorJson("NOT_FOUND", "Job not found", 404, { requestId });
      }

      // Only transition from NEW to APPLIED
      if (job.status === "NEW") {
        await appendApplicationEvent(userId, {
          jobId: job.id,
          type: "STATUS_CHANGED",
          source: "EXTENSION",
          toStatus: "APPLIED",
          expectedFromStatus: "NEW",
          note: "Application submitted from Chrome extension",
        });
        return NextResponse.json({
          data: {
            id: job.id,
            status: "APPLIED",
            title: job.title,
            company: job.company,
          },
        });
      }

    // Already in a terminal state — return current without modifying
      return NextResponse.json({
        data: {
          id: job.id,
          status: job.status,
          title: job.title,
          company: job.company,
        },
      });
    },
  );
}
