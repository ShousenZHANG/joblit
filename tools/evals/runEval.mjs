/**
 * Measure how often a generation clears Joblit's three gates, and how much of
 * the remainder a bounded repair loop recovers.
 *
 * There was no number for this before. Prompt changes were judged by trying
 * two jobs and forming an impression, which cannot tell a real improvement
 * from a lucky sample, and the repair loop in tools/tailor had no baseline to
 * be compared against.
 *
 * The labels are free: the gates are deterministic code, so every run is
 * self-scoring. Nothing here asks a model to judge a model.
 *
 *   node --env-file=.env --experimental-loader ./tools/evals/aliasLoader.mjs \
 *     tools/evals/runEval.mjs [--jobs 12] [--target resume] [--attempts 3]
 *
 * Writes a JSONL trace next to a summary table so a regression can be traced
 * to the case that caused it.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

import { SYNTHETIC_PROFILES } from "./profiles.mjs";

const OUT_DIR = join(process.cwd(), "tools", "evals", "results");

function hermesExecutable() {
  if (process.env.HERMES_EXE) return process.env.HERMES_EXE;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const win = join(local, "hermes", "hermes-agent", "venv", "Scripts", "hermes.exe");
    if (existsSync(win)) return win;
  }
  return "hermes";
}

function parseArgs(argv) {
  const args = { jobs: 12, target: "resume", attempts: 3, model: "gpt-5.6-sol" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--jobs") args.jobs = Number(argv[++i]);
    else if (flag === "--target") args.target = argv[++i];
    else if (flag === "--attempts") args.attempts = Number(argv[++i]);
    else if (flag === "--model") args.model = argv[++i];
    else if (flag === "--tag") args.tag = argv[++i];
  }
  return args;
}

/**
 * Spread the sample across companies rather than taking the newest N.
 *
 * A fetch run lands many roles from one employer at once, so an unspread
 * sample measures one company's phrasing and reports it as a pass rate.
 */
