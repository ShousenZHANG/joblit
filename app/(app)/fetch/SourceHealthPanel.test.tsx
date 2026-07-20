import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { SourceHealthPanel } from "./SourceHealthPanel";

describe("SourceHealthPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("stays dormant until global sources are enabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SourceHealthPanel enabled={false} />
      </NextIntlClientProvider>,
    );

    expect(screen.queryByTestId("source-health-panel")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a safe source summary without exposing configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              generatedAt: "2026-07-20T00:00:00.000Z",
              sources: [
                {
                  sourceId: "remoteok",
                  kind: "core",
                  label: "Remote OK",
                  provider: "remoteok",
                  region: null,
                  status: "HEALTHY",
                  consecutiveFailures: 0,
                  lastCheckedAt: "2026-07-20T00:00:00.000Z",
                },
                {
                  sourceId: "ats:greenhouse:acme",
                  kind: "ats",
                  label: "Acme",
                  provider: "greenhouse",
                  region: null,
                  status: "DEGRADED",
                  consecutiveFailures: 1,
                  lastCheckedAt: "2026-07-20T00:00:00.000Z",
                },
              ],
              summary: { healthy: 1, degraded: 1, down: 0, unknown: 0 },
              configurationIssueCount: 0,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SourceHealthPanel enabled />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("1 source needs attention")).toBeInTheDocument();
    });
    expect(screen.getByText("Source health")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("boardToken");
    expect(document.body.textContent).not.toContain("careersUrl");
  });
});
