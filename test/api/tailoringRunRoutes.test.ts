import { beforeEach, describe, expect, it, vi } from "vitest";

const tailoringRuns = vi.hoisted(() => ({
  getTailoringRunStatus: vi.fn(),
  failTailoringRun: vi.fn(),
  cancelTailoringRun: vi.fn(),
}));

vi.mock("@/lib/server/tailoringRuns/tailoringRunService", () => tailoringRuns);

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { POST as cancelTailoringRun } from "@/app/api/tailoring-runs/[id]/cancel/route";
import { POST as failTailoringRun } from "@/app/api/tailoring-runs/[id]/fail/route";
import { GET as getTailoringRun } from "@/app/api/tailoring-runs/[id]/route";
import { TailoringRunError } from "@/lib/server/tailoringRuns/tailoringRunProtocol";

const RUN_ID = "550e8400-e29b-41d4-a716-446655440000";
const ATTEMPT_ID = "660e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-1";

const RUN = {
  id: RUN_ID,
  status: "RUNNING",
  source: "LOCAL_AI",
  delivery: "DRAFT",
  requiredTargetMask: 1,
  acceptedTargetMask: 0,
  applicationId: null,
  applicationBatchTaskId: null,
  handle: { id: RUN_ID, attemptId: ATTEMPT_ID },
  attempt: 1,
  leaseExpiresAt: null,
  errorCode: null,
  errorMessage: null,
  terminalAt: null,
} as const;

function statusRequest(id = RUN_ID) {
  return getTailoringRun(
    new Request(`http://localhost/api/tailoring-runs/${id}`),
    { params: Promise.resolve({ id }) },
  );
}

function failureRequest(
  body: unknown,
  id = RUN_ID,
) {
  return failTailoringRun(
    new Request(`http://localhost/api/tailoring-runs/${id}/fail`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function cancellationRequest(
  body: unknown,
  id = RUN_ID,
) {
  return cancelTailoringRun(
    new Request(`http://localhost/api/tailoring-runs/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("tailoring run status api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: USER_ID },
    });
  });

  it("returns the v1 protocol and the tenant-scoped run status", async () => {
    tailoringRuns.getTailoringRunStatus.mockResolvedValueOnce(RUN);

    const response = await statusRequest();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      protocol: "tailoring-run/v1",
      run: {
        id: RUN_ID,
        status: "RUNNING",
      },
      requestId: expect.any(String),
    });
    expect(tailoringRuns.getTailoringRunStatus).toHaveBeenCalledWith(
      USER_ID,
      RUN_ID,
    );
  });

  it("maps TailoringRunError to the canonical response status", async () => {
    tailoringRuns.getTailoringRunStatus.mockRejectedValueOnce(
      new TailoringRunError("RUN_NOT_FOUND", "Tailoring run not found"),
    );

    const response = await statusRequest();
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toMatchObject({
      error: {
        code: "RUN_NOT_FOUND",
        message: "Tailoring run not found",
      },
      requestId: expect.any(String),
    });
  });

  it("rejects an invalid run UUID before calling the service", async () => {
    const response = await statusRequest("not-a-uuid");
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_PARAMS");
    expect(tailoringRuns.getTailoringRunStatus).not.toHaveBeenCalled();
  });
});

describe("tailoring run failure api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: USER_ID },
    });
  });

  it("fences failure with the session user and execution attempt", async () => {
    tailoringRuns.failTailoringRun.mockResolvedValueOnce({
      disposition: "APPLIED",
      run: { ...RUN, status: "FAILED", errorCode: "MODEL_OUTPUT_INVALID" },
    });

    const response = await failureRequest({
      attemptId: ATTEMPT_ID,
      code: "MODEL_OUTPUT_INVALID",
      message: "The model response did not match the schema",
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      protocol: "tailoring-run/v1",
      disposition: "APPLIED",
      run: { status: "FAILED" },
      requestId: expect.any(String),
    });
    expect(tailoringRuns.failTailoringRun).toHaveBeenCalledWith({
      userId: USER_ID,
      handle: { id: RUN_ID, attemptId: ATTEMPT_ID },
      errorCode: "MODEL_OUTPUT_INVALID",
      errorMessage: "The model response did not match the schema",
      batchExecutionAttemptId: ATTEMPT_ID,
    });
  });

  it("maps stale-attempt failures to conflict", async () => {
    tailoringRuns.failTailoringRun.mockRejectedValueOnce(
      new TailoringRunError(
        "ATTEMPT_STALE",
        "The tailoring attempt has been superseded",
      ),
    );

    const response = await failureRequest({
      attemptId: ATTEMPT_ID,
      code: "MODEL_FAILED",
    });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toMatchObject({
      error: {
        code: "ATTEMPT_STALE",
        message: "The tailoring attempt has been superseded",
      },
      requestId: expect.any(String),
    });
  });

  it("rejects an invalid fencing attempt in the request body", async () => {
    const response = await failureRequest({
      attemptId: "not-a-uuid",
      code: "MODEL_FAILED",
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_BODY");
    expect(tailoringRuns.failTailoringRun).not.toHaveBeenCalled();
  });
});

describe("tailoring run cancellation api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      user: { id: USER_ID },
    });
  });

  it("fences cancellation with the session user and execution attempt", async () => {
    tailoringRuns.cancelTailoringRun.mockResolvedValueOnce({
      disposition: "APPLIED",
      run: { ...RUN, status: "CANCELLED" },
    });

    const response = await cancellationRequest({ attemptId: ATTEMPT_ID });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      protocol: "tailoring-run/v1",
      disposition: "APPLIED",
      run: { status: "CANCELLED" },
      requestId: expect.any(String),
    });
    expect(tailoringRuns.cancelTailoringRun).toHaveBeenCalledWith({
      userId: USER_ID,
      handle: { id: RUN_ID, attemptId: ATTEMPT_ID },
    });
  });

  it("maps terminal-run cancellation to conflict", async () => {
    tailoringRuns.cancelTailoringRun.mockRejectedValueOnce(
      new TailoringRunError(
        "RUN_ALREADY_TERMINAL",
        "The tailoring run is already terminal",
      ),
    );

    const response = await cancellationRequest({ attemptId: ATTEMPT_ID });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toMatchObject({
      error: {
        code: "RUN_ALREADY_TERMINAL",
        message: "The tailoring run is already terminal",
      },
      requestId: expect.any(String),
    });
  });

  it("rejects an invalid request body before calling the service", async () => {
    const response = await cancellationRequest({
      attemptId: ATTEMPT_ID,
      unexpected: true,
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_BODY");
    expect(tailoringRuns.cancelTailoringRun).not.toHaveBeenCalled();
  });
});