async function sampleJobs(limit) {
  const pool = await prisma.job.findMany({
    where: { description: { not: null } },
    select: { id: true, title: true, company: true, description: true },
    orderBy: { createdAt: "desc" },
    take: limit * 12,
  });
  const seen = new Set();
  const picked = [];
  for (const job of pool) {
    const key = (job.company ?? "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(job);
    if (picked.length === limit) break;
  }
  return picked;
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

function generate(prompt, model, slot) {
  const usagePath = join(process.env.TEMP ?? "/tmp", `joblit-eval-${process.pid}-${slot}.json`);
  const result = spawnSync(
    hermesExecutable(),
    [
      "-z", prompt,
      "--ignore-user-config",
      "--ignore-rules",
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
    return { raw: "", usage, error: `hermes exit ${result.status}: ${(result.stderr ?? "").slice(0, 200)}` };
  }
  return { raw: result.stdout, usage, error: null };
}

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

/**
 * Group a rejection into the gate that produced it.
 *
 * The headline number is the pass rate, but the actionable number is which
 * gate is doing the rejecting: a decode failure is a prompt-format problem,
 * an ungrounded number is an evidence problem, and they need opposite fixes.
 */
function classify(error) {
  const detail = JSON.stringify(error.details ?? {});
  if (/summary/i.test(error.code)) {
    if (detail.includes("ungrounded_number")) return "summary:ungrounded_number";
    if (detail.includes("ungrounded_skill")) return "summary:ungrounded_skill";
    if (detail.includes("title_missing")) return "summary:title_missing";
    return "summary:other";
  }
  if (/skill/i.test(error.code)) return "skills:index_out_of_bounds";
  return `decode:${error.code}`;
}

function runCase({ profile, job, target, attempts, model, slot }) {
  const basePrompt = buildPrompt(target, profile, job);
  const master = mapResumeProfile(profile);
  const trail = [];
  let prompt = basePrompt;
  let tokensIn = 0;
  let tokensOut = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { raw, usage, error: runError } = generate(prompt, model, slot);
    tokensIn += usage?.input_tokens ?? 0;
    tokensOut += usage?.output_tokens ?? 0;

    if (runError) {
      trail.push("runtime_error");
      return { passed: false, attempts: attempt, trail, tokensIn, tokensOut, note: runError };
    }

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
      return { passed: true, attempts: attempt, trail, tokensIn, tokensOut, note: null };
    }

    const bucket = classify(verdict.error);
    trail.push(bucket);
    // Same failure twice means the model cannot act on the signal; stop
    // spending attempts on it.
    if (trail.length >= 2 && trail.at(-1) === trail.at(-2)) {
      return { passed: false, attempts: attempt, trail, tokensIn, tokensOut, note: "stalled" };
    }
    prompt = basePrompt + repairInstruction(verdict.error);
  }

  return { passed: false, attempts, trail, tokensIn, tokensOut, note: "exhausted" };
}

function summarise(rows, args) {
  const total = rows.length;
  const firstPass = rows.filter((r) => r.passed && r.attempts === 1).length;
  const eventualPass = rows.filter((r) => r.passed).length;
  const recovered = eventualPass - firstPass;
  const humanRoundTrips = rows.reduce((sum, r) => sum + (r.passed ? 0 : 1), 0);
  const baselineRoundTrips = total - firstPass;

  const buckets = new Map();
  for (const row of rows) {
    const first = row.trail[0];
    if (!first) continue;
    buckets.set(first, (buckets.get(first) ?? 0) + 1);
  }

  const byProfile = new Map();
  for (const row of rows) {
    const entry = byProfile.get(row.profileId) ?? { n: 0, first: 0, pass: 0 };
    entry.n += 1;
    if (row.passed && row.attempts === 1) entry.first += 1;
    if (row.passed) entry.pass += 1;
    byProfile.set(row.profileId, entry);
  }

  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  const lines = [
    `# Joblit generation eval — ${args.target}`,
    "",
    `cases:            ${total}  (${args.jobs} jobs x ${SYNTHETIC_PROFILES.length + 1} profiles)`,
    `model:            ${args.model}`,
    `attempt cap:      ${args.attempts}`,
    "",
    "## Headline",
    "",
    `first-pass rate:      ${firstPass}/${total}  ${pct(firstPass)}`,
    `after repair loop:    ${eventualPass}/${total}  ${pct(eventualPass)}`,
    `recovered by repair:  ${recovered}  (${((recovered / Math.max(baselineRoundTrips, 1)) * 100).toFixed(1)}% of failures)`,
    "",
    `human round-trips, no loop:   ${baselineRoundTrips}  (${(baselineRoundTrips / total).toFixed(2)} per case)`,
    `human round-trips, with loop: ${humanRoundTrips}  (${(humanRoundTrips / total).toFixed(2)} per case)`,
    "",
    "## First rejection by gate",
    "",
  ];
  for (const [bucket, count] of [...buckets].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${bucket.padEnd(34)} ${String(count).padStart(3)}  ${pct(count)}`);
  }
  lines.push("", "## By profile", "");
  for (const [id, e] of byProfile) {
    lines.push(
      `  ${id.padEnd(18)} first ${String(e.first).padStart(2)}/${e.n}   eventual ${String(e.pass).padStart(2)}/${e.n}`,
    );
  }
  const tokensIn = rows.reduce((s, r) => s + r.tokensIn, 0);
  const tokensOut = rows.reduce((s, r) => s + r.tokensOut, 0);
  lines.push("", `tokens: in=${tokensIn} out=${tokensOut}  (subscription, no API spend)`);
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });

  const operator = await prisma.resumeProfile.findFirst({
    where: { locale: "en-AU" },
    orderBy: { updatedAt: "desc" },
    select: {
      locale: true, summary: true, basics: true, links: true,
      skills: true, experiences: true, projects: true, education: true,
    },
  });
  const profiles = [
    ...(operator ? [{ id: "operator-real", ...operator }] : []),
    ...SYNTHETIC_PROFILES,
  ];

  const jobs = await sampleJobs(args.jobs);
  process.stderr.write(
    `${jobs.length} jobs x ${profiles.length} profiles = ${jobs.length * profiles.length} cases\n`,
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tracePath = join(OUT_DIR, `${args.tag ?? stamp}-${args.target}.jsonl`);
  writeFileSync(tracePath, "");

  const rows = [];
  let done = 0;
  for (const job of jobs) {
    for (const profile of profiles) {
      const result = runCase({ ...args, profile, job, slot: done });
      const row = {
        jobId: job.id,
        company: job.company,
        title: job.title,
        profileId: profile.id,
        ...result,
      };
      rows.push(row);
      appendFileSync(tracePath, `${JSON.stringify(row)}\n`);
      done += 1;
      process.stderr.write(
        `[${String(done).padStart(3)}/${jobs.length * profiles.length}] ${result.passed ? "PASS" : "FAIL"} a${result.attempts} ${profile.id} @ ${(job.company ?? "?").slice(0, 20)}\n`,
      );
    }
  }

  const report = summarise(rows, args);
  const reportPath = join(OUT_DIR, `${args.tag ?? stamp}-${args.target}.md`);
  writeFileSync(reportPath, report);
  process.stdout.write(`${report}\n\ntrace:  ${tracePath}\nreport: ${reportPath}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
