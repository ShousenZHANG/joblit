import { beforeEach, describe, expect, it, vi } from "vitest";

const reconcileMocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
}));

vi.mock("@/lib/server/artifacts/artifactReconciler", () => ({
  reconcileApplicationArtifacts: reconcileMocks.reconcile,
}));

import { GET } from "@/app/api/artifacts/reconcile/route";

const CRON_SECRET = "0123456789abcdef0123456789abcdef";

describe("artifact reconciler cron route", () => {
  beforeEach(() => {
    reconcileMocks.reconcile.mockReset();
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.ARTIFACT_RECONCILE_ENABLED = "true";
    delete process.env.ARTIFACT_RECONCILE_SECRET;
  });

  it("fails closed when no reconciler secret is configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(
      new Request("https://www.joblit.tech/api/artifacts/reconcile"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(reconcileMocks.reconcile).not.toHaveBeenCalled();
  });

  it("reports the default-off kill switch without touching the queue", async () => {
    delete process.env.ARTIFACT_RECONCILE_ENABLED;

    const response = await GET(
      new Request("https://www.joblit.tech/api/artifacts/reconcile", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ kind: "disabled" });
    expect(reconcileMocks.reconcile).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer without touching the queue", async () => {
    const response = await GET(
      new Request("https://www.joblit.tech/api/artifacts/reconcile", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(reconcileMocks.reconcile).not.toHaveBeenCalled();
  });

  it("accepts the dedicated secret and reports missing Blob configuration", async () => {
    delete process.env.CRON_SECRET;
    process.env.ARTIFACT_RECONCILE_SECRET = "artifact-only-secret";
    reconcileMocks.reconcile.mockResolvedValue({
      kind: "port_unavailable",
      claimed: 0,
      retried: 0,
      inventory: { status: "disabled" },
    });

    const response = await GET(
      new Request("https://www.joblit.tech/api/artifacts/reconcile", {
        headers: { authorization: "Bearer artifact-only-secret" },
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "ARTIFACT_STORAGE_UNAVAILABLE",
      },
    });
  });

  it("returns the durable reconciler summary for an authorized cron", async () => {
    reconcileMocks.reconcile.mockResolvedValue({
      kind: "completed",
      claimed: 4,
      deleted: 2,
      notFound: 1,
      protected: 0,
      retried: 1,
      inventory: { pages: 1, seen: 6, discovered: 0 },
    });

    const response = await GET(
      new Request("https://www.joblit.tech/api/artifacts/reconcile", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      kind: "completed",
      claimed: 4,
      deleted: 2,
      notFound: 1,
      protected: 0,
      retried: 1,
      inventory: { pages: 1, seen: 6, discovered: 0 },
    });
    expect(reconcileMocks.reconcile).toHaveBeenCalledTimes(1);
  });

  it("returns a no-store 500 when reconciliation throws", async () => {
    reconcileMocks.reconcile.mockRejectedValue(new Error("database down"));

    const response = await GET(
      new Request("https://www.joblit.tech/api/artifacts/reconcile", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ARTIFACT_RECONCILE_FAILED",
        message: "Artifact reconciliation failed",
      },
    });
  });
});
