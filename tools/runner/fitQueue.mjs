/**
 * Fit-scan draining.
 *
 * The queue lives in the database: the server prescreens unscored NEW jobs and
 * hands out leased batches through `next-batch`. This module owns the one step
 * that used to run in the browser through the extension bridge — calling the
 * model — and hands the output straight back to `batch-import`.
 *
 * A batch is normally imported, failed, or released. Two deliberate
 * exceptions preserve the lease and the tracked Hermes state instead: an
 * uncertain import response ("committed but response lost" must not become a
 * second model run or a false failure), and an uncertain Hermes outcome (the
 * run may still be running; the same composition re-leased later resumes it
 * under the same issueKey rather than paying for a second model call).
 */

const DEFAULT_LEASE_WAIT_MS = 5_000;
const MAX_LEASE_WAIT_MS = 30_000;
const DEFAULT_CLEANUP_RETRY_MS = 250;
const CLEANUP_ATTEMPTS = 3;
const HASH_RE = /^[a-f0-9]{64}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIT_VERDICTS = new Set(["STRONG", "GOOD", "MODERATE", "WEAK", "POOR"]);
const AMBIGUOUS_IMPORT_CODES = new Set([
  "JOBLIT_TRANSPORT_ERROR",
  "JOBLIT_REQUEST_TIMEOUT",
  "JOBLIT_REQUEST_ABORTED",
]);
const AMBIGUOUS_HERMES_CODES = new Set([
  "HERMES_PROTOCOL_ERROR",
  "HERMES_REQUEST_TIMEOUT",
  "RUN_OUTCOME_UNKNOWN",
  "RUN_START_UNKNOWN",
  "RUN_STATE_CONFLICT",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function fitIssueFrom(issued) {
  const issueKey = issued?.issueKey;
  if (
    typeof issueKey !== "string" ||
    !HASH_RE.test(issueKey) ||
    issued?.prompt?.sessionId !== issueKey ||
    typeof issued?.prompt?.instructions !== "string" ||
    typeof issued?.prompt?.input !== "string" ||
    !issued?.promptMeta ||
    typeof issued.promptMeta !== "object"
  ) {
    const error = new Error("Fit prompt identity is invalid");
    error.code = "FIT_PROMPT_INVALID";
    throw error;
  }
  return issueKey;
}

function settlementFrom(response, issueKey, jobIds = null) {
  const settlement = response?.settlement;
  const allowed = jobIds ? new Set(jobIds) : null;
  const seen = new Set();
  const scored = settlement?.scored;
  const validScored =
    Array.isArray(scored) &&
    scored.length > 0 &&
    scored.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.jobId === "string" &&
        UUID_RE.test(entry.jobId) &&
        (!allowed || allowed.has(entry.jobId)) &&
        !seen.has(entry.jobId) &&
        (seen.add(entry.jobId), true) &&
        Number.isInteger(entry.fitScore) &&
        entry.fitScore >= 0 &&
        entry.fitScore <= 100 &&
        FIT_VERDICTS.has(entry.fitVerdict),
    );
  if (
    !settlement ||
    settlement.protocolVersion !== 1 ||
    settlement.issueKey !== issueKey ||
    typeof settlement.requestHash !== "string" ||
    !HASH_RE.test(settlement.requestHash) ||
    !validScored
  ) {
    const error = new Error("Fit settlement is invalid");
    error.code = "FIT_SETTLEMENT_INVALID";
    throw error;
  }
  return settlement;
}

function isAmbiguousHermesError(error) {
  if (error instanceof TypeError) return true;
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    AMBIGUOUS_HERMES_CODES.has(error.code)
  );
}

function isAmbiguousImportError(error) {
  if (error instanceof TypeError) return true;
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    (error.status === 408 || error.status >= 500)
  ) {
    return true;
  }
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    AMBIGUOUS_IMPORT_CODES.has(error.code)
  );
}

