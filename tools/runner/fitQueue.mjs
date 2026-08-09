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
const DEFAULT_FIT_HEARTBEAT_MS = 60_000;
const CLEANUP_ATTEMPTS = 3;
const HASH_RE = /^[a-f0-9]{64}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIT_VERDICTS = new Set(["STRONG", "GOOD", "MODERATE", "WEAK", "POOR"]);
const FIT_FAILURE_CODES = new Set(["MODEL_RESULT_MISSING", "JOB_UNAVAILABLE"]);
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

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}

function nonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : fallback;
}

function markedFailureCount(response, batchSize) {
  const count = response?.count;
  if (!Number.isSafeInteger(count) || count < 0 || count > batchSize) {
    const error = new Error("Fit failure settlement response is invalid");
    error.code = "FIT_FAILURE_SETTLEMENT_INVALID";
    throw error;
  }
  return count;
}

function isSupersededFitAuthority(error) {
  return (
    error &&
    typeof error === "object" &&
    (error.code === "FIT_CLAIM_EXPIRED" || error.code === "FIT_ATTEMPT_STALE")
  );
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

function durableFitClaimFrom(batch, issued, issueKey) {
  const ownsAnyHandle = batch.claimId != null || batch.attemptId != null;
  if (!ownsAnyHandle) return null;
  const handle = issued?.fitClaim;
  if (
    typeof batch.claimId !== "string" ||
    !UUID_RE.test(batch.claimId) ||
    typeof batch.attemptId !== "string" ||
    !UUID_RE.test(batch.attemptId) ||
    batch.claimToken !== batch.attemptId ||
    !handle ||
    typeof handle !== "object" ||
    Array.isArray(handle) ||
    handle.id !== batch.claimId ||
    handle.attemptId !== batch.attemptId ||
    handle.issueKey !== issueKey
  ) {
    const error = new Error("Durable Fit Claim identity is invalid");
    error.code = "FIT_CLAIM_INVALID";
    throw error;
  }
  return { claimId: handle.id, attemptId: handle.attemptId };
}

function isLegacyFitPromptRejection(error) {
  return (
    error &&
    typeof error === "object" &&
    error.code === "INVALID_BODY" &&
    error.status === 400
  );
}

async function issueFitPrompt(joblit, claim) {
  try {
    return await joblit.fitPrompt(claim);
  } catch (error) {
    const durableRequest = "claimId" in claim || "attemptId" in claim;
    if (durableRequest || !isLegacyFitPromptRejection(error)) throw error;
    return joblit.fitPrompt({ jobIds: claim.jobIds });
  }
}

function settlementFrom(response, issueKey, jobIds = null) {
  const settlement = response?.settlement;
  const allowed = jobIds ? new Set(jobIds) : null;
  const seen = new Set();
  const scored = settlement?.scored;
  const ownsFailed = Boolean(
    settlement &&
    typeof settlement === "object" &&
    !Array.isArray(settlement) &&
    Object.prototype.hasOwnProperty.call(settlement, "failed"),
  );
  const failed = ownsFailed ? settlement.failed : [];
  const settlementKeys = settlement ? Object.keys(settlement) : [];
  const allowedSettlementKeys = ownsFailed
    ? new Set([
        "protocolVersion",
        "issueKey",
        "requestHash",
        "scored",
        "failed",
      ])
    : new Set(["protocolVersion", "issueKey", "requestHash", "scored"]);
  const validScored =
    Array.isArray(scored) &&
    scored.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        Object.keys(entry).length === 3 &&
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
  const validFailed =
    Array.isArray(failed) &&
    failed.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        Object.keys(entry).length === 2 &&
        typeof entry.jobId === "string" &&
        UUID_RE.test(entry.jobId) &&
        (!allowed || allowed.has(entry.jobId)) &&
        !seen.has(entry.jobId) &&
        (seen.add(entry.jobId), true) &&
        FIT_FAILURE_CODES.has(entry.code),
    );
  const exactCoverage =
    !allowed ||
    (!ownsFailed
      ? scored?.length <= allowed.size
      : seen.size === allowed.size &&
        [...allowed].every((jobId) => seen.has(jobId)));
  if (
    !settlement ||
    typeof settlement !== "object" ||
    Array.isArray(settlement) ||
    settlementKeys.some((key) => !allowedSettlementKeys.has(key)) ||
    settlementKeys.length !== allowedSettlementKeys.size ||
    settlement.protocolVersion !== 1 ||
    settlement.issueKey !== issueKey ||
    typeof settlement.requestHash !== "string" ||
    !HASH_RE.test(settlement.requestHash) ||
    !validScored ||
    !validFailed ||
    scored.length + failed.length === 0 ||
    (!ownsFailed && scored.length === 0) ||
    !exactCoverage
  ) {
    const error = new Error("Fit settlement is invalid");
    error.code = "FIT_SETTLEMENT_INVALID";
    throw error;
  }

  if (ownsFailed || !allowed) {
    return { ...settlement, failed, legacyWithoutFailed: !ownsFailed };
  }

  // A rolling deployment may still answer with the old strict receipt shape.
  // Its missing jobs were not atomically terminalized, so expose them through
  // the new summary model while retaining the legacy cleanup path below.
  return {
    ...settlement,
    failed: jobIds
      .filter((jobId) => !seen.has(jobId))
      .map((jobId) => ({ jobId, code: "MODEL_RESULT_MISSING" })),
    legacyWithoutFailed: true,
  };
}

