import { describe, expect, it } from "vitest";

import { resolveRuntimeCapabilities } from "./index";

describe("resolveRuntimeCapabilities", () => {
  it("fails closed when the distributed extension budget pair is incomplete", () => {
    const capabilities = resolveRuntimeCapabilities({
      UPSTASH_REDIS_REST_URL: "https://redis.example.com",
    });

    expect(capabilities.extensionIngress.distributedAbuseBudget).toEqual({
      kind: "invalid",
      reason: "EXTENSION_ABUSE_BUDGET_CONFIG_INCOMPLETE",
      missing: ["UPSTASH_REDIS_REST_TOKEN"],
    });
  });

  it("requires the auth secret for extension identity fingerprints", () => {
    const missing = resolveRuntimeCapabilities({});
    const configured = resolveRuntimeCapabilities({
      AUTH_SECRET: "  extension-fingerprint-secret  ",
    });

    expect(missing.extensionIngress.identityFingerprint).toEqual({
      kind: "invalid",
      reason: "EXTENSION_IDENTITY_SECRET_MISSING",
      missing: ["AUTH_SECRET"],
    });
    expect(configured.extensionIngress.identityFingerprint).toEqual({
      kind: "enabled",
      config: { secret: "extension-fingerprint-secret" },
    });
  });

  it("keeps server batch autogeneration off unless the flag is explicit", () => {
    expect(resolveRuntimeCapabilities({}).batchAutogeneration).toEqual({
      kind: "disabled",
      reason: "BATCH_AUTOGENERATION_DISABLED",
    });
    expect(
      resolveRuntimeCapabilities({
        ENABLE_BATCH_EXECUTE_AUTOGEN: "1",
      }).batchAutogeneration,
    ).toEqual({
      kind: "enabled",
      config: {},
    });
    expect(
      resolveRuntimeCapabilities({
        ENABLE_BATCH_EXECUTE_AUTOGEN: "sometimes",
      }).batchAutogeneration,
    ).toEqual({
      kind: "invalid",
      reason: "BATCH_AUTOGENERATION_FLAG_INVALID",
      invalid: ["ENABLE_BATCH_EXECUTE_AUTOGEN"],
    });
  });

  it("refuses to enable artifact reconciliation without an auth secret", () => {
    const capabilities = resolveRuntimeCapabilities({
      ARTIFACT_RECONCILE_ENABLED: "true",
    });

    expect(capabilities.artifactReconciliation).toEqual({
      kind: "invalid",
      reason: "ARTIFACT_RECONCILE_AUTH_MISSING",
      missingAnyOf: [["CRON_SECRET", "ARTIFACT_RECONCILE_SECRET"]],
    });
    expect(
      capabilities.artifactReconciliationAuthentication,
    ).toEqual({
      kind: "invalid",
      reason: "ARTIFACT_RECONCILE_AUTH_MISSING",
      missingAnyOf: [["CRON_SECRET", "ARTIFACT_RECONCILE_SECRET"]],
    });
  });

  it("exposes artifact secrets only through enabled authentication", () => {
    const capabilities = resolveRuntimeCapabilities({
      ARTIFACT_RECONCILE_ENABLED: "true",
      CRON_SECRET: "  shared-secret  ",
      ARTIFACT_RECONCILE_SECRET: "shared-secret",
    });

    expect(capabilities.artifactReconciliation).toEqual({
      kind: "enabled",
      config: {},
    });
    expect(
      capabilities.artifactReconciliationAuthentication,
    ).toEqual({
      kind: "enabled",
      config: { secrets: ["shared-secret"] },
    });
  });

  it("keeps disabled artifact reconciliation free of credentials", () => {
    const capabilities = resolveRuntimeCapabilities({
      CRON_SECRET: "cron-secret",
    });

    expect(capabilities.artifactReconciliation).toEqual({
      kind: "disabled",
      reason: "ARTIFACT_RECONCILE_DISABLED",
    });
    expect(
      capabilities.artifactReconciliationAuthentication,
    ).toEqual({
      kind: "enabled",
      config: { secrets: ["cron-secret"] },
    });
  });

  it("keeps invalid artifact feature flags free of credentials", () => {
    const capabilities = resolveRuntimeCapabilities({
      ARTIFACT_RECONCILE_ENABLED: "sometimes",
      ARTIFACT_RECONCILE_SECRET: "artifact-secret",
    });

    expect(capabilities.artifactReconciliation).toEqual({
      kind: "invalid",
      reason: "ARTIFACT_RECONCILE_FLAG_INVALID",
      invalid: ["ARTIFACT_RECONCILE_ENABLED"],
    });
    expect(
      capabilities.artifactReconciliationAuthentication,
    ).toEqual({
      kind: "enabled",
      config: { secrets: ["artifact-secret"] },
    });
  });

  it("reports incomplete GitHub FetchRun dispatch as invalid", () => {
    const capabilities = resolveRuntimeCapabilities({
      GITHUB_OWNER: "joblit-owner",
      GITHUB_REPO: "joblit-repo",
    });

    expect(capabilities.githubFetchRunDispatch).toEqual({
      kind: "invalid",
      reason: "GITHUB_DISPATCH_CONFIG_INCOMPLETE",
      missing: ["GITHUB_TOKEN"],
    });
  });

  it("exposes FetchRun authentication only when its secret is configured", () => {
    expect(resolveRuntimeCapabilities({}).fetchRunAuthentication).toEqual({
      kind: "invalid",
      reason: "FETCH_RUN_SECRET_MISSING",
      missing: ["FETCH_RUN_SECRET"],
    });
    expect(
      resolveRuntimeCapabilities({
        FETCH_RUN_SECRET: "  fetch-worker-secret  ",
      }).fetchRunAuthentication,
    ).toEqual({
      kind: "enabled",
      config: { secret: "fetch-worker-secret" },
    });
  });

  it("turns malformed ATS board JSON into an observable invalid capability", () => {
    const capability = resolveRuntimeCapabilities({
      JOBLIT_ATS_BOARDS_JSON: "{",
    }).atsBoards;

    expect(capability).toMatchObject({
      kind: "invalid",
      reason: "ATS_BOARD_CONFIG_INVALID",
    });
    expect(capability.boards).toEqual([]);
    expect(capability.issues).toEqual([
      expect.objectContaining({ code: "invalid_json" }),
    ]);
  });

  it("reports Blob storage availability without exposing an implicit fallback", () => {
    expect(resolveRuntimeCapabilities({}).blobStorage).toEqual({
      kind: "disabled",
      reason: "BLOB_STORAGE_NOT_CONFIGURED",
    });
    expect(
      resolveRuntimeCapabilities({
        BLOB_READ_WRITE_TOKEN: "  blob-token  ",
      }).blobStorage,
    ).toEqual({
      kind: "enabled",
      config: { token: "blob-token" },
    });
  });

  it("fails closed when the LaTeX renderer pair is incomplete", () => {
    const capability = resolveRuntimeCapabilities({
      LATEX_RENDER_URL: "https://render.example.com",
    }).latexRenderer;

    expect(capability).toEqual({
      kind: "invalid",
      reason: "LATEX_RENDER_CONFIG_INCOMPLETE",
      missing: ["LATEX_RENDER_TOKEN"],
    });
  });

  it("rejects an unknown LaTeX insecure-transport flag", () => {
    const capability = resolveRuntimeCapabilities({
      LATEX_RENDER_URL: "https://render.example.com",
      LATEX_RENDER_TOKEN: "render-token",
      LATEX_RENDER_ALLOW_INSECURE_HTTP: "sometimes",
    }).latexRenderer;

    expect(capability).toEqual({
      kind: "invalid",
      reason: "LATEX_RENDER_INSECURE_HTTP_FLAG_INVALID",
      invalid: ["LATEX_RENDER_ALLOW_INSECURE_HTTP"],
    });
  });

  it("makes Gemini an explicit optional capability with a safe model default", () => {
    expect(resolveRuntimeCapabilities({}).gemini).toEqual({
      kind: "disabled",
      reason: "GEMINI_NOT_CONFIGURED",
    });
    expect(
      resolveRuntimeCapabilities({
        GEMINI_API_KEY: "gemini-key",
      }).gemini,
    ).toEqual({
      kind: "enabled",
      config: {
        apiKey: "gemini-key",
        model: "gemini-2.5-flash-lite",
      },
    });
  });
});
