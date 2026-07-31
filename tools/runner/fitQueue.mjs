/**
 * Fit-scan draining.
 *
 * The queue lives in the database: the server prescreens unscored NEW jobs and
 * hands out leased batches through `next-batch`. This module owns the one step
 * that used to run in the browser through the extension bridge — calling the
 * model — and hands the output straight back to `batch-import`.
 *
 * A batch is never left leased. Either it imports, or it is marked failed so
 * the pump cannot loop on it, or its claim is released when the failure is
 * account-wide and retrying the same batch would fail identically.
 */

const DEFAULT_LEASE_WAIT_MS = 5_000;
const MAX_LEASE_WAIT_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

/**
 * Drain the user's fit queue.
 *
 * @returns {Promise<{ scored: number, failed: number, stopped: string | null }>}
 */
export async function processFitQueue({
  joblit,
  hermes,
  log = console.log,
  leaseWaitMs = DEFAULT_LEASE_WAIT_MS,
}) {
  const summary = { scored: 0, failed: 0, stopped: null };

  for (;;) {
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
    } catch (error) {
      // A prompt failure is account-wide — no resume profile, rules missing —
      // so every other batch would fail the same way. Give the claim back
      // instead of burning these jobs, and stop.
      await joblit.releaseFitBatch(claim).catch(() => undefined);
      summary.stopped = error instanceof Error ? error.message : String(error);
      log(`Fit scan stopped: ${summary.stopped}`);
      return summary;
    }

    try {
      const modelOutput = await hermes.generate({
        instructions: issued.prompt.instructions,
        input: issued.prompt.input,
        sessionId: `joblit:fit:${issued.prompt.sessionId}`,
      });

      const imported = await joblit.importFitBatch({
        jobIds: batch.jobIds,
        claimToken: batch.claimToken,
        modelOutput,
        promptMeta: issued.promptMeta,
      });

      const scored = imported.scored?.length ?? 0;
      const missed = batch.jobIds.length - scored;
      if (missed > 0) {
        // The model returned fewer verdicts than jobs; the unscored ones stay
        // leased unless dequeued here.
        await joblit.markFitFailed(claim).catch(() => undefined);
      }
      summary.scored += scored;
      summary.failed += missed;
      log(`Fit batch: ${scored} scored${missed > 0 ? `, ${missed} unscored` : ""}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`Fit batch failed: ${reason}`);
      await joblit.markFitFailed(claim).catch(() => undefined);
      summary.failed += batch.jobIds.length;
    }
  }
}
