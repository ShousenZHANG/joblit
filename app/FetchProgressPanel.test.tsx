import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { FetchProgressPanel } from "./FetchProgressPanel";

vi.mock("./FetchStatusContext", () => ({
  useFetchStatus: () => ({
    runId: "run-1",
    status: "RUNNING",
    importedCount: 0,
    lanes: [],
    error: null,
    elapsedSeconds: 11,
    open: true,
    setOpen: vi.fn(),
    startRun: vi.fn(),
    cancelRun: vi.fn(),
    queryTitle: "Software Engineer",
    queryTerms: ["Software Engineer", "Frontend Engineer", "Backend Engineer"],
    smartExpand: true,
  }),
}));

afterEach(cleanup);

describe("FetchProgressPanel", () => {
  it("shows the real role queries used by smart fetch", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FetchProgressPanel />
      </NextIntlClientProvider>,
    );

    expect(screen.getAllByText(/software engineer/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/frontend engineer/i)).toBeInTheDocument();
    expect(screen.getByText(/backend engineer/i)).toBeInTheDocument();
    expect(screen.getByText(/smart fetch expanded/i)).toBeInTheDocument();
  });

  it("uses transform progress and disables motion transitions when requested", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FetchProgressPanel />
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId("fetch-progress-fill")).toHaveStyle({
      transform: "scaleX(0.42)",
    });
    expect(screen.getByTestId("fetch-progress-panel")).toHaveClass(
      "motion-reduce:transition-none",
    );
    expect(
      screen.getByRole("progressbar", { name: /fetch progress/i }),
    ).toHaveAttribute("aria-valuenow", "42");
  });
});
