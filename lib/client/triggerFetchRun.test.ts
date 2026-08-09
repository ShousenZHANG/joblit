import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerFetchRun } from "./triggerFetchRun";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("triggerFetchRun", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("invokes browser fetch with the Window receiver", async () => {
    const browserFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation",
        );
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", browserFetch);

    await expect(
      triggerFetchRun({ id: "browser-run", source: "jobspy" }),
    ).resolves.toBeUndefined();
    expect(browserFetch.mock.contexts[0]).toBe(globalThis);
  });

  it("never retries a failed AU dispatch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: "Dispatch timed out" } }, 504),
    );

    await expect(
      triggerFetchRun(
        { id: "au-run", source: "jobspy" },
        {
          fetchImpl,
          errorMessage: (_response, body) =>
            (body as { error: { message: string } }).error.message,
        },
      ),
    ).rejects.toThrow("Dispatch timed out");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
