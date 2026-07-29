import { describe, it, expect, afterEach, vi } from "vitest";

const REQUIRED = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  AUTH_SECRET: "x".repeat(32),
  APP_ENC_KEY: "dGVzdHRlc3R0ZXN0dGVzdA==",
  FETCH_RUN_SECRET: "fetch-secret",
  LATEX_RENDER_URL: "https://render.example.com",
  LATEX_RENDER_TOKEN: "latex-token",
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  GITHUB_ID: "ghid",
  GITHUB_SECRET: "ghsecret",
};

async function loadFresh() {
  vi.resetModules();
  return import("./env");
}

describe("validateServerEnv", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("passes with all required vars present (optional ones absent)", async () => {
    process.env = { ...original, ...REQUIRED };
    const { validateServerEnv } = await loadFresh();
    expect(() => validateServerEnv()).not.toThrow();
  });

  it("throws listing the missing required key", async () => {
    const { FETCH_RUN_SECRET: _omit, ...rest } = REQUIRED;
    process.env = { ...original, ...rest, FETCH_RUN_SECRET: "" };
    const { validateServerEnv } = await loadFresh();
    expect(() => validateServerEnv()).toThrow(/FETCH_RUN_SECRET/);
  });

  it("rejects a non-URL LATEX_RENDER_URL", async () => {
    process.env = { ...original, ...REQUIRED, LATEX_RENDER_URL: "not-a-url" };
    const { validateServerEnv } = await loadFresh();
    expect(() => validateServerEnv()).toThrow(/LATEX_RENDER_URL/);
  });

  it("rejects an unknown insecure LaTeX transport flag", async () => {
    process.env = {
      ...original,
      ...REQUIRED,
      LATEX_RENDER_ALLOW_INSECURE_HTTP: "1",
    };
    const { validateServerEnv } = await loadFresh();

    expect(() => validateServerEnv()).toThrow(
      /LATEX_RENDER_ALLOW_INSECURE_HTTP/,
    );
  });
});
