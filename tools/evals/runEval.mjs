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

/**
 * One configuration under test. `--arms` runs several over the same cases so
 * the comparison is paired: the same job and the same profile, differing only
 * in the setting being compared. Comparing across separate runs would let the
 * sample explain the difference.
 *
 * The subscription only serves two models through the Codex backend; everything
 * else returns HTTP 400, so those two plus the reasoning levels are the whole
 * space available here.
 */
function parseArm(spec) {
  const [model, reasoning] = spec.split(":");
  return { id: spec, model, reasoning: reasoning || null };
}

function parseArgs(argv) {
  const args = { jobs: 12, target: "resume", attempts: 3, arms: [parseArm("gpt-5.6-sol")] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--jobs") args.jobs = Number(argv[++i]);
    else if (flag === "--target") args.target = argv[++i];
    else if (flag === "--attempts") args.attempts = Number(argv[++i]);
    else if (flag === "--model") args.arms = [parseArm(argv[++i])];
    else if (flag === "--arms") args.arms = argv[++i].split(",").map(parseArm);
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

function generate(prompt, arm, slot) {
  const usagePath = join(process.env.TEMP ?? "/tmp", `joblit-eval-${process.pid}-${slot}.json`);
  const result = spawnSync(
    hermesExecutable(),
    [
      "-z", prompt,
      "--ignore-user-config",
      "--ignore-rules",
      "-t", "safe",
      "--provider", "openai-codex",
      "-m", arm.model,
      ...(arm.reasoning ? ["--reasoning", arm.reasoning] : []),
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
  // summaryLint's rejections are already one code per rule, and they carry the
  // offending token in the message rather than in `details` — reading `details`
  // here bucketed every summary failure as "other" and hid which rule fired.
  switch (error.code) {
    case "SUMMARY_TITLE_MISSING":
      return "summary:title_missing";
    case "SUMMARY_UNGROUNDED_NUMBER":
      return "summary:ungrounded_number";
    case "SUMMARY_UNGROUNDED_SKILL":
      return "summary:ungrounded_skill";
    case "SKILLS_SELECTION_INVALID":
      return "skills:index_out_of_bounds";
    default:
      return `decode:${error.code}`;
  }
}

function runCase({ profile, job, target, attempts, arm, slot }) {
  const basePrompt = buildPrompt(target, profile, job);
  const master = mapResumeProfile(profile);
  const trail = [];
  const rejections = [];
  let prompt = basePrompt;
  let tokensIn = 0;
  let tokensOut = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { raw, usage, error: runError } = generate(prompt, arm, slot);
    tokensIn += usage?.input_tokens ?? 0;
    tokensOut += usage?.output_tokens ?? 0;

    if (runError) {
      trail.push("runtime_error");
      return { passed: false, attempts: attempt, trail, rejections, tokensIn, tokensOut, note: runError };
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
      return {
        passed: true,
        attempts: attempt,
        trail,
        rejections,
        tokensIn,
        tokensOut,
        note: null,
        // The cover path's quality check is advisory: it reports issues and
        // lets the draft through. Recording it as a plain pass made the cover
        // run score 100%, which only ever proved the JSON parsed. Carry the
        // soft verdict so the run can report on the half the gates don't block.
        softFail: verdict.coverQualityGate === "soft-fail",
        qualityIssues: verdict.coverQualityIssueCount,
      };
    }

    const bucket = classify(verdict.error);
    trail.push(bucket);
    // Keep the rejection verbatim. Generation is non-deterministic, so a case
    // that fails here may pass when re-run by hand — without the original
    // message there is nothing left to diagnose from.
    rejections.push({ attempt, code: verdict.error.code, message: verdict.error.message });
    // Same failure twice means the model cannot act on the signal; stop
    // spending attempts on it.
    if (trail.length >= 2 && trail.at(-1) === trail.at(-2)) {
      return { passed: false, attempts: attempt, trail, rejections, tokensIn, tokensOut, note: "stalled" };
    }
    prompt = basePrompt + repairInstruction(verdict.error);
  }

  return { passed: false, attempts, trail, rejections, tokensIn, tokensOut, note: "exhausted" };
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
    `cases:            ${total}  (${args.jobs} jobs x ${SYNTHETIC_PROFILES.length + 1} profiles x ${args.arms.length} arm(s))`,
    `arms:             ${args.arms.map((a) => a.id).join(", ")}`,
    `attempt cap:      ${args.attempts}`,
    "",
  ];

  // Arms run over identical cases, so this table is a paired comparison: any
  // difference is the setting, not the sample.
  if (args.arms.length > 1) {
    lines.push("## By arm", "");
    for (const arm of args.arms) {
      const own = rows.filter((r) => r.armId === arm.id);
      const f = own.filter((r) => r.passed && r.attempts === 1).length;
      const e = own.filter((r) => r.passed).length;
      const tin = own.reduce((s, r) => s + r.tokensIn, 0);
      const tout = own.reduce((s, r) => s + r.tokensOut, 0);
      lines.push(
        `  ${arm.id.padEnd(22)} first ${String(f).padStart(2)}/${own.length} ${`${((f / own.length) * 100).toFixed(1)}%`.padStart(6)}   eventual ${String(e).padStart(2)}/${own.length}   tokens ${tin}/${tout}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Headline (all arms combined)",
    "",
  );
  lines.push(
    `first-pass rate:      ${firstPass}/${total}  ${pct(firstPass)}`,
    `after repair loop:    ${eventualPass}/${total}  ${pct(eventualPass)}`,
    `recovered by repair:  ${recovered}  (${((recovered / Math.max(baselineRoundTrips, 1)) * 100).toFixed(1)}% of failures)`,
    "",
    `human round-trips, no loop:   ${baselineRoundTrips}  (${(baselineRoundTrips / total).toFixed(2)} per case)`,
    `human round-trips, with loop: ${humanRoundTrips}  (${(humanRoundTrips / total).toFixed(2)} per case)`,
    "",
    "## First rejection by gate",
    "",
  );
  for (const [bucket, count] of [...buckets].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${bucket.padEnd(34)} ${String(count).padStart(3)}  ${pct(count)}`);
  }
  lines.push("", "## By profile", "");
  for (const [id, e] of byProfile) {
    lines.push(
      `  ${id.padEnd(18)} first ${String(e.first).padStart(2)}/${e.n}   eventual ${String(e.pass).padStart(2)}/${e.n}`,
    );
  }
  // Only meaningful on the cover path, where the quality check advises rather
  // than blocks. Without this line a cover run reports 100% and says nothing.
  const accepted = rows.filter((r) => r.passed);
  const softFails = accepted.filter((r) => r.softFail).length;
  if (accepted.some((r) => r.qualityIssues !== undefined)) {
    const issues = accepted.reduce((s, r) => s + (r.qualityIssues ?? 0), 0);
    lines.push(
      "",
      "## Advisory quality (accepted drafts only, does not block)",
      "",
      `  soft-fail:      ${softFails}/${accepted.length}  ${((softFails / Math.max(accepted.length, 1)) * 100).toFixed(1)}%`,
      `  issues flagged: ${issues}  (${(issues / Math.max(accepted.length, 1)).toFixed(2)} per accepted draft)`,
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
  const totalCases = jobs.length * profiles.length * args.arms.length;
  process.stderr.write(
    `${jobs.length} jobs x ${profiles.length} profiles x ${args.arms.length} arms = ${totalCases} cases\n`,
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tracePath = join(OUT_DIR, `${args.tag ?? stamp}-${args.target}.jsonl`);
  writeFileSync(tracePath, "");

  const rows = [];
  let done = 0;
  for (const job of jobs) {
    for (const profile of profiles) {
      for (const arm of args.arms) {
        const result = runCase({ ...args, arm, profile, job, slot: done });
        const row = {
          jobId: job.id,
          company: job.company,
          title: job.title,
          profileId: profile.id,
          armId: arm.id,
          ...result,
        };
        rows.push(row);
        appendFileSync(tracePath, `${JSON.stringify(row)}\n`);
        done += 1;
        process.stderr.write(
          `[${String(done).padStart(3)}/${totalCases}] ${result.passed ? "PASS" : "FAIL"} a${result.attempts} ${arm.id.padEnd(18)} ${profile.id} @ ${(job.company ?? "?").slice(0, 18)}\n`,
        );
      }
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