async function importWithExactReplay({ joblit, request, issueKey, signal }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await joblit.importFitBatch(request);
      return settlementFrom(response, issueKey, request.jobIds);
    } catch (error) {
      if (signal?.aborted || !isAmbiguousImportError(error)) throw error;
      if (attempt === 0) continue;
      const unknown = new Error(
        "Fit settlement is unknown after an exact replay attempt",
      );
      unknown.code = "FIT_SETTLEMENT_UNKNOWN";
      unknown.cause = error;
      throw unknown;
    }
  }
  throw new Error("Fit settlement retry exhausted");
}

async function acknowledgeSettledFit({
  hermes,
  sessionId,
  signal,
  retryMs,
  log,
}) {
  for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      await hermes.acknowledge({ sessionId });
      return;
    } catch (error) {
      if (attempt === CLEANUP_ATTEMPTS || signal?.aborted) {
        const reason = error instanceof Error ? error.message : String(error);
        log(`Fit local Hermes cleanup deferred: ${reason}`);
        return;
      }
      await sleep(retryMs * attempt);
    }
  }
}

async function reconcileSettledFitIssues({
  joblit,
  hermes,
  signal,
  retryMs,
  log,
}) {
  if (
    typeof hermes.recoverableFitIssues !== "function" ||
    typeof joblit.fitSettlement !== "function"
  ) {
    return;
  }

  let recoverable;
  try {
    recoverable = await hermes.recoverableFitIssues();
    if (!Array.isArray(recoverable)) {
      throw new Error("Hermes Fit recovery list is invalid");
    }
  } catch (error) {
    log(
      `Fit recovery scan deferred: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  for (const candidate of recoverable) {
    if (signal?.aborted) return;
    try {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Object.keys(candidate).length !== 2 ||
        typeof candidate.issueKey !== "string" ||
        !HASH_RE.test(candidate.issueKey) ||
        candidate.sessionId !== `joblit:fit:${candidate.issueKey}`
      ) {
        throw new Error("Hermes Fit recovery identity is invalid");
      }
      const response = await joblit.fitSettlement(candidate.issueKey);
      if (response?.settlement === null) {
        log(`Fit recovery preserved: ${candidate.issueKey} has no receipt yet`);
        continue;
      }
      const settlement = settlementFrom(response, candidate.issueKey);
      await acknowledgeSettledFit({
        hermes,
        sessionId: candidate.sessionId,
        signal,
        retryMs,
        log,
      });
      log(
        `Recovered Fit issue ${candidate.issueKey}: ${settlement.scored.length} scores already committed`,
      );
    } catch (error) {
      log(
        `Fit recovery state preserved: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Drain the user's fit queue.
 *
 * @returns {Promise<{ scored: number, failed: number, stopped: string | null }>}
 */
export async function processFitQueue({
  joblit,
  hermes,
  signal,
  log = console.log,
  leaseWaitMs = DEFAULT_LEASE_WAIT_MS,
  cleanupRetryMs = DEFAULT_CLEANUP_RETRY_MS,
}) {
  const summary = { scored: 0, failed: 0, stopped: null };

  await reconcileSettledFitIssues({
    joblit,
    hermes,
    signal,
    retryMs: cleanupRetryMs,
    log,
  });

  for (;;) {
    if (signal?.aborted) {
      summary.stopped = "Runner cancelled";
      return summary;
    }
    const batch = await joblit.nextFitBatch();

    if (!batch.jobIds || batch.jobIds.length === 0) {
      const pendingTotal = nonNegativeInteger(
        batch.pendingTotal,
        nonNegativeInteger(batch.remaining),
      );
      const leased = nonNegativeInteger(batch.leased);
      // Empty does not mean done: another scan may still hold fresh leases.
      if (pendingTotal > 0 || leased > 0) {
        const requested = nonNegativeInteger(batch.retryAfterMs, leaseWaitMs);
        await sleep(Math.min(MAX_LEASE_WAIT_MS, Math.max(leaseWaitMs, requested)));
        continue;
      }
      return summary;
    }

    if (!batch.claimToken) {
      summary.stopped = "Scoring batch claim is missing";
      return summary;
    }

    const claim = { jobIds: batch.jobIds, claimToken: batch.claimToken };

    let issued;
    try {
      issued = await joblit.fitPrompt({ jobIds: batch.jobIds });
      fitIssueFrom(issued);
    } catch (error) {
      // A prompt failure is account-wide — no resume profile, rules missing —
      // so every other batch would fail the same way. Give the claim back
      // instead of burning these jobs, and stop.
      await joblit.releaseFitBatch(claim).catch(() => undefined);
      summary.stopped = error instanceof Error ? error.message : String(error);
      log(`Fit scan stopped: ${summary.stopped}`);
      return summary;
    }

    const issueKey = issued.issueKey;
    const sessionId = `joblit:fit:${issueKey}`;
    let modelOutput;
    try {
      modelOutput = await hermes.generate({
        instructions: issued.prompt.instructions,
        input: issued.prompt.input,
        sessionId,
        signal,
      });

    } catch (error) {
      if (signal?.aborted || isAmbiguousHermesError(error)) {
        // The lease is deliberately NOT released, mirroring the unknown-import
        // branch below. The run may still be running (or already completed)
        // under this issueKey's session: the same jobs re-leased in the same
        // composition produce the same issueKey, and generate() resumes the
        // tracked run instead of paying for a second model call. Releasing
        // would invite a different batch composition, whose new issueKey can
        // never collect the stranded completed state. The server lease
        // expires on its own either way.
        summary.stopped = signal?.aborted
          ? "Runner cancelled; lease left to expire so the run can be resumed"
          : "Hermes result is unknown; lease preserved for exact resume";
        log(`Fit scan stopped: ${summary.stopped}`);
        return summary;
      }
      const reason = error instanceof Error ? error.message : String(error);
      log(`Fit batch failed: ${reason}`);
      await joblit.markFitFailed(claim).catch(() => undefined);
      summary.failed += batch.jobIds.length;
      continue;
    }

    let settlement;
    try {
      const importRequest = {
        jobIds: batch.jobIds,
        claimToken: batch.claimToken,
        issueKey,
        modelOutput,
        promptMeta: issued.promptMeta,
      };
      settlement = await importWithExactReplay({
        joblit,
        request: importRequest,
        issueKey,
        signal,
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "FIT_CLAIM_EXPIRED"
      ) {
        summary.stopped =
          "Fit scan was cancelled or superseded; completed Hermes state was preserved";
        log(`Fit scan stopped: ${summary.stopped}`);
        return summary;
      }
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "FIT_SETTLEMENT_UNKNOWN" ||
          error.code === "FIT_SETTLEMENT_INVALID" ||
          (signal?.aborted && isAmbiguousImportError(error)))
      ) {
        summary.stopped =
          error.code === "FIT_SETTLEMENT_INVALID"
            ? "Fit settlement is invalid; Hermes state was preserved"
            : "Fit settlement is unknown; retry later";
        log(`Fit scan stopped: ${summary.stopped}`);
        return summary;
      }
      const reason = error instanceof Error ? error.message : String(error);
      log(`Fit batch failed: ${reason}`);
      await joblit.markFitFailed(claim).catch(() => undefined);
      summary.failed += batch.jobIds.length;
      continue;
    }

    const scored = settlement.scored.length;
    const missed = batch.jobIds.length - scored;
    if (missed > 0) {
      // The model returned fewer verdicts than jobs; the unscored ones stay
      // leased unless dequeued here.
      await joblit.markFitFailed(claim).catch(() => undefined);
    }
    summary.scored += scored;
    summary.failed += missed;
    await acknowledgeSettledFit({
      hermes,
      sessionId,
      signal,
      retryMs: cleanupRetryMs,
      log,
    });
    log(`Fit batch: ${scored} scored${missed > 0 ? `, ${missed} unscored` : ""}`);
  }
}
