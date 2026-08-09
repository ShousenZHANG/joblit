#!/usr/bin/env node
import "dotenv/config";

import { PrismaClient } from "../../lib/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";
import {
  LEGACY_MARKET_RETIREMENT_DEFAULTS,
  LegacyMarketRetirementExecutionError,
  retireLegacyMarketData,
  type LegacyMarketRetirementSummary,
} from "../../lib/server/dataRetirement/legacyMarketRetirement";

const EXECUTION_CONFIRMATION = "DELETE_CN_GLOBAL_FETCH_AND_GLOBAL_JOBS";

type CliOptions = {
  execute: boolean;
  verify: boolean;
  batchSize: number;
  maxBatches: number;
};

class UsageError extends Error {}

function usage(): string {
  return [
    "Safely retire Stage-1 legacy market data.",
    "",
    "Dry-run (default):",
    "  node tools/data-retirement/legacy-market-retirement.mjs",
    "",
    "Read-only Stage-2 readiness gate:",
    "  node tools/data-retirement/legacy-market-retirement.mjs --verify",
    "",
    "Execute one bounded pass:",
    `  node tools/data-retirement/legacy-market-retirement.mjs --execute --confirm=${EXECUTION_CONFIRMATION}`,
    "",
    "Options:",
    `  --batch-size=<1..100>      Rows per transaction page (default ${LEGACY_MARKET_RETIREMENT_DEFAULTS.batchSize})`,
    `  --max-batches=<1..1000>    Maximum pages for each data class (default ${LEGACY_MARKET_RETIREMENT_DEFAULTS.maxBatches})`,
    "  --dry-run                  Preview only (the default)",
    "  --verify                   Read-only readiness check; exits non-zero until ready",
    "  --execute                  Enable deletion; requires --confirm",
    "  --help                     Show this help",
  ].join("\n");
}

function integerFlag(argument: string, name: string, maximum: number): number {
  const raw = argument.slice(`${name}=`.length);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new UsageError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

export function parseRetirementCliArgs(args: readonly string[]): CliOptions {
  let execute = false;
  let dryRun = false;
  let verify = false;
  let confirmation: string | null = null;
  let batchSize: number = LEGACY_MARKET_RETIREMENT_DEFAULTS.batchSize;
  let maxBatches: number = LEGACY_MARKET_RETIREMENT_DEFAULTS.maxBatches;

  for (const argument of args) {
    if (argument === "--execute") execute = true;
    else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--verify") verify = true;
    else if (argument.startsWith("--confirm=")) {
      confirmation = argument.slice("--confirm=".length);
    } else if (argument.startsWith("--batch-size=")) {
      batchSize = integerFlag(argument, "--batch-size", 100);
    } else if (argument.startsWith("--max-batches=")) {
      maxBatches = integerFlag(argument, "--max-batches", 1_000);
    } else {
      throw new UsageError(`Unknown option: ${argument}`);
    }
  }

  if ([execute, dryRun, verify].filter(Boolean).length > 1) {
    throw new UsageError(
      "Choose only one of --execute, --dry-run, or --verify",
    );
  }
  if (execute && confirmation !== EXECUTION_CONFIRMATION) {
    throw new UsageError(
      `Execution requires --confirm=${EXECUTION_CONFIRMATION}`,
    );
  }
  if (!execute && confirmation !== null) {
    throw new UsageError("--confirm is only valid together with --execute");
  }
  return { execute, verify, batchSize, maxBatches };
}

export function retirementSummaryExitCode(
  options: Pick<CliOptions, "execute" | "verify">,
  summary: LegacyMarketRetirementSummary,
): number {
  if (options.verify) return summary.stage2Ready ? 0 : 3;
  if (options.execute && (summary.capped || !summary.stage2Ready)) return 3;
  return 0;
}

async function runRetirementCli(): Promise<number> {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  let options: CliOptions;
  try {
    options = parseRetirementCliArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Invalid arguments: ${message}\n\n${usage()}\n`);
    return 2;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    process.stderr.write("DATABASE_URL is not set. No data was changed.\n");
    return 1;
  }

  const client = new PrismaClient({
    adapter: new PrismaNeon({ connectionString }),
  });
  try {
    const summary = await retireLegacyMarketData({
      database: client,
      dryRun: !options.execute,
      batchSize: options.batchSize,
      maxBatches: options.maxBatches,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (options.verify) {
      process.stdout.write(
        summary.stage2Ready
          ? "Stage-2 readiness verified: legacy rows, Artifact work, and the full Blob inventory have converged.\n"
          : "Stage-2 readiness not verified. Drain legacy rows and Artifact work, then complete a full Blob inventory scan.\n",
      );
    } else if (summary.mode === "DRY_RUN") {
      process.stdout.write("Dry-run complete. No database rows or Blobs were changed.\n");
    } else if (summary.capped) {
      process.stdout.write(
        "Bounded pass complete; legacy rows remain. Run the same command again.\n",
      );
    } else if (!summary.stage2Ready) {
      process.stdout.write(
        "Legacy database rows are retired, but Artifact work or the full Blob inventory has not converged. Run the protected reconciler and repeat --verify before Stage 2.\n",
      );
    } else {
      process.stdout.write(
        "Stage-1 retirement and Artifact inventory have converged. Stage 2 may proceed.\n",
      );
    }
    return retirementSummaryExitCode(options, summary);
  } catch (error) {
    if (error instanceof LegacyMarketRetirementExecutionError) {
      process.stderr.write(
        `Partial committed summary:\n${JSON.stringify(error.summary, null, 2)}\n`,
      );
      if (error.cause) {
        const cause =
          error.cause instanceof Error
            ? error.cause.stack ?? error.cause.message
            : String(error.cause);
        process.stderr.write(`Root cause: ${cause}\n`);
      }
    }
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`Legacy market retirement failed: ${message}\n`);
    return 1;
  } finally {
    await client.$disconnect();
  }
}

const toolRuntime = globalThis as typeof globalThis & {
  __JOBLIT_RUN_LEGACY_MARKET_RETIREMENT__?: boolean;
};
if (toolRuntime.__JOBLIT_RUN_LEGACY_MARKET_RETIREMENT__ === true) {
  void runRetirementCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
