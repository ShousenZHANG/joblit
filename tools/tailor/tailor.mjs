/**
 * Generate a tailored CV or cover letter for one saved job, from the terminal.
 *
 * A thin shell over generateTailoring.mjs, which the local sidecar also uses —
 * both take the same path so a fix in one is a fix in both.
 *
 *   node --env-file=.env --experimental-loader ./tools/evals/aliasLoader.mjs \
 *     tools/tailor/tailor.mjs --job <jobId> [--target resume|cover]
 *
 * Prints the accepted JSON on stdout; nothing is persisted, which is what you
 * want while iterating on prompts.
 */
import { prisma } from "@/lib/server/prisma";

import { generateTailoring, MAX_ATTEMPTS } from "./generateTailoring.mjs";

function parseArgs(argv) {
  const args = { target: "resume" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--job") args.jobId = argv[++i];
    else if (flag === "--target") args.target = argv[++i];
    else if (flag === "--user") args.userId = argv[++i];
    else if (flag === "--model") args.model = argv[++i];
    else if (flag === "--locale") args.locale = argv[++i];
  }
  return args;
}

function report(event) {
  if (event.phase === "prompt") {
    process.stderr.write(`job: ${event.job}\nprompt: ${event.chars} chars\n`);
  } else if (event.phase === "generate") {
    process.stderr.write(`attempt ${event.attempt}/${event.of}...\n`);
  } else if (event.phase === "rejected") {
    process.stderr.write(`  rejected: ${event.code} — ${event.message}\n`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jobId) {
    process.stderr.write(
      "usage: tailor.mjs --job <jobId> [--target resume|cover] [--locale zh-CN]\n",
    );
    process.exit(2);
  }

  const result = await generateTailoring({ ...args, onProgress: report });

  if (result.ok) {
    process.stderr.write(
      `PASS on attempt ${result.attempts}  tokens in=${result.tokensIn} out=${result.tokensOut}\n`,
    );
    process.stdout.write(JSON.stringify(result.aiContent, null, 2));
    return;
  }

  const trail = result.rejections.map((r) => r.code).join(" -> ");
  process.stderr.write(
    `FAILED after ${result.attempts}/${MAX_ATTEMPTS} (${result.note}): ${trail}\n`,
  );
  process.exit(1);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
