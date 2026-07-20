import { prisma } from "@/lib/server/prisma";
import { safeOutboundFetch } from "@/lib/server/net/safeFetch";
import { fetchSourceJson } from "./http";
import { createAtsAdapter } from "./adapters/ats";
import {
  discoverAtsBoardsFromHtml,
  rediscoverAtsBoardAfter404,
} from "./atsRediscovery";
import type { AtsBoardConfig } from "./atsBoards";
import { classifySourceFailure } from "./sourceHealth";
import type { SourceDiagnostic } from "./runSourceFetch";
import type { RawSourceJob, SourceContext } from "./types";

const REDISCOVERY_COOLDOWN_MS = 24 * 60 * 60 * 1_000;
const MAX_REDISCOVERIES_PER_RUN = 1;
const MAX_CANDIDATE_PROBES = 1;
const RECOVERY_TIMEOUT_MS = 4_000;

export interface RecoveredAtsSource {
  source: string;
  config: AtsBoardConfig;
  jobs: RawSourceJob[];
}

export interface AtsRediscoveryBatchResult {
  recovered: RecoveredAtsSource[];
  errors: Array<{ source: string; message: string }>;
}

interface RediscoveryClaim {
  attemptedAt: Date;
}

interface AtsRediscoveryDependencies {
  claimAttempt: (
    board: AtsBoardConfig,
    attemptedAt: Date,
    retryBefore: Date,
  ) => Promise<RediscoveryClaim | null>;
  fetchCareersHtml: (url: string) => Promise<string>;
  fetchJobs: (board: AtsBoardConfig) => Promise<RawSourceJob[]>;
  persistBoard: (
    previous: AtsBoardConfig,
    next: AtsBoardConfig,
    claim: RediscoveryClaim,
  ) => Promise<boolean>;
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || "rediscovery_failed";
}

const productionDependencies: AtsRediscoveryDependencies = {
  async claimAttempt(board, attemptedAt, retryBefore) {
    if (!board.careersUrl) return null;
    const result = await prisma.atsBoardSource.updateMany({
      where: {
        sourceId: board.id,
        provider: board.provider,
        boardToken: board.boardToken,
        careersUrl: board.careersUrl,
        enabled: true,
        OR: [
          { lastRediscoveredAt: null },
          { lastRediscoveredAt: { lt: retryBefore } },
        ],
      },
      data: { lastRediscoveredAt: attemptedAt },
    });
    return result.count === 1 ? { attemptedAt } : null;
  },

  async fetchCareersHtml(value) {
    const url = new URL(value);
    const response = await safeOutboundFetch(
      url,
      {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent":
            "Mozilla/5.0 (compatible; JoblitBot/1.0; +https://www.joblit.tech)",
        },
      },
      {
        allowedHosts: [url.hostname],
        allowSubdomains: false,
        maxRedirects: 2,
        maxResponseBytes: 1 * 1024 * 1024,
        timeoutMs: RECOVERY_TIMEOUT_MS,
      },
    );
    if (!response.ok) {
      throw new Error(`careers page HTTP ${response.status}`);
    }
    return response.text();
  },

  async fetchJobs(board) {
    const context: SourceContext = {
      fetchJson: (url, allowedHosts) =>
        fetchSourceJson(url, allowedHosts, RECOVERY_TIMEOUT_MS),
    };
    return createAtsAdapter(board).fetch(context);
  },

  async persistBoard(previous, next, claim) {
    const result = await prisma.atsBoardSource.updateMany({
      where: {
        sourceId: previous.id,
        provider: previous.provider,
        boardToken: previous.boardToken,
        careersUrl: previous.careersUrl,
        region: previous.region ?? null,
        enabled: true,
        lastRediscoveredAt: claim.attemptedAt,
      },
      data: {
        boardToken: next.boardToken,
        region:
          next.provider === "lever" ? (next.region ?? "global") : null,
      },
    });
    return result.count === 1;
  },
};

export interface RecoverAtsBoardsOptions {
  boards: readonly AtsBoardConfig[];
  diagnostics: readonly SourceDiagnostic[];
  now?: Date;
  /** Unit-test seam. Production always uses guarded outbound requests. */
  dependencies?: Partial<AtsRediscoveryDependencies>;
}

/**
 * Repair DB-backed public ATS tenant slugs after confirmed 404/410 failures.
 *
 * Recovery stays user-triggered: no scheduler. A DB compare-and-set claims one
 * attempt per source per day, then a guarded careers-page read discovers only
 * known ATS hosts. Successful probe results are returned for the current run,
 * so recovery does not require another Fetch click.
 */
export async function recoverAtsBoardsAfter404(
  options: RecoverAtsBoardsOptions,
): Promise<AtsRediscoveryBatchResult> {
  const dependencies = {
    ...productionDependencies,
    ...options.dependencies,
  };
  const now = options.now ?? new Date();
  const retryBefore = new Date(now.getTime() - REDISCOVERY_COOLDOWN_MS);
  const diagnosticBySource = new Map(
    options.diagnostics.map((diagnostic) => [diagnostic.source, diagnostic]),
  );
  const candidates = options.boards
    .filter((board) => {
      const diagnostic = diagnosticBySource.get(board.id);
      return (
        Boolean(board.careersUrl) &&
        diagnostic?.ok === false &&
        classifySourceFailure(diagnostic.error ?? "") === "slug_gone"
      );
    })
    .slice(0, MAX_REDISCOVERIES_PER_RUN);

  const recovered: RecoveredAtsSource[] = [];
  const errors: AtsRediscoveryBatchResult["errors"] = [];
  for (const board of candidates) {
    try {
      const claim = await dependencies.claimAttempt(board, now, retryBefore);
      if (!claim) {
        continue;
      }
      const html = await dependencies.fetchCareersHtml(board.careersUrl!);
      const discovered = discoverAtsBoardsFromHtml(
        html,
        board.careersUrl!,
      );
      let probedJobs: RawSourceJob[] = [];
      const failedStatus = /\b410\b/.test(
        diagnosticBySource.get(board.id)?.error ?? "",
      )
        ? 410
        : 404;
      const result = await rediscoverAtsBoardAfter404({
        failedStatus,
        current: board,
        candidates: discovered,
        maxAttempts: MAX_CANDIDATE_PROBES,
        probe: async (candidate) => {
          probedJobs = await dependencies.fetchJobs(candidate);
          return true;
        },
      });
      if (result.status !== "rediscovered") continue;
      if (!(await dependencies.persistBoard(board, result.config, claim))) {
        errors.push({
          source: board.id,
          message: "board changed during rediscovery",
        });
        continue;
      }
      recovered.push({
        source: board.id,
        config: result.config,
        jobs: probedJobs,
      });
    } catch (error) {
      errors.push({ source: board.id, message: shortError(error) });
    }
  }

  return { recovered, errors };
}
