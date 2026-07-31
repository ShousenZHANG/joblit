/**
 * Creates a request deadline whose timer stays referenced while the request is
 * pending. Node's AbortSignal.timeout() uses an unref'ed timer, which can let a
 * custom transport leave a request promise unresolved as the event loop exits.
 */
export function createRequestDeadline(timeoutMs) {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    expired: () => expired,
    dispose: () => clearTimeout(timer),
  };
}
