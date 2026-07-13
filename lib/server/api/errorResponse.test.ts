import { describe, it, expect } from "vitest";
import {
  createRequestId,
  errorJson,
  unauthorizedError,
  notFoundError,
  validationError,
} from "./errorResponse";
import { ZodError } from "zod";

describe("createRequestId", () => {
  it("returns a string UUID", () => {
    const id = createRequestId();
    expect(typeof id).toBe("string");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("returns unique values on each call", () => {
    const a = createRequestId();
    const b = createRequestId();
    expect(a).not.toBe(b);
  });
});

describe("errorJson", () => {
  it("returns a NextResponse with correct status and body", async () => {
    const res = errorJson("TEST_CODE", "test message", 418);
    expect(res.status).toBe(418);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "TEST_CODE", message: "test message" },
    });
  });

  it("includes details when provided", async () => {
    const res = errorJson("ERR", "msg", 400, { details: { field: "bad" } });
    const body = await res.json();
    expect(body.error.details).toEqual({ field: "bad" });
  });

  it("includes requestId when provided", async () => {
    const res = errorJson("ERR", "msg", 400, { requestId: "req-123" });
    const body = await res.json();
    expect(body.requestId).toBe("req-123");
  });

  it("omits details and requestId when not provided", async () => {
    const res = errorJson("ERR", "msg", 400);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "ERR", message: "msg" } });
    expect("requestId" in body).toBe(false);
    expect("details" in body.error).toBe(false);
  });
});

describe("unauthorizedError", () => {
  it("returns 401 with UNAUTHORIZED code", async () => {
    const res = unauthorizedError();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("Unauthorized");
  });

  it("includes requestId when provided", async () => {
    const res = unauthorizedError("req-abc");
    const body = await res.json();
    expect(body.requestId).toBe("req-abc");
  });
});

describe("notFoundError", () => {
  it("returns 404 with uppercased entity code", async () => {
    const res = notFoundError("job");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("JOB_NOT_FOUND");
    expect(body.error.message).toBe("job not found");
  });

  it("includes requestId when provided", async () => {
    const res = notFoundError("user", "req-xyz");
    const body = await res.json();
    expect(body.requestId).toBe("req-xyz");
  });
});

describe("validationError", () => {
  it("returns 400 with flattened zod error details", async () => {
    const zodErr = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        input: 42,
        path: ["name"],
        message: "Expected string, received number",
      },
    ]);
    const res = validationError(zodErr, "req-val");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_BODY");
    expect(body.error.message).toBe("Invalid request body");
    expect(body.error.details).toBeDefined();
    expect(body.requestId).toBe("req-val");
  });
});
