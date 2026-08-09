export interface TriggerFetchRunTarget {
  id: string;
  source: "jobspy";
}

interface TriggerFetchRunOptions {
  fetchImpl?: typeof fetch;
  errorMessage?: (response: Response, body: unknown) => string;
}

/**
 * Dispatch one AU run exactly once.
 *
 * GitHub Actions owns recovery after handoff, so browser retries would risk a
 * duplicate workflow. Bind the Web IDL fetch receiver to avoid Window's
 * "Illegal invocation" error when a test seam or browser implementation checks
 * its receiver.
 */
export async function triggerFetchRun(
  target: TriggerFetchRunTarget,
  {
    fetchImpl = fetch,
    errorMessage = () => "Failed to trigger run",
  }: TriggerFetchRunOptions = {},
): Promise<void> {
  const response = await fetchImpl.bind(globalThis)(
    `/api/fetch-runs/${target.id}/trigger`,
    { method: "POST" },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(response, body));
}
