import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("@/lib/server/observability/errorReporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/server/api/routeHandler", () => ({ withSessionRoute: vi.fn() }));
import { assertLocalTaskSessionOrigin, localTaskBody, localTaskJson, withLocalTaskRoute } from "./http";

describe("local task HTTP boundary", () => {
  it("rejects body overflow before parsing and rejects unknown fields", async () => {
    await expect(localTaskBody(new Request("https://joblit.tech", { method: "POST", body: "x".repeat(100) }), z.object({}).strict(), 50)).rejects.toMatchObject({ status: 413 });
    await expect(localTaskBody(new Request("https://joblit.tech", { method: "POST", body: '{"userId":"other"}' }), z.object({}).strict())).rejects.toMatchObject({ status: 400 });
  });
  it("rejects cross-origin session writes including sibling origins", () => {
    expect(() => assertLocalTaskSessionOrigin(new Request("https://joblit.tech/api/local-tailoring/tasks", { headers: { origin: "https://other.joblit.tech" } }))).toThrow("Start this action");
    expect(() => assertLocalTaskSessionOrigin(new Request("https://joblit.tech/api/local-tailoring/tasks", { headers: { origin: "https://joblit.tech" } }))).not.toThrow();
  });
  it("never treats a session cookie as a result-submission capability", async () => {
    const handler = vi.fn();
    const result = await withLocalTaskRoute(new Request("https://joblit.tech", { headers: { cookie: "session=present" } }), { params: Promise.resolve({ id: "10000000-0000-4000-8000-000000000001" }) }, handler);
    expect(result.status).toBe(401); expect(handler).not.toHaveBeenCalled();
  });
  it("limits a bearer to the parsed task id and returns non-cacheable JSON", async () => {
    const handler = vi.fn(async () => localTaskJson({ status: "pending" }));
    const id = "10000000-0000-4000-8000-000000000001";
    const result = await withLocalTaskRoute(new Request("https://joblit.tech", { headers: { authorization: `Bearer ${"x".repeat(43)}` } }), { params: Promise.resolve({ id }) }, handler);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id, access: { capability: "x".repeat(43) } }));
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
});
