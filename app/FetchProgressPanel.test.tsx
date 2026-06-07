import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    elapsedSeconds: 12,
    open: true,
    setOpen: vi.fn(),
    startRun: vi.fn(),
    cancelRun: vi.fn(),
    queryTitle: "Software Engineer",
    queryTerms: ["Software Engineer", "Frontend Engineer", "Backend Engineer"],
    smartExpand: true,
  }),
}));

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
});
