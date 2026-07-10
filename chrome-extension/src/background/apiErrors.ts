/** HTTP request failure that preserves the response status for retry policy. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Return whether a failed API request is safe to retry later. */
export function isRetryableApiError(error: unknown): boolean {
  if (error instanceof TypeError) return true;

  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return true;
  }

  if (!(error instanceof ApiRequestError)) return false;

  return (
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    (error.status >= 500 && error.status <= 599)
  );
}
