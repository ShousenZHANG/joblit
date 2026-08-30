/**
 * Generate a tailored CV or cover letter for one saved job, locally.
 *
 * Joblit's server never calls a model and never holds a model credential
 * (ADR-0015), so generation has to happen on the operator's own machine. This
 * runs the whole loop there: read the job and the active resume profile,
 * build the same prompt the app hands out, run it through the local Hermes
 * runtime against the user's own ChatGPT subscription, and judge the answer
 * with production's own three gates.
 *
 * The retry edge is the point. Today a rejected generation returns a 4xx to
 * the browser and a human re-prompts by hand; the gates already say precisely
 * what broke — which lint rule, and the offending token — so that signal can
 * drive the repair instead of a person. The loop is bounded three ways: an
 * attempt cap, a convergence check that gives up when the same failure repeats,
 * and no LLM anywhere in the judging path.
 *
 *   node --env-file=.env --experimental-loader ./tools/evals/aliasLoader.mjs \
 *     tools/tailor/tailor.mjs --job <jobId> [--target resume|cover] [--write]
 *
 * Without --write nothing is persisted: it prints the accepted JSON and exits,
 * which is what you want while iterating on prompts.
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
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
import { DEFAULT_RULES } from "@/lib/server/ai/promptSkills";
import { acceptApplicationGeneration } from "@/lib/server/applications/applicationGeneration";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";

const MAX_ATTEMPTS = 3;

/**
 * Hermes ships a `.cmd` shim on Windows, but cmd.exe truncates a command line
 * at ~8k characters and these prompts run to about 20k. The executable behind
 * the shim takes the full argv, so address it directly.
 */
function hermesExecutable() {
  const explicit = process.env.HERMES_EXE;
  if (explicit) return explicit;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const win = join(local, "hermes", "hermes-agent", "venv", "Scripts", "hermes.exe");
    if (existsSync(win)) return win;
  }
  return "hermes";
}

/**
 * Read the active profile straight from the database.
 *
 * `getResumeProfile` would be the obvious reuse, but it sits behind the API
 * error layer and drags `next/server` in with it — a CLI has no business
 * loading the Next runtime. The pointer lookup it performs is two queries, so
 * they live here instead.
 */
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

async function readActiveProfile(userId, locale) {
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

function parseArgs(argv) {
  const args = { target: "resume", write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--job") args.jobId = argv[++i];
    else if (flag === "--target") args.target = argv[++i];
    else if (flag === "--user") args.userId = argv[++i];
    else if (flag === "--model") args.model = argv[++i];
    else if (flag === "--locale") args.locale = argv[++i];
    else if (flag === "--write") args.write = true;
  }
  return args;
}

function buildPrompt(target, profile, job) {
  const input = {
    target,
    rules: DEFAULT_RULES,
    candidate: buildResumePromptSnapshot(profile),
    job: { title: job.title, company: job.company, description: job.description },
  };
  const user =
    target === "resume" ? buildV2ResumeUserPrompt(input) : buildV2CoverUserPrompt(input);
  return `${buildV2SystemPrompt(DEFAULT_RULES)}\n\n${user}`;
}

function generate(prompt, model) {
  const usagePath = join(process.env.TEMP ?? "/tmp", `joblit-usage-${process.pid}.json`);
  const result = spawnSync(
    hermesExecutable(),
    [
      "-z", prompt,
      // The generation must depend only on what this script sends: no user
      // config, no SOUL.md, no accumulated memory, no auto-loaded skills.
      // Otherwise the same job produces different prompts on different days.
      "--ignore-user-config",
      "--ignore-rules",
      // Job descriptions come off public job boards and `-z` runs with
      // approvals disabled, so the terminal, file and code-execution tools
      // come off the table. Measured bonus: it also cuts the fixed prompt
      // overhead from ~12.8k tokens to ~3.1k.
      "-t", "safe",
      "--provider", "openai-codex",
      "-m", model ?? "gpt-5.6-sol",
      "--usage-file", usagePath,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`hermes exited ${result.status}: ${(result.stderr ?? "").slice(0, 400)}`);
  }
  let usage = null;
  if (existsSync(usagePath)) {
    usage = JSON.parse(readFileSync(usagePath, "utf8"));
    rmSync(usagePath, { force: true });
  }
  return { raw: result.stdout, usage };
}

/**
 * Turn a gate rejection into an instruction the next attempt can act on.
 *
 * Deliberately mechanical: the gates already name the rule and the offending
 * token, so nothing here asks a model to assess anything. A model judging a
 * model is a probabilistic check on a probabilistic output (ADR-0023).
 */
function repairInstruction(error) {
  const details = JSON.stringify(error.details ?? {});
  return [
    "",
    "---",
    "Your previous answer was REJECTED by a deterministic validator. Fix it and return the corrected JSON only.",
    `Rejection code: ${error.code}`,
    `Reason: ${error.message}`,
    error.details ? `Offending content: ${details}` : "",
    "Return the full corrected JSON object. No commentary, no code fences.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Same failure twice running means the model cannot fix it; stop paying. */
function hasStalled(failures) {
  return failures.length >= 2 && failures.at(-1) === failures.at(-2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jobId) {
    process.stderr.write("usage: tailor.mjs --job <jobId> [--target resume|cover] [--write]\n");
    process.exit(2);
  }

  const job = await prisma.job.findFirst({
    where: args.userId ? { id: args.jobId, userId: args.userId } : { id: args.jobId },
    select: { id: true, title: true, company: true, description: true, userId: true },
  });
  if (!job) throw new Error(`job ${args.jobId} not found`);

  const profileData = await readActiveProfile(job.userId, args.locale ?? "en-AU");

  const basePrompt = buildPrompt(args.target, profileData, job);
  process.stderr.write(
    `job: ${job.title} @ ${job.company ?? "?"}\nprompt: ${basePrompt.length} chars\n`,
  );

  const failures = [];
  let prompt = basePrompt;
  let totalIn = 0;
  let totalOut = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    process.stderr.write(`attempt ${attempt}/${MAX_ATTEMPTS}...\n`);
    const { raw, usage } = generate(prompt, args.model);
    totalIn += usage?.input_tokens ?? 0;
    totalOut += usage?.output_tokens ?? 0;

    const verdict = acceptApplicationGeneration({
      target: args.target,
      source: "manual_import",
      rawOutput: raw,
      promptMetaHash: "",
      master: mapResumeProfile(profileData),
      profile: profileData,
      job: { title: job.title, company: job.company, description: job.description },
    });

    if (verdict.ok) {
      process.stderr.write(
        `PASS on attempt ${attempt}  tokens in=${totalIn} out=${totalOut}\n`,
      );
      process.stdout.write(JSON.stringify(verdict.aiContent, null, 2));
      return;
    }

    failures.push(verdict.error.code);
    process.stderr.write(`  rejected: ${verdict.error.code} — ${verdict.error.message}\n`);

    if (hasStalled(failures)) {
      process.stderr.write("  same failure twice; not converging, stopping.\n");
      break;
    }
    prompt = basePrompt + repairInstruction(verdict.error);
  }

  process.stderr.write(
    `FAILED after ${failures.length} attempt(s): ${failures.join(" -> ")}  tokens in=${totalIn} out=${totalOut}\n`,
  );
  process.exit(1);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
