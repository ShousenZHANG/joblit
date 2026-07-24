import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { getActivePromptSkillRulesForUser } from "@/lib/server/promptRuleTemplates";
import {
  buildSkillPackContentVersion,
  buildSkillPackV3Files,
} from "@/lib/server/ai/skillPack";
import { buildSkillPackVersion } from "@/lib/server/ai/promptContract";
import { buildStructuredSkillRulesFromEffective } from "@/lib/server/ai/promptSkills";
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
import { createZip } from "@/lib/server/archive/zip";
import { getResumeProfile } from "@/lib/server/resumeProfile";

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
  return withSessionRoute(async ({ userId, requestId }) => {
    const url = new URL(req.url);
    const rawLocale = url.searchParams.get("locale") ?? "en-AU";
    const locale: "en-AU" | "zh-CN" = rawLocale === "zh-CN" ? "zh-CN" : "en-AU";
    const redactContext = url.searchParams.get("redact") === "true";

    const rules = await getActivePromptSkillRulesForUser(userId);
    const profile = await getResumeProfile(userId, { locale });
    const context = profile ? buildResumeContext(profile) : undefined;
    const generationReceiptVersion = profile
      ? buildSkillPackVersion({
          ruleSetId: rules.id,
          resumeSnapshotUpdatedAt: profile.updatedAt.toISOString(),
          locale,
          effectiveRules: rules,
          resumeSnapshot: buildResumePromptSnapshot(profile),
        })
      : null;

    const structuredRules = buildStructuredSkillRulesFromEffective(
      rules,
      locale,
    );
    const files = buildSkillPackV3Files(structuredRules, context, {
      locale,
      redactContext,
    });
    const skillPackVersion = buildSkillPackContentVersion(files);
    const zip = createZip(files);
    const today = new Date().toISOString().slice(0, 10);
    const filename = `joblit-skills-v3-${locale}-${today}.zip`;

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-request-id": requestId,
        "x-skill-pack-redacted": redactContext ? "1" : "0",
        "x-skill-pack-version": skillPackVersion,
        "x-skill-pack-locale": locale,
        ...(generationReceiptVersion
          ? { "x-generation-receipt-version": generationReceiptVersion }
          : {}),
      },
    });
  });
}

