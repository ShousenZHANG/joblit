/**
 * One tailoring run: prompt, generate, judge, repair, stop.
 *
 * Shared by the CLI and the local HTTP sidecar so both take the same path.
 * Joblit's server never calls a model (ADR-0015), so generation happens here,
 * on the operator's machine, against their own subscription — and the judging
 * stays with production's own gates, which this imports rather than
 * reimplements.
 *
 * The repair edge is the reason this is a loop at all. A rejected generation
 * used to return a 4xx and a person re-prompted by hand; the gates already
 * name the failing rule and the offending token, so that signal drives the
 * next attempt instead. Nothing in the judging path is a model.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "@/lib/server/prisma";
import {
  buildV2SystemPrompt,
  buildV2ResumeUserPrompt,
  buildV2CoverUserPrompt,
} from "@/lib/server/ai/applicationPromptBuilder";
import { computeTop3Coverage } from "@/lib/server/ai/responsibilityCoverage";
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
import { acceptApplicationGeneration } from "@/lib/server/applications/applicationGeneration";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { getActivePromptSkillRulesForUser } from "@/lib/server/promptRuleTemplates";

export const MAX_ATTEMPTS = 3;

/**
 * Validated by a paired four-arm comparison over 240 cases: every model the
 * subscription exposes cleared 98-100% first-pass, so quality does not decide
 * this and the cheapest adequate default stands.
 */
export const DEFAULT_MODEL = "gpt-5.6-sol";

/**
 * Hermes ships a `.cmd` shim on Windows, but cmd.exe truncates a command line
 * at ~8k characters and these prompts run to about 20k. The executable behind
 * the shim takes the full argv, so address it directly.
 */
export function hermesExecutable() {
  if (process.env.HERMES_EXE) return process.env.HERMES_EXE;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const win = join(local, "hermes", "hermes-agent", "venv", "Scripts", "hermes.exe");
    if (existsSync(win)) return win;
  }
  return "hermes";
}

const PROFILE_COLUMNS = {
  locale: true,
  summary: true,
  basics: true,
  links: true,
  skills: true,
  experiences: true,
  projects: true,
  education: true,
};

/**
 * Read the active profile straight from the database.
 *
 * `getResumeProfile` would be the obvious reuse, but it sits behind the API
 * error layer and drags `next/server` in with it — neither a CLI nor a
 * standalone sidecar has business loading the Next runtime.
 */
export async function readActiveProfile(userId, locale = "en-AU") {
  const pointer = await prisma.activeResumeProfile.findUnique({
    where: { userId_locale: { userId, locale } },
    select: { resumeProfileId: true },
  });
  if (pointer?.resumeProfileId) {
    const active = await prisma.resumeProfile.findFirst({
      where: { id: pointer.resumeProfileId, userId },
      select: PROFILE_COLUMNS,
    });
    if (active) return active;
  }
  const latest = await prisma.resumeProfile.findFirst({
    where: { userId, locale },
    orderBy: { updatedAt: "desc" },
    select: PROFILE_COLUMNS,
  });
  if (!latest) throw new Error(`no ${locale} resume profile for user ${userId}`);
  return latest;
}

/**
 * Compose the prompt the way `buildApplicationPromptForUser` does — same
 * rules, same locale parameters, same coverage signal. This used to build
 * from `DEFAULT_RULES` with no locale, which meant a user's active
 * PromptRuleTemplate silently did not apply to sidecar generations and a
 * zh-CN run got the en-AU cover conventions. The one divergence that remains
 * is deliberate: no promptMeta receipt is minted, because the import claims
 * no prompt provenance (ADR-0024).
 */
export function buildPrompt(target, profile, job, { rules, locale }) {
  const candidate = buildResumePromptSnapshot(profile);
  const jobInput = {
    title: job.title,
    company: job.company || "the company",
    description: job.description || "",
  };
  const user =
    target === "resume"
      ? buildV2ResumeUserPrompt({
          target,
          rules,
          candidate,
          job: jobInput,
          resume: {
            coverage: computeTop3Coverage(
              jobInput.description,
              candidate.experiences?.[0]?.bullets ?? [],
            ),
          },
        })
      : // The job's market decides the cover conventions; a stored rule
        // template records one locale per user, so the locale travels
        // separately, exactly as the prompt route passes it.
        buildV2CoverUserPrompt({ target, rules, candidate, job: jobInput }, locale);
  return `${buildV2SystemPrompt(rules, locale)}\n\n${user}`;
}