function recoveryDisposition(response, issueKey) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    const error = new Error("Fit settlement status is invalid");
    error.code = "FIT_SETTLEMENT_INVALID";
    throw error;
  }
  if (!("status" in response)) {
    return response.settlement === null
      ? { status: "ACTIVE", settlement: null }
      : {
          status: "SETTLED",
          settlement: settlementFrom(response, issueKey),
        };
  }
  if (response.status === "ACTIVE" && response.settlement === null) {
    return { status: "ACTIVE", settlement: null };
  }
  if (
    response.status === "TERMINAL_WITHOUT_RECEIPT" &&
    response.settlement === null
  ) {
    return { status: "TERMINAL_WITHOUT_RECEIPT", settlement: null };
  }
  if (response.status === "SETTLED") {
    return {
      status: "SETTLED",
      settlement: settlementFrom(response, issueKey),
    };
  }
  const error = new Error("Fit settlement status is invalid");
  error.code = "FIT_SETTLEMENT_INVALID";
  throw error;
}

function heartbeatFailure(cause) {
  const error = new Error(
    `Fit Claim heartbeat failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    { cause },
  );
  error.code = "FIT_HEARTBEAT_FAILED";
  return error;
}

function readHeartbeat(response, expected) {
  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    response.claimId !== expected.claimId ||
    response.attemptId !== expected.attemptId ||
    typeof response.leaseExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(response.leaseExpiresAt)) ||
    !Number.isSafeInteger(response.heartbeatAfterMs) ||
    response.heartbeatAfterMs <= 0
  ) {
    throw new Error("Fit Claim heartbeat response is invalid");
  }
  return response.heartbeatAfterMs;
}

async function withFitClaimHeartbeat({
  joblit,
  fitClaim,
  signal,
  operation,
  wait,
}) {
  if (!fitClaim) return operation(signal);
  if (typeof joblit.heartbeatFitClaim !== "function") {
    throw heartbeatFailure(new Error("Joblit Fit heartbeat is unavailable"));
  }

  let heartbeatAfterMs;
  try {
    heartbeatAfterMs = readHeartbeat(
      await joblit.heartbeatFitClaim(fitClaim, { signal }),
      fitClaim,
    );
  } catch (error) {
    throw heartbeatFailure(error);
  }

  const monitorStop = new AbortController();
  let heartbeatError = null;
  const monitor = (async () => {
    let nextDelay = heartbeatAfterMs || DEFAULT_FIT_HEARTBEAT_MS;
    while (!monitorStop.signal.aborted) {
      await wait(nextDelay, monitorStop.signal);
      if (monitorStop.signal.aborted) return;
      try {
        nextDelay = readHeartbeat(
          await joblit.heartbeatFitClaim(fitClaim, {
            signal: monitorStop.signal,
          }),
          fitClaim,
        );
      } catch (error) {
        if (monitorStop.signal.aborted) return;
        heartbeatError = heartbeatFailure(error);
        return;
      }
    }
  })();

  try {
    // Losing the Joblit lease is not authority to stop an already-started
    // local model run. Let Hermes finish into durable local state, then defer
    // import until the server-side claim can be reconciled.
    const result = await operation(signal);
    if (heartbeatError) throw heartbeatError;
    return result;
  } catch (error) {
    if (heartbeatError) throw heartbeatError;
    throw error;
  } finally {
    monitorStop.abort();
    await monitor;
  }
}

function isAmbiguousHermesError(error) {
  if (error instanceof TypeError) return true;
  if (
    error &&
    typeof error === "object" &&
    error.code === "HERMES_HTTP_ERROR" &&
    Number.isInteger(error.status) &&
    (error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500)
  ) {
    return true;
  }
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
    (error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500)
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
        (Object.keys(candidate).length !== 2 &&
          Object.keys(candidate).length !== 3) ||
        typeof candidate.issueKey !== "string" ||
        !HASH_RE.test(candidate.issueKey) ||
        candidate.sessionId !== `joblit:fit:${candidate.issueKey}` ||
        (candidate.phase !== undefined &&
          candidate.phase !== "starting" &&
          candidate.phase !== "running" &&
          candidate.phase !== "completed")
      ) {
        throw new Error("Hermes Fit recovery identity is invalid");
      }
      const livePhase =
        candidate.phase === "starting" || candidate.phase === "running";
      const response = await joblit.fitSettlement(candidate.issueKey);
      const disposition = recoveryDisposition(response, candidate.issueKey);
      if (disposition.status === "ACTIVE") {
        log(`Fit recovery preserved: ${candidate.issueKey} has no receipt yet`);
        continue;
      }
      if (disposition.status === "TERMINAL_WITHOUT_RECEIPT") {
        if (livePhase) {
          if (typeof hermes.reconcileObsolete !== "function") {
            throw new Error("Hermes cannot reconcile live obsolete Fit state");
          }
          await hermes.reconcileObsolete({
            sessionId: candidate.sessionId,
            signal,
          });
          log(
            `Discarded Fit issue ${candidate.issueKey}: terminal without receipt`,
          );
          continue;
        }
        if (typeof hermes.discard !== "function") {
          throw new Error("Hermes cannot discard an obsolete Fit result");
        }
        await hermes.discard({ sessionId: candidate.sessionId });
        log(
          `Discarded Fit issue ${candidate.issueKey}: terminal without receipt`,
        );
        continue;
      }
      const settlement = disposition.settlement;
      if (livePhase) {
        if (typeof hermes.reconcileObsolete !== "function") {
          throw new Error("Hermes cannot reconcile live settled Fit state");
        }
        await hermes.reconcileObsolete({
          sessionId: candidate.sessionId,
          signal,
        });
        log(
          `Recovered Fit issue ${candidate.issueKey}: ${settlement.scored.length} scores already committed`,
        );
        continue;
      }
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
  heartbeatWait = sleep,
  maxBatches = Number.POSITIVE_INFINITY,
}) {
  const summary = { scored: 0, failed: 0, stopped: null };
  const batchLimit =
    Number.isSafeInteger(maxBatches) && maxBatches > 0
      ? maxBatches
      : Number.POSITIVE_INFINITY;
  let processedBatches = 0;

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
        // A bounded pass is the cooperative scheduler used by `--watch`.
        // Yield to the outer Application-first loop instead of sleeping behind
        // a Fit lease that may remain active for minutes.
        if (Number.isFinite(batchLimit)) return summary;
        const requested = nonNegativeInteger(batch.retryAfterMs, leaseWaitMs);
        await sleep(
          Math.min(MAX_LEASE_WAIT_MS, Math.max(leaseWaitMs, requested)),
          signal,
        );
        continue;
      }
      return summary;
    }

    if (!batch.claimToken) {
      summary.stopped = "Scoring batch claim is missing";
      return summary;
    }
    processedBatches += 1;

    // Keep release/failure calls on the established v1 shape, while binding a
    // durable prompt to both parts of the v2 Claim identity when advertised.
    const claim = { jobIds: batch.jobIds, claimToken: batch.claimToken };
    const promptClaim =
      batch.claimId != null || batch.attemptId != null
        ? {
            ...claim,
            claimId: batch.claimId,
            attemptId: batch.attemptId,
          }
        : claim;

    let issued;
    let fitClaim;
    try {
      issued = await issueFitPrompt(joblit, promptClaim);
      const issuedIssueKey = fitIssueFrom(issued);
      fitClaim = durableFitClaimFrom(batch, issued, issuedIssueKey);
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
      modelOutput = await withFitClaimHeartbeat({
        joblit,
        fitClaim,
        signal,
        wait: heartbeatWait,
        operation: (controlledSignal) =>
          hermes.generate({
            instructions: issued.prompt.instructions,
            input: issued.prompt.input,
            sessionId,
            signal: controlledSignal,
          }),
      });
    } catch (error) {
      if (signal?.aborted) {
        summary.stopped =
          "Runner cancelled; lease left to expire so the run can be resumed";
        log(`Fit scan stopped: ${summary.stopped}`);
        return summary;
      }
      if (
        error &&
        typeof error === "object" &&
        error.code === "RUN_CANCELLED" &&
        !signal?.aborted
      ) {
        await joblit.releaseFitBatch(claim).catch(() => undefined);
        summary.stopped = "Hermes run was cancelled; Fit claim released";
        log(`Fit scan stopped: ${summary.stopped}`);
        return summary;
      }
      if (
        error &&
        typeof error === "object" &&
        error.code === "FIT_HEARTBEAT_FAILED"
      ) {
        summary.stopped =
          "Fit Claim heartbeat failed; lease and Hermes state were preserved";
        log(`Fit scan stopped: ${summary.stopped}`);
        return summary;
      }
      if (isAmbiguousHermesError(error)) {
        // The lease is deliberately NOT released, mirroring the unknown-import
        // branch below. The run may still be running (or already completed)
        // under this issueKey's session: the same jobs re-leased in the same
        // composition produce the same issueKey, and generate() resumes the
        // tracked run instead of paying for a second model call. Releasing
        // would invite a different batch composition, whose new issueKey can
        // never collect the stranded completed state. The server lease
        // expires on its own either way.
        summary.stopped =
          "Hermes result is unknown; lease preserved for exact resume";
        log(`Fit scan stopped: ${summary.stopped}`);
        return summary;
      }
      const reason = error instanceof Error ? error.message : String(error);
      log(`Fit batch failed: ${reason}`);
      let failedCount;
      try {
        failedCount = markedFailureCount(
          await joblit.markFitFailed(claim),
          batch.jobIds.length,
        );
      } catch (settlementError) {
        summary.stopped = isSupersededFitAuthority(settlementError)
          ? "Fit claim was cancelled or superseded before failure settlement"
          : "Fit failure settlement is unknown; retry later";
        log(`Fit scan stopped: ${summary.stopped}`);
        return summary;
      }
      if (failedCount === 0) {
        summary.stopped =
          "Fit claim was cancelled or superseded before failure settlement";
        log(`Fit scan stopped: ${summary.stopped}`);
        return summary;
      }
      summary.failed += failedCount;
      if (processedBatches >= batchLimit) return summary;
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
        (error.code === "FIT_CLAIM_EXPIRED" ||
          error.code === "FIT_ATTEMPT_STALE")
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
      if (processedBatches >= batchLimit) return summary;
      continue;
    }

    const scored = settlement.scored.length;
    const failed = settlement.failed.length;
    if (settlement.legacyWithoutFailed && failed > 0) {
      // Only an old server needs this compatibility cleanup. New receipts
      // atomically terminate every failed item and must never be mutated by a
      // second mark-failed request.
      await joblit.markFitFailed(claim).catch(() => undefined);
    }
    summary.scored += scored;
    summary.failed += failed;
    await acknowledgeSettledFit({
      hermes,
      sessionId,
      signal,
      retryMs: cleanupRetryMs,
      log,
    });
    log(`Fit batch: ${scored} scored${failed > 0 ? `, ${failed} failed` : ""}`);
    if (processedBatches >= batchLimit) return summary;
  }
}
