import { afterEach, describe, expect, it, vi } from "vitest";
import { createHermesApi } from "./hermesApi";

const config = {
  baseUrl: "http://127.0.0.1:8642",
  apiKey: "0123456789abcdef0123456789abcdef",
  profileName: "joblit-0123456789abcdef",
};

afterEach(() => vi.unstubAllGlobals());

describe("Hermes fixed-route client", () => {
  it("starts one stock run with fixed headers and redirect policy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ run_id: "run_0123456789abcdef0123456789abcdef", status: "started" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createHermesApi(config).startRun({ input: "input", instructions: "rules", session_id: "joblit:test" }),
    ).resolves.toEqual({ runId: "run_0123456789abcdef0123456789abcdef" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8642/v1/runs",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({ Authorization: `Bearer ${config.apiKey}` }),
      }),
    );
  });

  it("normalizes poll responses and rejects unknown statuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          object: "hermes.run",
          run_id: "run_0123456789abcdef0123456789abcdef",
          status: "completed",
          output: "{\"summary\":\"complete output\"}",
        }), { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    await expect(createHermesApi(config).getRun("run_0123456789abcdef0123456789abcdef"))
      .resolves.toMatchObject({ status: "completed", runId: "run_0123456789abcdef0123456789abcdef" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ object: "hermes.run", run_id: "run_0123456789abcdef0123456789abcdef", status: "mystery" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(createHermesApi(config).getRun("run_0123456789abcdef0123456789abcdef"))
      .rejects.toMatchObject({ code: "HERMES_PROTOCOL_ERROR" });
  });

  it("maps auth and not-found errors without leaking response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret", { status: 401 })));
    await expect(createHermesApi(config).probe()).rejects.toMatchObject({ code: "HERMES_AUTH_FAILED" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(createHermesApi(config).getRun("run_0123456789abcdef0123456789abcdef"))
      .rejects.toMatchObject({ code: "HERMES_RUN_NOT_FOUND" });
  });

  it("checks health, capabilities, model identity, and zero advertised tools", async () => {
    const responses = [
      { status: "ok" },
      {
        object: "hermes.api_server.capabilities",
        platform: "hermes-agent",
        model: config.profileName,
        auth: { type: "bearer", required: true },
        features: { run_submission: true, run_status: true, run_stop: true },
        endpoints: {
          runs: { method: "POST", path: "/v1/runs" },
          run_status: { method: "GET", path: "/v1/runs/{run_id}" },
          run_stop: { method: "POST", path: "/v1/runs/{run_id}/stop" },
          toolsets: { method: "GET", path: "/v1/toolsets" },
          models: { method: "GET", path: "/v1/models" },
          health: { method: "GET", path: "/health" },
        },
      },
      { object: "list", data: [{ id: config.profileName, object: "model" }] },
      {
        object: "list",
        platform: "api_server",
        data: [{ name: "core", enabled: true, configured: true, tools: [] }],
      },
      {
        status: "ok",
        gateway_state: "running",
        readiness: { checks: { model: { status: "ok" } } },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const body = responses.shift();
        if (body === undefined) {
          // Empty-run safety probe: the server must reject {} with 400.
          return Promise.resolve(new Response(JSON.stringify({ error: "bad_request" }), { status: 400, headers: { "content-type": "application/json" } }));
        }
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
      }),
    );

    await expect(createHermesApi(config).probe()).resolves.toEqual({ modelId: config.profileName, profileName: config.profileName, tools: [] });
  });

  it("fails the probe when the gateway is not running", async () => {
    const responses = [
      { status: "ok" },
      {
        object: "hermes.api_server.capabilities",
        platform: "hermes-agent",
        model: config.profileName,
        auth: { type: "bearer", required: true },
        features: { run_submission: true, run_status: true, run_stop: true },
        endpoints: {
          runs: { method: "POST", path: "/v1/runs" },
          run_status: { method: "GET", path: "/v1/runs/{run_id}" },
          run_stop: { method: "POST", path: "/v1/runs/{run_id}/stop" },
          toolsets: { method: "GET", path: "/v1/toolsets" },
          models: { method: "GET", path: "/v1/models" },
          health: { method: "GET", path: "/health" },
        },
      },
      { object: "list", data: [{ id: config.profileName, object: "model" }] },
      {
        object: "list",
        platform: "api_server",
        data: [{ name: "core", enabled: true, configured: true, tools: [] }],
      },
      // Stopped gateway: runs would be accepted but never dispatched.
      { status: "ok", gateway_state: "stopped", readiness: { checks: { model: { status: "ok" } } } },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const body = responses.shift() ?? { error: "unexpected extra request" };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
      }),
    );

    await expect(createHermesApi(config).probe()).rejects.toMatchObject({ code: "HERMES_UNREACHABLE" });
  });

  it("returns the assistant text from a session chat and rejects malformed replies", async () => {
    const sessionId = "joblit:550e8400-e29b-41d4-a716-446655440000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ role: "assistant", content: "{\"fixed\":true}" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(createHermesApi(config).sessionChat(sessionId, "fix the schema"))
      .resolves.toBe("{\"fixed\":true}");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ role: "user", content: "echo" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(createHermesApi(config).sessionChat(sessionId, "fix the schema"))
      .rejects.toMatchObject({ code: "HERMES_PROTOCOL_ERROR" });

    await expect(createHermesApi(config).sessionChat("joblit:not-a-uuid", "fix"))
      .rejects.toMatchObject({ code: "HERMES_PROTOCOL_ERROR" });
  });

  it("rejects a capabilities document that redirects a required fixed route", async () => {
    const responses = [
      { status: "ok" },
      {
        object: "hermes.api_server.capabilities",
        platform: "hermes-agent",
        model: config.profileName,
        auth: { type: "bearer", required: true },
        features: { run_submission: true, run_status: true, run_stop: true },
        endpoints: {
          runs: { method: "POST", path: "/unsafe/runs" },
          run_status: { method: "GET", path: "/v1/runs/{run_id}" },
          run_stop: { method: "POST", path: "/v1/runs/{run_id}/stop" },
          toolsets: { method: "GET", path: "/v1/toolsets" },
          models: { method: "GET", path: "/v1/models" },
          health: { method: "GET", path: "/health" },
        },
      },
      { object: "list", data: [{ id: config.profileName, object: "model" }] },
      { object: "list", platform: "api_server", data: [] },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))),
    );

    await expect(createHermesApi(config).probe()).rejects.toMatchObject({ code: "HERMES_INCOMPATIBLE" });
  });
});