function generate(prompt, model) {
  const usagePath = join(process.env.TEMP ?? "/tmp", `joblit-tailor-${process.pid}-${Date.now()}.json`);
  const result = spawnSync(
    hermesExecutable(),
    [
      "-z", prompt,
      // The run must depend only on what is sent here: no user config, no
      // SOUL.md, no accumulated memory, no auto-loaded skills. Otherwise the
      // same job produces a different prompt on a different day.
      "--ignore-user-config",
      "--ignore-rules",
      // Job descriptions come off public boards and oneshot mode runs with
      // approvals disabled, so the terminal, file and code-execution tools come
      // off the table. Measured bonus: fixed overhead drops ~12.8k tokens to
      // ~3.1k.
      "-t", "safe",
      "--provider", "openai-codex",
      "-m", model,
      "--usage-file", usagePath,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  let usage = null;
  if (existsSync(usagePath)) {
    usage = JSON.parse(readFileSync(usagePath, "utf8"));
    rmSync(usagePath, { force: true });
  }
  if (result.status !== 0) {
    throw new Error(
      `hermes exited ${result.status}: ${(result.stderr ?? "").slice(0, 300)}`,
    );
  }
  return { raw: result.stdout, usage };
}

/**
 * Turn a gate rejection into an instruction the next attempt can act on.
 *
 * Mechanical on purpose: the gates already name the rule and the offending
 * token, so nothing here asks a model to assess anything.
 */
function repairInstruction(error) {
  return [
    "",
    "---",
    "Your previous answer was REJECTED by a deterministic validator. Fix it and return the corrected JSON only.",
    `Rejection code: ${error.code}`,
    `Reason: ${error.message}`,
    error.details ? `Offending content: ${JSON.stringify(error.details)}` : "",
    "Return the full corrected JSON object. No commentary, no code fences.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Same failure twice running means the model cannot fix it; stop paying. */
function hasStalled(codes) {
  return codes.length >= 2 && codes.at(-1) === codes.at(-2);
}

/**
 * Run one job through the loop.
 *
 * `onProgress` exists so the sidecar can report attempts while they happen —
 * a generation takes tens of seconds and a button with no feedback reads as
 * broken.
 */
export async function generateTailoring({
  jobId,
  target = "resume",
  locale = "en-AU",
  userId,
  model = DEFAULT_MODEL,
  onProgress = () => {},
}) {
  const job = await prisma.job.findFirst({
    where: userId ? { id: jobId, userId } : { id: jobId },
    select: { id: true, title: true, company: true, description: true, userId: true },
  });
  if (!job) throw new Error(`job ${jobId} not found`);

  const profile = await readActiveProfile(job.userId, locale);
  const rules = await getActivePromptSkillRulesForUser(job.userId);
  const basePrompt = buildPrompt(target, profile, job, { rules, locale });
  const master = mapResumeProfile(profile);
  onProgress({ phase: "prompt", chars: basePrompt.length, job: job.title });

  const codes = [];
  const rejections = [];
  let prompt = basePrompt;
  let tokensIn = 0;
  let tokensOut = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    onProgress({ phase: "generate", attempt, of: MAX_ATTEMPTS });
    const { raw, usage } = generate(prompt, model);
    tokensIn += usage?.input_tokens ?? 0;
    tokensOut += usage?.output_tokens ?? 0;

    const verdict = acceptApplicationGeneration({
      target,
      source: "manual_import",
      rawOutput: raw,
      promptMetaHash: "",
      master,
      profile,
      job: { title: job.title, company: job.company, description: job.description },
    });

    if (verdict.ok) {
      return {
        ok: true,
        job,
        target,
        attempts: attempt,
        // The exact bytes the gate accepted. The import boundary parses the
        // RAW model shape with the same parser this gate just ran, so this —
        // not the derived aiContent aggregate — is what a caller must submit.
        // Feeding the aggregate back looks plausible and fails the parse.
        rawOutput: raw,
        aiContent: verdict.aiContent,
        coverQualityGate: verdict.coverQualityGate,
        coverQualityIssueCount: verdict.coverQualityIssueCount,
        rejections,
        tokensIn,
        tokensOut,
      };
    }

    codes.push(verdict.error.code);
    rejections.push({ attempt, code: verdict.error.code, message: verdict.error.message });
    onProgress({ phase: "rejected", attempt, code: verdict.error.code, message: verdict.error.message });

    if (hasStalled(codes)) {
      return { ok: false, job, target, attempts: attempt, rejections, tokensIn, tokensOut, note: "stalled" };
    }
    prompt = basePrompt + repairInstruction(verdict.error);
  }

  return { ok: false, job, target, attempts: MAX_ATTEMPTS, rejections, tokensIn, tokensOut, note: "exhausted" };
}
