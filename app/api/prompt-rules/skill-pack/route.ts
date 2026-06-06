import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { getActivePromptSkillRulesForUser } from "@/lib/server/promptRuleTemplates";
import { buildSkillPackV2Files } from "@/lib/server/ai/skillPack";
import { getStructuredSkillRules } from "@/lib/server/ai/promptSkills";
import { createZip } from "@/lib/server/archive/zip";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { buildSkillPackVersion } from "@/lib/server/ai/promptContract";

export const runtime = "nodejs";

function buildResumeContext(profile: {
  summary?: string | null;
  basics?: unknown;
  links?: unknown;
  skills?: unknown;
  experiences?: unknown;
  projects?: unknown;
  education?: unknown;
  updatedAt: Date;
}) {
  return {
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

export async function GET(req: Request) {
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId, requestId } = ctx;

  const url = new URL(req.url);
  const rawLocale = url.searchParams.get("locale") ?? "en-AU";
  const locale: "en-AU" | "zh-CN" = rawLocale === "zh-CN" ? "zh-CN" : "en-AU";
  const redactContext = url.searchParams.get("redact") === "true";

  const rules = await getActivePromptSkillRulesForUser(userId);
  const profile = await getResumeProfile(userId);
  const context = profile ? buildResumeContext(profile) : undefined;
  const resumeSnapshotUpdatedAt = context?.resumeSnapshotUpdatedAt ?? "missing-profile";
  const skillPackVersion = buildSkillPackVersion({
    ruleSetId: rules.id,
    resumeSnapshotUpdatedAt,
  });

  const structuredRules = getStructuredSkillRules(locale);
  const v2Files = buildSkillPackV2Files(structuredRules, context, {
    locale,
    redactContext,
  });
  const zip = createZip(v2Files);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `joblit-skills-v2-${locale}-${today}.zip`;

  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-request-id": requestId,
      "x-skill-pack-redacted": redactContext ? "1" : "0",
      "x-skill-pack-version": skillPackVersion,
      "x-skill-pack-locale": locale,
    },
  });
}

