/**
 * The Joblit Runner — the batch protocol's first unattended worker.
 *
 * What Codex did interactively, this does headless: claim tailoring tasks
 * from the server, generate each remaining target through the local Hermes
 * gateway on loopback, and import the result with the exact receipt and
 * TailoringRun handle the prompt endpoint issued. The browser is not
 * involved, and the Hermes key never leaves this machine — it is read from
 * local configuration and sent only to 127.0.0.1.
 *
 * Deliberately dependency-free and repo-import-free: the HTTP API is the
 * contract, same as for any external agent. See AGENTS.md.
 */

const TARGET_LABELS = { RESUME: "resume", COVER: "cover" };

/**
 * Drain the user's active batch: claim one task per round trip, generate its
 * remaining targets, settle by importing (success is implicit in the batch
 * protocol — completedTasks carries only FAILED and SKIPPED), and report
 * failures on the next claim.
 *
 * @param {{
 *   joblit: {
 *     activeBatch(): Promise<{ batchId: string | null, status?: string }>,
 *     runOnce(batchId: string, body: { completedTasks: Array<object> }): Promise<{
 *       batch: { id: string, status: string },
 *       tasks: Array<{
 *         taskId: string,
 *         attemptId: string,
 *         jobId: string,
 *         remainingTargets: Array<"RESUME" | "COVER">,
 *         job?: { title?: string, company?: string | null },
 *       }>,
 *       execution: { stopReason: string | null },
 *     }>,
 *     prompt(request: object): Promise<{
 *       prompt: { systemPrompt: string, userPrompt: string },
 *       promptMeta: object,
 *       tailoringRun?: object,
 *     }>,
 *     importGeneration(request: object): Promise<unknown>,
 *   },
 *   hermes: {
 *     generate(run: { instructions: string, input: string, sessionId: string }): Promise<string>,
 *   },
 *   log?: (message: string) => void,
 * }} deps
 */
export async function processActiveBatch({ joblit, hermes, log = console.log }) {
  const summary = { succeeded: 0, failed: 0, batchId: null };

  const active = await joblit.activeBatch();
  if (!active.batchId) {
    log("No active batch. Select jobs in Joblit and queue a generation batch.");
    return summary;
  }
  summary.batchId = active.batchId;
  log(`Working batch ${active.batchId}`);

  /** @type {Array<{ taskId: string, attemptId: string, status: "FAILED" | "SKIPPED", error?: string }>} */
  let completedTasks = [];

  for (;;) {
    const round = await joblit.runOnce(active.batchId, { completedTasks });
    completedTasks = [];

    const task = round.tasks[0];
    if (!task) {
      log(`Batch ${round.batch.status.toLowerCase()}; nothing left to claim.`);
      return summary;
    }

    const label = task.job?.title
      ? `${task.job.title}${task.job.company ? ` @ ${task.job.company}` : ""}`
      : task.jobId;
    log(`Task ${task.taskId} (${label}): ${task.remainingTargets.join(", ")}`);

    try {
      for (const remaining of task.remainingTargets) {
        const target = TARGET_LABELS[remaining];
        if (!target) throw new Error(`Unknown target ${remaining}`);

        const issued = await joblit.prompt({
          jobId: task.jobId,
          target,
          source: "codex_batch",
          delivery: "FINAL",
          batchId: active.batchId,
          batchTaskId: task.taskId,
          batchAttemptId: task.attemptId,
        });

        const modelOutput = await hermes.generate({
          instructions: issued.prompt.systemPrompt,
          input: issued.prompt.userPrompt,
          sessionId: `joblit:${task.taskId}`,
        });

        // The receipt and handle go back verbatim: the server verifies the
        // import against exactly what it issued, and any local edit would be
        // rejected as a receipt mismatch.
        await joblit.importGeneration({
          jobId: task.jobId,
          target,
          source: "codex_batch",
          modelOutput,
          promptMeta: issued.promptMeta,
          ...(issued.tailoringRun ? { tailoringRun: issued.tailoringRun } : {}),
        });
        log(`  ${target}: imported`);
      }
      // Success is settled by the imports themselves; nothing to report.
      summary.succeeded += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`  FAILED: ${reason}`);
      completedTasks = [
        {
          taskId: task.taskId,
          attemptId: task.attemptId,
          status: "FAILED",
          error: reason.slice(0, 500),
        },
      ];
      summary.failed += 1;
    }
  }
}
