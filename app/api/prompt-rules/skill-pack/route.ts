import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { getActivePromptSkillRulesForUser } from "@/lib/server/promptRuleTemplates";
import { buildGlobalSkillPackFiles } from "@/lib/server/ai/skillPack";
import { createTarGz } from "@/lib/server/archive/tar";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildSkillPackVersion } from "@/lib/server/ai/promptContract";

export const runtime = "nodejs";

function safeSegment(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "rules";
}

export async function GET(req: Request) {
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId, requestId } = ctx;

  const rules = await getActivePromptSkillRulesForUser(userId);
  const redactContext = new URL(req.url).searchParams.get("redact") === "true";
  let context:
    | {
        resumeSnapshot: unknown;
        resumeSnapshotUpdatedAt: string;
      }
    | undefined;

  const profile = await getResumeProfile(userId);
  if (profile) {
    context = {
      resumeSnapshot: {
        summary: profile.summary ?? "",
        basics: profile.basics ?? null,
        links: profile.links ?? [],
        skills: profile.skills ?? [],
        experiences: profile.experiences ?? [],
        projects: profile.projects ?? [],
        education: profile.education ?? [],
      },
      resumeSnapshotUpdatedAt: profile.updatedAt.toISOString(),
    };
  }
  const resumeSnapshotUpdatedAt = context?.resumeSnapshotUpdatedAt ?? "missing-profile";
  const skillPackVersion = buildSkillPackVersion({
    ruleSetId: rules.id,
    resumeSnapshotUpdatedAt,
  });

  const files = buildGlobalSkillPackFiles(rules, context, {
    redactContext,
  });
  const tarGz = createTarGz(files);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `jobflow-tailoring-${safeSegment(rules.id)}-${today}.tar.gz`;

  return new NextResponse(new Uint8Array(tarGz), {
    status: 200,
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-request-id": requestId,
      "x-skill-pack-redacted": redactContext ? "1" : "0",
      "x-skill-pack-version": skillPackVersion,
    },
  });
}

