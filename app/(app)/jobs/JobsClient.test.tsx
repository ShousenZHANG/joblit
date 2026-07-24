import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { JobsClient } from "./JobsClient";
import { sessionDeletedJobIds } from "./hooks/useJobMutations";
import { resetToasts } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/toaster";
import messages from "../../../messages/en.json";

const fetchStatusMock = vi.hoisted(() => ({
  state: { runId: null as string | null, status: null as string | null, importedCount: 0 },
}));

const navigationMock = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
}));

const localAiBridgeMock = vi.hoisted(() => ({
  detect: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/app/FetchStatusContext", () => ({
  useFetchStatus: () => fetchStatusMock.state,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: navigationMock.replace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/jobs",
  useSearchParams: () => new URLSearchParams(navigationMock.search),
}));

vi.mock("@/lib/client/localAiBridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/client/localAiBridge")>(
    "@/lib/client/localAiBridge",
  );
  return {
    ...actual,
    detectLocalAiAvailability: localAiBridgeMock.detect,
    sendLocalAiBridgeRequest: localAiBridgeMock.send,
  };
});

afterEach(() => {
  cleanup();
});

const baseJob = {
  id: "11111111-1111-1111-1111-111111111111",
  jobUrl: "https://example.com/job/1",
  title: "Frontend Engineer",
  company: "Acme",
  location: "Remote",
  jobType: "Full-time",
  jobLevel: "Mid",
  status: "NEW" as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>
        {ui}
        <Toaster />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  // The session-tombstone set is module-level by design (it must survive
  // JobsClient remounts) — tests share the module instance, so isolate here.
  sessionDeletedJobIds.clear();
  // The toast store is module-level too — clear leftover toasts (e.g. undo
  // toasts from prior delete tests) so each case starts with a clean viewport.
  resetToasts();
  fetchStatusMock.state = { runId: null, status: null, importedCount: 0 };
  navigationMock.search = "";
  navigationMock.replace.mockReset();
  localAiBridgeMock.detect.mockReset();
  localAiBridgeMock.detect.mockResolvedValue("not_configured");
  localAiBridgeMock.send.mockReset();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  if (!HTMLElement.prototype.hasPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => false,
    });
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: () => {},
    });
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: () => {},
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    });
  }
  const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("/api/application-batches/latest")) {
      return new Response(JSON.stringify({ batchId: null, status: null, updatedAt: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.startsWith("/api/jobs/suggestions")) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.startsWith("/api/jobs?limit=50")) {
      return new Response(
        JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.startsWith("/api/jobs?")) {
      return new Response(
        JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.startsWith("/api/jobs/") && init?.method === "DELETE") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
      return new Response(
        JSON.stringify({ id: baseJob.id, description: "Job description" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
  });

  vi.stubGlobal("fetch", mockFetch);
});

describe("JobsClient", () => {
  it("exposes ScrollArea component", () => {
    expect(ScrollArea).toBeDefined();
  });

  it("renders initial jobs", async () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    expect((await screen.findAllByText("Frontend Engineer")).length).toBeGreaterThan(0);
  });

  it("keeps jobs visible (no false empty) when switching status views", async () => {
    // Regression: switching status views used to flash / stick on "No jobs
    // found" because the per-cursor useQueries placeholder broke on filter
    // change. With useInfiniteQuery + keepPreviousData the previous rows must
    // stay until the new view resolves, and the empty state must never appear
    // while rows exist. (No "All" view exists — only NEW/APPLIED/REJECTED.)
    const user = userEvent.setup();
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);
    expect((await screen.findAllByText("Frontend Engineer")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("radio", { name: messages.jobs.statusApplied }));
    await waitFor(() => {
      expect(screen.queryByText(messages.jobs.noJobs)).not.toBeInTheDocument();
      expect(screen.getAllByText("Frontend Engineer").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("radio", { name: messages.jobs.statusNew }));
    await waitFor(() => {
      expect(screen.queryByText(messages.jobs.noJobs)).not.toBeInTheDocument();
      expect(screen.getAllByText("Frontend Engineer").length).toBeGreaterThan(0);
    });
  });

  it("does not render fit snapshot UI and never requests fit-analysis", async () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);
    await screen.findAllByText("Frontend Engineer");

    expect(screen.queryByText("AI Fit Snapshot")).not.toBeInTheDocument();

    const calls = (global.fetch as unknown as { mock: { calls: Array<[RequestInfo, RequestInit | undefined]> } }).mock
      .calls;
    const fitCalls = calls.filter(([request]) => {
      const url = typeof request === "string" ? request : request.url;
      return url.includes("/fit-analysis");
    });
    expect(fitCalls).toHaveLength(0);
  });

  it("renders the filter toolbar with a keyword search input", () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const toolbar = screen.getAllByTestId("jobs-toolbar")[0];
    expect(toolbar).toBeInTheDocument();
    // Toolbar must expose at least the keyword search input for filtering.
    expect(within(toolbar).getAllByRole("textbox").length).toBeGreaterThan(0);
  });

  it("restores filters from the URL and debounces canonical URL updates", async () => {
    const user = userEvent.setup();
    navigationMock.search =
      "utm=campaign&q=react&status=APPLIED&location=Victoria%2C+Australia&level=Mid";

    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const search = screen.getAllByRole("textbox")[0];
    expect(search).toHaveValue("react");
    expect(screen.getByTestId("jobs-location-filter")).toHaveTextContent("Victoria");
    expect(screen.getByTestId("jobs-level-filter")).toHaveTextContent("Mid");
    expect(
      screen.getByRole("radio", { name: messages.jobs.statusApplied }),
    ).toHaveAttribute("aria-checked", "true");
    expect(navigationMock.replace).not.toHaveBeenCalled();

    await user.clear(search);

    await waitFor(() => {
      expect(navigationMock.replace).toHaveBeenLastCalledWith(
        "/jobs?utm=campaign&status=APPLIED&location=Victoria%2C+Australia&level=Mid",
        { scroll: false },
      );
    });
  });

  it("restores a selected row and mobile detail view from the URL", async () => {
    const secondJob = {
      ...baseJob,
      id: "22222222-2222-2222-2222-222222222222",
      title: "Backend Engineer",
    };
    navigationMock.search = `utm=campaign&job=${secondJob.id}&view=detail`;

    renderWithClient(
      <JobsClient initialItems={[baseJob, secondJob]} initialCursor={null} />,
    );

    const results = screen.getAllByTestId("jobs-results-scroll")[0];
    await waitFor(() => {
      expect(
        within(results).getByRole("button", { name: /Backend Engineer/i }),
      ).toHaveAttribute("aria-current", "true");
    });
    expect(screen.getByRole("tab", { name: messages.jobs.tabDetail })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(screen.getByTestId("jobs-details-panel")).getByRole("heading", {
        name: "Backend Engineer",
      }),
    ).toBeInTheDocument();
    expect(navigationMock.replace).not.toHaveBeenCalled();
  });

  it("falls back to the first visible job for a malformed selected id", async () => {
    navigationMock.search = "job=does-not-exist&view=detail";

    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    expect(
      await within(screen.getByTestId("jobs-details-panel")).findByRole("heading", {
        name: "Frontend Engineer",
      }),
    ).toBeInTheDocument();
  });

  it("selects a row without navigating the route", async () => {
    // `/jobs` is force-dynamic, so any router.replace re-runs the server
    // component. That re-seeds a SINGLE page of rows and re-hydrates it over
    // the infinite query, throwing away every page the user scrolled in — the
    // list snaps back to ten rows and the scroll position jumps. Row selection
    // is workspace-only state, so it must go through the shallow history
    // write, never a route navigation.
    const user = userEvent.setup();
    const secondJob = {
      ...baseJob,
      id: "22222222-2222-2222-2222-222222222222",
      title: "Backend Engineer",
    };
    navigationMock.search = "utm=campaign";
    window.history.replaceState(window.history.state, "", "/jobs?utm=campaign");

    renderWithClient(
      <JobsClient initialItems={[baseJob, secondJob]} initialCursor={null} />,
    );
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    const results = screen.getAllByTestId("jobs-results-scroll")[0];
    await user.click(
      within(results).getByRole("button", { name: /Backend Engineer/i }),
    );

    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      `/jobs?utm=campaign&job=${secondJob.id}`,
    );
    await waitFor(() => {
      expect(
        within(results).getByRole("button", { name: /Backend Engineer/i }),
      ).toHaveAttribute("aria-current", "true");
    });
  });

  it("writes mobile row selection and view without losing unrelated params", async () => {
    const user = userEvent.setup();
    const secondJob = {
      ...baseJob,
      id: "22222222-2222-2222-2222-222222222222",
      title: "Backend Engineer",
    };
    navigationMock.search = "utm=campaign";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 480 });

    renderWithClient(
      <JobsClient initialItems={[baseJob, secondJob]} initialCursor={null} />,
    );
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    const results = screen.getAllByTestId("jobs-results-scroll")[0];
    await user.click(
      within(results).getByRole("button", { name: /Backend Engineer/i }),
    );

    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      `/jobs?utm=campaign&job=${secondJob.id}&view=detail`,
    );
    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: messages.jobs.tabDetail })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("merges an immediate selection with a pending debounced query", async () => {
    const secondJob = {
      ...baseJob,
      id: "22222222-2222-2222-2222-222222222222",
      title: "Backend Engineer",
    };
    navigationMock.search = "utm=campaign";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 480 });
    vi.useFakeTimers();

    try {
      renderWithClient(
        <JobsClient initialItems={[baseJob, secondJob]} initialCursor={null} />,
      );
      const replaceStateSpy = vi.spyOn(window.history, "replaceState");
      fireEvent.change(screen.getAllByRole("textbox")[0], {
        target: { value: "platform" },
      });
      const results = screen.getAllByTestId("jobs-results-scroll")[0];
      fireEvent.click(
        within(results).getByRole("button", { name: /Backend Engineer/i }),
      );

      // The selection lands immediately, but only in the address bar.
      expect(replaceStateSpy).toHaveBeenCalledWith(
        window.history.state,
        "",
        `/jobs?utm=campaign&job=${secondJob.id}&view=detail`,
      );
      expect(navigationMock.replace).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      // The debounced filter sync is a real navigation (the query has to be
      // re-run), and it must carry the shallow-written selection with it —
      // Next never published that write back through useSearchParams.
      expect(navigationMock.replace.mock.calls).toEqual([
        [
          `/jobs?utm=campaign&job=${secondJob.id}&view=detail&q=platform`,
          { scroll: false },
        ],
      ]);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("links mobile tabs to panels and supports automatic arrow activation", async () => {
    const user = userEvent.setup();
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const listTab = screen.getByRole("tab", { name: /Jobs/ });
    const detailTab = screen.getByRole("tab", { name: messages.jobs.tabDetail });
    const listPanel = screen.getByTestId("jobs-results-panel");
    const detailPanel = screen.getByTestId("jobs-details-panel");

    expect(listTab).toHaveAttribute("aria-controls", listPanel.id);
    expect(detailTab).toHaveAttribute("aria-controls", detailPanel.id);
    expect(listPanel).toHaveAttribute("role", "tabpanel");
    expect(detailPanel).toHaveAttribute("role", "tabpanel");

    listTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(detailTab).toHaveFocus();
    expect(detailTab).toHaveAttribute("aria-selected", "true");
    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/jobs?view=detail",
    );
    expect(navigationMock.replace).not.toHaveBeenCalled();
  });

  it("restores URL state after browser history navigation without rewriting it", async () => {
    const secondJob = {
      ...baseJob,
      id: "22222222-2222-2222-2222-222222222222",
      title: "Backend Engineer",
    };
    navigationMock.search = "q=react&job=does-not-exist";
    const view = renderWithClient(
      <JobsClient initialItems={[baseJob, secondJob]} initialCursor={null} />,
    );
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("react");

    navigationMock.search = `q=backend&status=APPLIED&job=${secondJob.id}&view=detail`;
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <JobsClient initialItems={[baseJob, secondJob]} initialCursor={null} />
          <Toaster />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("textbox")[0]).toHaveValue("backend");
      expect(screen.getByRole("tab", { name: messages.jobs.tabDetail })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(
        within(screen.getByTestId("jobs-details-panel")).getByRole("heading", {
          name: "Backend Engineer",
        }),
      ).toBeInTheDocument();
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(navigationMock.replace).not.toHaveBeenCalled();
  });

  it("keeps desktop location and level filters inside bounded grid tracks", () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const filterRow = screen.getByTestId("jobs-desktop-filter-row");
    const locationFilter = screen.getByTestId("jobs-location-filter");
    const levelFilter = screen.getByTestId("jobs-level-filter");

    expect(filterRow.className).toContain(
      "grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_4.75rem]",
    );
    for (const trigger of [locationFilter, levelFilter]) {
      expect(trigger).toHaveClass("w-full", "min-w-0", "overflow-hidden");
      expect(trigger.className).toContain("[&_[data-slot=select-value]]:truncate");
    }
  });

  it("hides setup and batch progress controls on jobs toolbar", async () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);
    await screen.findAllByText("Frontend Engineer");
    expect(screen.queryByRole("button", { name: /batch progress/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /setup/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create batch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run auto/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run once/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry failed/i })).not.toBeInTheDocument();
  });

  it("renders scroll areas for results and details", () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    expect(screen.getAllByTestId("jobs-results-scroll")[0]).toBeInTheDocument();
    expect(screen.getAllByTestId("jobs-details-scroll")[0]).toBeInTheDocument();
  });

  it("uses flexible mobile panel sizing instead of a brittle fixed viewport subtraction", () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const resultsPanel = screen.getAllByTestId("jobs-results-panel")[0];
    const detailsPanel = screen.getAllByTestId("jobs-details-panel")[0];

    for (const panel of [resultsPanel, detailsPanel]) {
      expect(panel).not.toHaveClass("h-[calc(100dvh-240px)]");
      expect(panel.className).toContain("min-h-[clamp(18rem,calc(100dvh-16rem),32rem)]");
      expect(panel.className).toContain("max-h-[calc(100dvh-12rem)]");
    }
  });

  it("leaves page-enter animation to RouteTransition (no double entrance)", () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    // The shell must NOT carry its own entrance animation — stacking a 600ms
    // drift on top of the route-level fade made the page "settle twice".
    const shell = screen.getAllByTestId("jobs-shell")[0];
    expect(shell).not.toHaveClass("edu-page-enter");
  });

  it("renders results without forcing virtualized mode", () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    expect(resultsPane).toHaveAttribute("data-virtual", "false");
  });

  it("marks job items with performance-friendly list rendering", async () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const jobButton = (await screen.findAllByRole("button", { name: /Frontend Engineer/i }))[0];
    expect(jobButton).toHaveAttribute("data-perf", "cv-auto");
  });

  it("shows a light loading overlay while keeping previous results", async () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    expect(resultsPane).toHaveAttribute("data-loading", "false");
  });

  it("does not force no-store cache for jobs requests", async () => {
    const user = userEvent.setup();
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const toolbar = screen.getAllByTestId("jobs-toolbar")[0];
    const input = within(toolbar).getAllByPlaceholderText("e.g. software engineer")[0];
    await user.clear(input);
    await user.type(input, "designer");

    // Poll for the debounced request instead of sleeping past the debounce.
    // A fixed delay races the debounce on a loaded machine and fails here
    // intermittently; waitFor retries until the call actually lands.
    const findJobsCall = () =>
      (
        global.fetch as unknown as {
          mock: { calls: Array<[RequestInfo, RequestInit | undefined]> };
        }
      ).mock.calls.find(
        ([request]) =>
          typeof request === "string" &&
          request.startsWith("/api/jobs?") &&
          request.includes("q=designer"),
      );

    await waitFor(() => {
      expect(findJobsCall()).toBeTruthy();
    });

    expect(findJobsCall()?.[1]?.cache).not.toBe("no-store");
  });

  it("does not make a separate job-levels fetch request", async () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    await screen.findAllByText("Frontend Engineer");

    const extraLevelsCalls = (
      global.fetch as unknown as { mock: { calls: Array<[RequestInfo]> } }
    ).mock.calls.filter(
      ([input]) => typeof input === "string" && input.startsWith("/api/jobs?limit=50"),
    );
    expect(extraLevelsCalls).toHaveLength(0);
  });

  it("updates keyword input as the user types", async () => {
    const user = userEvent.setup();
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const toolbar = screen.getAllByTestId("jobs-toolbar")[0];
    const input = within(toolbar).getAllByPlaceholderText("e.g. software engineer")[0];
    await user.clear(input);
    await user.type(input, "designer");

    expect(input).toHaveValue("designer");
  });

  it("removes a job after delete confirmation", async () => {
    const user = userEvent.setup();

     // Model server state so optimistic update + refetch can't reintroduce deleted items.
    let deleted = false;
    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?limit=50")) {
        return new Response(
          JSON.stringify({ items: deleted ? [] : [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: deleted ? [] : [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs/") && init?.method === "DELETE") {
        deleted = true;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: "Job description" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const removeButton = (await screen.findAllByTestId("job-remove-button"))[0];
    await user.click(removeButton);

    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Frontend Engineer/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("forces SSR initial items into an existing fresh React Query cache entry", async () => {
    const oldJob = { ...baseJob, id: "22222222-2222-2222-2222-222222222222", title: "Old cached job" };
    const newJob = { ...baseJob, id: "33333333-3333-3333-3333-333333333333", title: "New SSR job" };

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    client.setQueryData(["jobs", "limit=10&sort=newest", null], {
      items: [oldJob],
      nextCursor: null,
      facets: { jobLevels: ["Mid"] },
    });

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={client}>
          <JobsClient initialItems={[newJob]} initialCursor={null} />
          <Toaster />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("New SSR job").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Old cached job")).not.toBeInTheDocument();
  });

  it("keeps infinite scrolling and resets to the first loaded page when a fetch run finishes", async () => {
    const page1Job = { ...baseJob };
    const page2Job = { ...baseJob, id: "44444444-4444-4444-4444-444444444444", title: "Page 2 job" };

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?")) {
        const u = new URL(url, "https://example.test");
        const cursor = u.searchParams.get("cursor");
        if (cursor) {
          return new Response(
            JSON.stringify({ items: [page2Job], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ items: [page1Job], nextCursor: "55555555-5555-5555-5555-555555555555", facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: "Job description" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    fetchStatusMock.state = { runId: "run-1", status: "RUNNING", importedCount: 0 };
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const wrap = (ui: React.ReactElement) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={client}>
          {ui}
          <Toaster />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
    const { rerender } = render(
      wrap(<JobsClient initialItems={[page1Job]} initialCursor={"55555555-5555-5555-5555-555555555555"} />),
    );

    await waitFor(() => {
      expect(screen.getAllByText("Frontend Engineer").length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Page 2 job").length).toBeGreaterThan(0);
    });

    fetchStatusMock.state = { runId: "run-1", status: "SUCCEEDED", importedCount: 3 };
    rerender(
      wrap(<JobsClient initialItems={[page1Job]} initialCursor={"55555555-5555-5555-5555-555555555555"} />),
    );

    await waitFor(() => {
      expect(screen.getAllByText("Frontend Engineer").length).toBeGreaterThan(0);
      expect(screen.queryByText("Page 2 job")).not.toBeInTheDocument();
    });

    const calls = (global.fetch as unknown as { mock: { calls: Array<[RequestInfo, RequestInit | undefined]> } }).mock.calls;
    const listCalls = calls
      .map(([req]) => (typeof req === "string" ? req : req.url))
      .filter((u) => u.startsWith("/api/jobs?"));

    expect(listCalls.some((u) => u.includes("cursor="))).toBe(true);
    expect(listCalls.some((u) => !u.includes("cursor="))).toBe(true);
  });

  it("renders markdown with SaaS-style headings and lists", async () => {
    const markdown = "## Requirements\n\n- Ownership\n\n> Note";
    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?limit=50")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (
        url.startsWith("/api/jobs/") &&
        (!init || !init.method || init.method === "GET")
      ) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: markdown }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });

    vi.stubGlobal("fetch", mockFetch);
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    await waitFor(() => {
      expect(screen.getAllByText("Job Description").length).toBeGreaterThan(0);
    });
    const heading = await screen.findByRole(
      "heading",
      { name: "Requirements" },
      { timeout: 3000 },
    );
    // Heading now uses theme-token `text-foreground` for dark-mode parity
    // (migrated from literal text-foreground).
    expect(heading).toHaveClass("text-lg", "font-semibold", "text-foreground");

    const listItem = await screen.findByText("Ownership");
    expect(listItem.closest("li")).toHaveClass("text-foreground/85");

    const quotes = await screen.findAllByText("Note");
    const quote = quotes.find((node) => node.closest("blockquote")) ?? quotes[0];
    expect(quote.closest("blockquote")).toHaveClass("border-l-2");
  });

  it("shows screening-gate chips for year-limit requirements in JD", async () => {
    const jd =
      "Requirements: Minimum of 2 years of experience in software engineering required. " +
      "A Bachelor's degree is preferred.";

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?limit=50")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs/") && (!init || !init.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: jd }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });

    vi.stubGlobal("fetch", mockFetch);
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    // A preference cannot gate an application, so it must not appear under
    // "Screening gates". The grouping carries the qualifier, which is why the
    // chips read as the bare constraint.
    expect(await screen.findByText("Screening gates")).toBeInTheDocument();
    expect(await screen.findByText("Nice to have")).toBeInTheDocument();
    expect(await screen.findByText("2+ years")).toBeInTheDocument();
    expect(await screen.findByText("Bachelor's degree")).toBeInTheDocument();
    expect(screen.queryByText("Required: 2+ years")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Preferred: Bachelor's degree"),
    ).not.toBeInTheDocument();
  });

  it("keeps Saved CV/CL in the primary actions row and keeps Remove as a trailing secondary action", async () => {
    const jobWithSavedCv = {
      ...baseJob,
      id: "22222222-2222-2222-2222-222222222222",
      resumePdfUrl: "https://example.com/resume.pdf",
      resumePdfName: "resume.pdf",
      coverPdfUrl: "https://example.com/cover.pdf",
    };

    renderWithClient(<JobsClient initialItems={[jobWithSavedCv]} initialCursor={null} />);

    const primaryActionsList = await screen.findAllByTestId("job-primary-actions");
    const primaryActionsWithSavedCv =
      primaryActionsList.find((node) =>
        within(node).queryByRole("link", { name: /saved cv/i }),
      ) ?? null;
    expect(primaryActionsWithSavedCv).toBeTruthy();
    if (!primaryActionsWithSavedCv) return;

    expect(
      within(primaryActionsWithSavedCv).getByRole("link", { name: /open job/i }),
    ).toBeInTheDocument();
    const savedCvLink = within(primaryActionsWithSavedCv).getByRole("link", { name: /saved cv/i });
    expect(within(primaryActionsWithSavedCv).getByRole("link", { name: /saved cl/i })).toBeInTheDocument();
    expect(savedCvLink.querySelector("svg")).toBeNull();

    const removeButton = screen.getAllByTestId("job-remove-button")[0];
    expect(removeButton).toHaveClass("sm:ml-auto", "sm:w-auto");
    expect(removeButton).not.toHaveClass("sm:absolute");
  });

  it("uses a responsive stacked primary action layout for mobile", async () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const actionRows = await screen.findAllByTestId("job-primary-actions");
    expect(actionRows[0]).toHaveClass("grid", "grid-cols-1", "sm:grid-cols-2");
  });

  it("keeps deleted job hidden without triggering an unnecessary refetch", async () => {
    const user = userEvent.setup();
    let jobsFetchCount = 0;
    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?limit=50")) {
        jobsFetchCount += 1;
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs?")) {
        jobsFetchCount += 1;
        // Return the original list — if a refetch happens it must not un-hide the deleted job.
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs/") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: "Job description" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const removeButton = (await screen.findAllByTestId("job-remove-button"))[0];
    await user.click(removeButton);

    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Frontend Engineer/i }),
      ).not.toBeInTheDocument();
    });

    // After successful delete, a refetch is triggered to sync totalCount with server.
    // At most 1 refetch expected (from invalidateQueries in onSuccess).
    expect(jobsFetchCount).toBeLessThanOrEqual(1);
  });

  it("removes the job optimistically and defers a single DELETE until the view unmounts", async () => {
    const user = userEvent.setup();
    let deleteCalls = 0;

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith(`/api/jobs/${baseJob.id}`) && init?.method === "DELETE") {
        deleteCalls += 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: "Job description" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const { unmount } = renderWithClient(
      <JobsClient initialItems={[baseJob]} initialCursor={null} />,
    );

    const removeButton = (await screen.findAllByTestId("job-remove-button"))[0];
    await user.click(removeButton);

    // Optimistic: the row vanishes immediately with no confirm modal, and the
    // server DELETE is deferred (still within the undo window).
    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Frontend Engineer/i }),
      ).not.toBeInTheDocument();
    });
    expect(deleteCalls).toBe(0);

    // Navigating away flushes the pending delete exactly once.
    unmount();
    await waitFor(() => {
      expect(deleteCalls).toBe(1);
    });
  });

  it("deletes the selected job without route navigation and preserves the visible row anchor", async () => {
    const user = userEvent.setup();
    const jobs = [
      { ...baseJob, id: "aaaa-1111", title: "Alpha Engineer" },
      { ...baseJob, id: "bbbb-2222", title: "Beta Developer" },
      { ...baseJob, id: "cccc-3333", title: "Gamma Designer" },
    ];
    navigationMock.search = "utm=campaign";
    window.history.replaceState(window.history.state, "", "/jobs?utm=campaign");

    renderWithClient(<JobsClient initialItems={jobs} initialCursor={null} />);

    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    const list = within(resultsPane).getByRole("list");
    await user.click(
      within(list).getByRole("button", { name: /Beta Developer/i }),
    );
    navigationMock.replace.mockClear();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const viewport = resultsPane.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    )!;
    const alphaRow = list.querySelector<HTMLElement>("[data-job-id='aaaa-1111']")!;
    const betaRow = list.querySelector<HTMLElement>("[data-job-id='bbbb-2222']")!;
    const gammaRow = list.querySelector<HTMLElement>("[data-job-id='cccc-3333']")!;
    viewport.scrollTop = 500;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 700,
      left: 0,
      right: 400,
      width: 400,
      height: 600,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(alphaRow, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 90,
      left: 0,
      right: 400,
      width: 400,
      height: 90,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(betaRow, "getBoundingClientRect").mockReturnValue({
      top: 150,
      bottom: 250,
      left: 0,
      right: 400,
      width: 400,
      height: 100,
      x: 0,
      y: 150,
      toJSON: () => ({}),
    });
    vi.spyOn(gammaRow, "getBoundingClientRect").mockImplementation(() => ({
      top: betaRow.isConnected ? 280 : 160,
      bottom: betaRow.isConnected ? 380 : 260,
      left: 0,
      right: 400,
      width: 400,
      height: 100,
      x: 0,
      y: betaRow.isConnected ? 280 : 160,
      toJSON: () => ({}),
    }));

    await user.click(screen.getByTestId("job-remove-button"));

    await waitFor(() => {
      expect(within(list).queryByText("Beta Developer")).not.toBeInTheDocument();
      expect(gammaRow).toHaveAttribute("aria-current", "true");
    });
    expect(viewport.scrollTop).toBe(380);
    expect(navigationMock.replace).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/jobs?utm=campaign&job=cccc-3333",
    );
  });

  it("does not remount the list renderer when a delete crosses the virtualization threshold", async () => {
    const user = userEvent.setup();
    const jobs = Array.from({ length: 81 }, (_, index) => ({
      ...baseJob,
      id: `virtual-${index}`,
      title: `Virtual role ${index}`,
    }));
    let listFetches = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?")) {
        listFetches += 1;
        return new Response(
          JSON.stringify({ items: jobs, nextCursor: null, totalCount: jobs.length }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs/") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/")) {
        return new Response(JSON.stringify({ description: "desc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    }));

    renderWithClient(<JobsClient initialItems={jobs} initialCursor={null} />);
    const resultsPane = await screen.findByTestId("jobs-results-scroll");
    await waitFor(() => expect(resultsPane).toHaveAttribute("data-virtual", "true"));
    const listBeforeDelete = within(resultsPane).getByRole("list");
    const fetchesBeforeDelete = listFetches;

    await user.click(screen.getByTestId("job-remove-button"));

    await waitFor(() => {
      expect(resultsPane).toHaveAttribute("data-virtual", "true");
      expect(within(resultsPane).getByRole("list")).toBe(listBeforeDelete);
    });
    expect(listFetches).toBe(fetchesBeforeDelete);
  });

  it("rolls a failed delete back without refetching or overriding a newer selection", async () => {
    vi.useFakeTimers();
    const jobs = [
      { ...baseJob, id: "aaaa-1111", title: "Alpha Engineer" },
      { ...baseJob, id: "bbbb-2222", title: "Beta Developer" },
      { ...baseJob, id: "cccc-3333", title: "Gamma Designer" },
    ];
    let listFetches = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?")) {
        listFetches += 1;
        return new Response(
          JSON.stringify({ items: jobs, nextCursor: null, totalCount: jobs.length }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs/") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ error: "Temporary delete failure" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/")) {
        return new Response(JSON.stringify({ description: "desc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    }));

    try {
      renderWithClient(<JobsClient initialItems={jobs} initialCursor={null} />);
      const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
      const list = within(resultsPane).getByRole("list");
      fireEvent.click(
        within(list).getByRole("button", { name: /Beta Developer/i }),
      );
      fireEvent.click(screen.getByTestId("job-remove-button"));
      fireEvent.click(
        within(list).getByRole("button", { name: /Alpha Engineer/i }),
      );
      const fetchesBeforeCommit = listFetches;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      vi.useRealTimers();

      await waitFor(() => {
        expect(within(list).getByText("Beta Developer")).toBeInTheDocument();
        expect(
          list.querySelector<HTMLElement>("[data-job-id='aaaa-1111']"),
        ).toHaveAttribute("aria-current", "true");
      });
      expect(listFetches).toBe(fetchesBeforeCommit);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("flushes the pending delete on pagehide (tab close within the undo window)", async () => {
    const user = userEvent.setup();
    let deleteCalls = 0;

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith(`/api/jobs/${baseJob.id}`) && init?.method === "DELETE") {
        deleteCalls += 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: "Job description" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const removeButton = (await screen.findAllByTestId("job-remove-button"))[0];
    await user.click(removeButton);

    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Frontend Engineer/i }),
      ).not.toBeInTheDocument();
    });
    expect(deleteCalls).toBe(0);

    // The user closes the tab inside the undo window — pagehide must commit the
    // deferred delete (no timer/unmount fired). Without the listener this delete
    // would be silently lost and the row would resurrect on next load.
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => {
      expect(deleteCalls).toBe(1);
    });
  });

  it("shows the empty state (not a blank list) after the last visible job is deleted", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith(`/api/jobs/${baseJob.id}`) && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ id: baseJob.id, description: "d" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const removeButton = (await screen.findAllByTestId("job-remove-button"))[0];
    await user.click(removeButton);

    // The row is gone from the list...
    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Frontend Engineer/i }),
      ).not.toBeInTheDocument();
    });
    // ...and the empty state must show — NOT a dead blank list. With the row
    // hidden via suppression but still cached, `items` is empty while
    // `mergedItems` is not; the list must still render the empty affordance.
    await waitFor(() => {
      expect(screen.getByText(/no jobs yet/i)).toBeInTheDocument();
    });
  });

  it("restores the job and sends no DELETE when Undo is clicked", async () => {
    const user = userEvent.setup();
    let deleteCalls = 0;

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith(`/api/jobs/${baseJob.id}`) && init?.method === "DELETE") {
        deleteCalls += 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: "Job description" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const { unmount } = renderWithClient(
      <JobsClient initialItems={[baseJob]} initialCursor={null} />,
    );

    const removeButton = (await screen.findAllByTestId("job-remove-button"))[0];
    await user.click(removeButton);

    // The Undo action lives in the toast (toast store reset in beforeEach keeps
    // this isolated to the one toast this delete produces).
    const undoButton = await screen.findByRole("button", { name: /undo/i });
    await user.click(undoButton);

    // The row comes back and no DELETE is ever sent — not even on unmount,
    // because the pending delete was cancelled.
    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Frontend Engineer/i }),
      ).toBeInTheDocument();
    });
    unmount();
    expect(deleteCalls).toBe(0);
  });

  it("keeps pending-deletion jobs hidden during overlapping delete refetches", async () => {
    const user = userEvent.setup();
    const firstJob = { ...baseJob, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "Frontend Engineer A" };
    const secondJob = { ...baseJob, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", title: "Backend Engineer B" };
    // The server DELETE is deferred (undo window), so the list endpoint keeps
    // returning both jobs — the suppressed-id set must hide them regardless.
    const listPayload = {
      items: [firstJob, secondJob],
      nextCursor: null,
      totalCount: 2,
      facets: { jobLevels: ["Mid"] },
    };

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?")) {
        return new Response(JSON.stringify(listPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        const id = url.split("/").at(-1) ?? "";
        return new Response(
          JSON.stringify({
            id,
            description: id === secondJob.id ? "Second job description" : "First job description",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const { unmount } = renderWithClient(
      <JobsClient initialItems={[firstJob, secondJob]} initialCursor={null} />,
    );

    expect((await screen.findAllByText("Frontend Engineer A")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Backend Engineer B")).length).toBeGreaterThan(0);
    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];

    await user.click((await screen.findAllByTestId("job-remove-button"))[0]);
    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Frontend Engineer A/i }),
      ).not.toBeInTheDocument();
    });

    await user.click((await screen.findAllByTestId("job-remove-button"))[0]);
    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Frontend Engineer A/i }),
      ).not.toBeInTheDocument();
      expect(
        within(resultsPane).queryByRole("button", { name: /Backend Engineer B/i }),
      ).not.toBeInTheDocument();
    });

    unmount();
  });

  it("keeps results and details panels both visible on mobile layouts", async () => {
    const user = userEvent.setup();
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const resultsPanel = screen.getAllByTestId("jobs-results-panel")[0];
    const detailsPanel = screen.getAllByTestId("jobs-details-panel")[0];
    expect(screen.queryByTestId("jobs-mobile-pane-switch")).not.toBeInTheDocument();
    expect(resultsPanel.className).toContain("flex");
    expect(detailsPanel.className).toContain("flex");

    const jobButton = (await screen.findAllByRole("button", { name: /Frontend Engineer/i }))[0];
    await user.click(jobButton);

    expect(resultsPanel.className).toContain("flex");
    expect(detailsPanel.className).toContain("flex");
  });

  it("uses the allowlisted Local AI START_RUN as the primary CV action", async () => {
    const user = userEvent.setup();
    localAiBridgeMock.detect.mockResolvedValue("ready");
    localAiBridgeMock.send.mockImplementation(async (action: string, payload: unknown) => {
      if (action === "START_RUN" || action === "GET_RUN") {
        const request = payload as { requestId: string; jobId?: string; target?: string };
        return {
          requestId: request.requestId,
          jobId: request.jobId ?? baseJob.id,
          target: request.target ?? "resume",
          status: "queued",
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);
    await waitFor(() => {
      expect(localAiBridgeMock.detect).toHaveBeenCalledWith(
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    await user.click((await screen.findAllByRole("button", { name: /generate cv/i }))[0]);

    await waitFor(() => {
      expect(localAiBridgeMock.send).toHaveBeenCalledWith(
        "START_RUN",
        expect.objectContaining({ jobId: baseJob.id, target: "resume" }),
        expect.objectContaining({ timeoutMs: 20_000 }),
      );
    });
    const startPayload = localAiBridgeMock.send.mock.calls.find(([action]) => action === "START_RUN")?.[1];
    expect(JSON.stringify(startPayload)).not.toMatch(/token|prompt|url|run_id/i);
  });

  it("disables skill pack download until prompt meta is ready, then advances to Copy Prompt with one click", async () => {
    const user = userEvent.setup();
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    let resolvePrompt!: (value: Response) => void;
    const promptResponse = new Promise<Response>((resolve) => {
      resolvePrompt = resolve;
    });

    const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:skill-pack");
    const revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?limit=50")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: "Job description" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/applications/prompt")) {
        return promptResponse;
      }
      if (url.startsWith("/api/prompt-rules/skill-pack")) {
        return new Response(new Blob(["skill-pack"]), {
          status: 200,
          headers: {
            "content-disposition": 'attachment; filename="joblit-skills-v3.zip"',
          },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const generateCvButton = (await screen.findAllByRole("button", { name: /generate cv/i }))[0];
    await user.click(generateCvButton);
    await user.click(await screen.findByRole("button", { name: /use manual method/i }));

    const downloadButton = await screen.findByRole("button", {
      name: /preparing|download zip/i,
    });
    expect(downloadButton).toBeDisabled();

    resolvePrompt(
      new Response(
        JSON.stringify({
          prompt: {
            systemPrompt: "system",
            userPrompt: "user",
          },
          expectedJsonShape: { cvSummary: "string" },
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-08T00:00:00.000Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await waitFor(() => {
      expect(downloadButton).toBeEnabled();
    });

    await user.click(downloadButton);

    expect(await screen.findByRole("button", { name: /copy prompt to clipboard/i })).toBeInTheDocument();
    expect(createObjectUrlSpy).toHaveBeenCalled();
    expect(revokeObjectUrlSpy).toHaveBeenCalled();
    expect(anchorClickSpy).toHaveBeenCalled();
  });

  it("reuses the downloaded skill pack between CV and CL when version is unchanged", async () => {
    const user = userEvent.setup();
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    localStorage.clear();
    const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:skill-pack");
    const revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?limit=50")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: "Job description" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/applications/prompt")) {
        const target =
          init?.body && typeof init.body === "string"
            ? (JSON.parse(init.body) as { target?: "resume" | "cover" }).target
            : undefined;
        const promptHash = target === "cover" ? "b".repeat(64) : "a".repeat(64);
        return new Response(
          JSON.stringify({
            prompt: {
              systemPrompt: "system",
              userPrompt: "user",
            },
            expectedJsonShape: target === "cover" ? { cover: { paragraphOne: "string" } } : { cvSummary: "string" },
            promptMeta: {
              ruleSetId: "rules-1",
              resumeSnapshotUpdatedAt: "2026-02-08T00:00:00.000Z",
              promptTemplateVersion: "2026.07.v2",
              schemaVersion: "2026-07-24",
              skillPackVersion: "spv-1",
              promptHash,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/prompt-rules/skill-pack")) {
        return new Response(new Blob(["skill-pack"]), {
          status: 200,
          headers: {
            "content-disposition": 'attachment; filename="joblit-skills-v3.zip"',
            "x-skill-pack-version": "spv-1",
            "x-generation-receipt-version": "spv-1",
          },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const generateCvButton = (await screen.findAllByRole("button", { name: /generate cv/i }))[0];
    await user.click(generateCvButton);
    await user.click(await screen.findByRole("button", { name: /use manual method/i }));

    const downloadButton = await screen.findByRole("button", { name: /download zip/i });
    await waitFor(() => {
      expect(downloadButton).toBeEnabled();
    });
    await user.click(downloadButton);
    expect(await screen.findByRole("button", { name: /copy prompt to clipboard/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    const generateCoverButton = (await screen.findAllByRole("button", { name: /generate cl/i }))[0];
    await user.click(generateCoverButton);
    await user.click(await screen.findByRole("button", { name: /use manual method/i }));
    expect(await screen.findByRole("button", { name: /copy prompt to clipboard/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download skill pack/i })).not.toBeInTheDocument();

    const downloadCalls = mockFetch.mock.calls.filter(([request]) => {
      const requestUrl = typeof request === "string" ? request : request.url;
      return requestUrl.startsWith("/api/prompt-rules/skill-pack");
    });
    expect(downloadCalls).toHaveLength(1);
    expect(downloadCalls[0]?.[0]).toBe(
      "/api/prompt-rules/skill-pack?locale=en-AU",
    );
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("restores filtered query cache item when status update fails", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const newFilterKey = ["jobs", "limit=50&status=NEW&sort=newest", null] as const;
    client.setQueryData<{
      items: typeof baseJob[];
      nextCursor: string | null;
      totalCount?: number;
      facets?: { jobLevels?: string[] };
    }>(newFilterKey, {
      items: [baseJob],
      nextCursor: null,
      totalCount: 1,
      facets: { jobLevels: ["Mid"] },
    });

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, totalCount: 1, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs/") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ error: "patch failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: "Job description" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={client}>
          <JobsClient initialItems={[baseJob]} initialCursor={null} />
          <Toaster />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );

    const primaryActions = (await screen.findAllByTestId("job-primary-actions"))[0];
    const statusCombobox = within(primaryActions).getByRole("combobox");
    await user.click(statusCombobox);
    // Scope to option role so we don't accidentally click the status
    // segmented control in the list header (same visible text).
    await user.click(await screen.findByRole("option", { name: "Applied" }));

    await screen.findByText("Update failed");

    await waitFor(() => {
      const cache = client.getQueryData<{
        items: Array<{ id: string; status: string }>;
        totalCount?: number;
      }>(newFilterKey);
      expect(cache?.items.some((it) => it.id === baseJob.id && it.status === "NEW")).toBe(true);
      expect(cache?.totalCount).toBe(1);
    });
  });

  it("does not decrement totalCount for cached queries that do not contain the deleted job", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const appliedOnlyJob = {
      ...baseJob,
      id: "99999999-9999-9999-9999-999999999999",
      status: "APPLIED" as const,
      title: "Applied role",
    };
    // The jobs list is backed by useInfiniteQuery, so a cached filter is an
    // InfiniteData payload keyed by ["jobs", queryString] (no cursor segment).
    const appliedFilterKey = ["jobs", "limit=50&status=APPLIED&sort=newest"] as const;
    client.setQueryData<{
      pages: Array<{
        items: Array<{ id: string; status: string }>;
        nextCursor: string | null;
        totalCount?: number;
        facets?: { jobLevels?: string[] };
      }>;
      pageParams: Array<string | null>;
    }>(appliedFilterKey, {
      pages: [
        {
          items: [appliedOnlyJob],
          nextCursor: null,
          totalCount: 5,
          facets: { jobLevels: ["Mid"] },
        },
      ],
      pageParams: [null],
    });

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?")) {
        return new Response(
          JSON.stringify({ items: [baseJob], nextCursor: null, totalCount: 1, facets: { jobLevels: ["Mid"] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/jobs/") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ id: baseJob.id, description: "Job description" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={client}>
          <JobsClient initialItems={[baseJob]} initialCursor={null} />
          <Toaster />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );

    const removeButton = (await screen.findAllByTestId("job-remove-button"))[0];
    await user.click(removeButton);

    await screen.findByText("Job deleted");

    await waitFor(() => {
      const cache = client.getQueryData<{
        pages: Array<{ items: Array<{ id: string; status: string }>; totalCount?: number }>;
      }>(appliedFilterKey);
      expect(cache?.pages[0]?.items).toHaveLength(1);
      expect(cache?.pages[0]?.items[0]?.id).toBe(appliedOnlyJob.id);
      expect(cache?.pages[0]?.totalCount).toBe(5);
    });
  });

  describe("results toolbar", () => {
    it("offers only the three triage statuses", async () => {
      renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);
      await screen.findAllByText("Frontend Engineer");

      const statuses = screen.getByRole("radiogroup", { name: messages.jobs.status });
      const options = within(statuses).getAllByRole("radio");

      expect(options.map((option) => option.textContent)).toEqual([
        messages.jobs.statusNew,
        messages.jobs.statusApplied,
        messages.jobs.statusRejected,
      ]);
    });

    it("does not expose the retired pipeline statuses", async () => {
      renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);
      await screen.findAllByText("Frontend Engineer");

      for (const label of [
        messages.jobs.statusInterview,
        messages.jobs.statusOffer,
        messages.jobs.statusWithdrawn,
        messages.jobs.statusAccepted,
      ]) {
        expect(screen.queryByRole("radio", { name: label })).not.toBeInTheDocument();
      }
    });

    it("keeps the status group to one tab stop", async () => {
      renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);
      await screen.findAllByText("Frontend Engineer");

      expect(
        screen.getByRole("radio", { name: messages.jobs.statusNew }),
      ).toHaveAttribute("tabindex", "0");
      expect(
        screen.getByRole("radio", { name: messages.jobs.statusApplied }),
      ).toHaveAttribute("tabindex", "-1");
    });
  });

  describe("batch select and delete", () => {
    const jobA = { ...baseJob, id: "aaaa-1111", title: "Alpha Engineer", company: "AlphaCo" };
    const jobB = { ...baseJob, id: "bbbb-2222", title: "Beta Developer", company: "BetaCo" };
    const jobC = { ...baseJob, id: "cccc-3333", title: "Gamma Designer", company: "GammaCo" };

    function setupMultiJobFetch() {
      const deletedIds = new Set<string>();
      const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("/api/jobs/batch-delete") && init?.method === "POST") {
          const body = JSON.parse(typeof init.body === "string" ? init.body : "{}");
          for (const id of body.ids ?? []) deletedIds.add(id);
          return new Response(
            JSON.stringify({ ok: true, deleted: body.ids?.length ?? 0, notFound: 0 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.startsWith("/api/jobs?")) {
          const remaining = [jobA, jobB, jobC].filter((j) => !deletedIds.has(j.id));
          return new Response(
            JSON.stringify({ items: remaining, nextCursor: null, totalCount: remaining.length, facets: { jobLevels: ["Mid"] } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.startsWith("/api/jobs/") && init?.method === "DELETE") {
          const id = url.split("/api/jobs/")[1]?.split("?")[0];
          if (id) deletedIds.add(id);
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.startsWith("/api/jobs/") && (!init || init.method === "GET")) {
          return new Response(
            JSON.stringify({ id: jobA.id, description: "desc" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
      });
      vi.stubGlobal("fetch", mockFetch);
      return { mockFetch, deletedIds };
    }

    async function waitForJobsRendered() {
      await screen.findAllByText("Alpha Engineer");
    }

    it("gives the standard jobs list one active row tab stop", async () => {
      const user = userEvent.setup();
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
      const list = within(resultsPane).getByRole("list");
      const rows = [...list.querySelectorAll<HTMLButtonElement>("[data-job-id]")];

      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.tabIndex === 0)).toHaveLength(1);
      expect(rows[0]).toHaveAttribute("aria-current", "true");
      expect(rows[0]).toHaveAttribute("tabindex", "0");
      expect(rows[1]).not.toHaveAttribute("aria-current");
      expect(rows[1]).toHaveAttribute("tabindex", "-1");

      await user.click(rows[1]);

      expect(rows[0]).not.toHaveAttribute("aria-current");
      expect(rows[0]).toHaveAttribute("tabindex", "-1");
      expect(rows[1]).toHaveAttribute("aria-current", "true");
      expect(rows[1]).toHaveAttribute("tabindex", "0");
    });

    it("uses list semantics for the virtual jobs list", async () => {
      const virtualJobs = Array.from({ length: 81 }, (_, index) => ({
        ...jobA,
        id: `virtual-${index}`,
        title: `Virtual role ${index}`,
      }));
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("/api/jobs?")) {
          return new Response(
            JSON.stringify({ items: virtualJobs, nextCursor: null, totalCount: virtualJobs.length, facets: { jobLevels: ["Mid"] } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.startsWith("/api/jobs/")) {
          return new Response(
            JSON.stringify({ id: virtualJobs[0].id, description: "desc" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
      }));

      renderWithClient(<JobsClient initialItems={virtualJobs} initialCursor={null} />);

      const resultsPane = await screen.findByTestId("jobs-results-scroll");
      await waitFor(() => expect(resultsPane).toHaveAttribute("data-virtual", "true"));
      const list = within(resultsPane).getByRole("list");
      expect(list).toBeInTheDocument();
      expect(list.querySelector<HTMLElement>(".relative.w-full")).toHaveStyle({
        height: `${virtualJobs.length * 132}px`,
      });
    });

    it("keeps batch row selectors at least 44 by 44 pixels", async () => {
      const user = userEvent.setup();
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      const checkbox = screen.getByRole("button", { name: /select alpha engineer/i });
      const icon = checkbox.querySelector("svg");

      expect(checkbox).toHaveClass("min-h-11", "min-w-11");
      expect(icon).toHaveClass("h-[18px]", "w-[18px]");
    });

    it("does not navigate jobs from a batch row selector", async () => {
      const user = userEvent.setup();
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      const checkbox = screen.getByRole("button", { name: /select alpha engineer/i });
      const list = within(screen.getAllByTestId("jobs-results-scroll")[0]).getByRole("list");
      const rows = [...list.querySelectorAll<HTMLButtonElement>("[data-job-id]")];

      checkbox.focus();
      const wasNotCancelled = fireEvent.keyDown(checkbox, { key: "ArrowDown" });

      expect(wasNotCancelled).toBe(true);
      expect(checkbox).toHaveFocus();
      expect(rows[0]).toHaveAttribute("aria-current", "true");
      expect(rows[1]).not.toHaveAttribute("aria-current");
    });

    it("continues keyboard navigation from the focused batch main row", async () => {
      const user = userEvent.setup();
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      const list = within(screen.getAllByTestId("jobs-results-scroll")[0]).getByRole("list");
      const rows = [...list.querySelectorAll<HTMLButtonElement>("[data-job-id]")];

      await user.click(rows[1]);
      expect(rows[1]).toHaveFocus();
      expect(rows[0]).toHaveAttribute("aria-current", "true");

      fireEvent.keyDown(rows[1], { key: "ArrowDown" });

      await waitFor(() => expect(rows[2]).toHaveFocus());
      expect(rows[2]).toHaveAttribute("aria-current", "true");
      expect(rows[0]).not.toHaveAttribute("aria-current");
    });

    it("clears with Escape, then reselects from the list root with the keyboard", async () => {
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
      const list = within(resultsPane).getByRole("list");
      const rows = [...list.querySelectorAll<HTMLButtonElement>("[data-job-id]")];
      const details = screen.getByTestId("jobs-details-panel");

      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: "Escape" });

      await waitFor(() => expect(list).toHaveFocus());
      expect(list).toHaveAttribute("tabindex", "0");
      expect(rows.every((row) => !row.hasAttribute("aria-current"))).toBe(true);
      expect(within(details).getByText("Select a job to preview details.")).toBeInTheDocument();
      expect(within(details).queryByRole("heading", { name: "Alpha Engineer" })).not.toBeInTheDocument();

      const wasNotCancelled = fireEvent.keyDown(list, { key: "ArrowDown" });

      expect(wasNotCancelled).toBe(false);
      await waitFor(() => expect(rows[0]).toHaveFocus());
      expect(rows[0]).toHaveAttribute("aria-current", "true");
      expect(list).toHaveAttribute("tabindex", "-1");
      expect(within(details).getByRole("heading", { name: "Alpha Engineer" })).toBeInTheDocument();
    });

    it("lets a mutation selection replace an explicit Escape clear", async () => {
      const user = userEvent.setup();
      let resolveBatchDelete: (response: Response) => void = () => {};
      const batchDeleteResponse = new Promise<Response>((resolve) => {
        resolveBatchDelete = resolve;
      });
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("/api/jobs/batch-delete") && init?.method === "POST") {
          return batchDeleteResponse;
        }
        if (url.startsWith("/api/jobs?")) {
          return new Response(
            JSON.stringify({ items: [jobA, jobB, jobC], nextCursor: null, totalCount: 3, facets: { jobLevels: ["Mid"] } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.startsWith("/api/jobs/")) {
          return new Response(
            JSON.stringify({ id: jobA.id, description: "desc" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
      }));
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      await user.click(screen.getByRole("button", { name: /select alpha engineer/i }));
      await user.click(screen.getByRole("button", { name: /^delete$/i }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /delete 1 job/i }));

      const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
      const list = within(resultsPane).getByRole("list");
      await waitFor(() => {
        expect(within(list).queryByText("Alpha Engineer")).not.toBeInTheDocument();
      });
      const betaRow = list.querySelector<HTMLButtonElement>("[data-job-id='bbbb-2222']")!;

      betaRow.focus();
      fireEvent.keyDown(betaRow, { key: "Escape" });
      await waitFor(() => expect(list).toHaveFocus());
      expect(list.querySelector("[aria-current='true']")).toBeNull();

      resolveBatchDelete(new Response(JSON.stringify({ error: "batch failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }));

      await waitFor(() => {
        const restored = list.querySelector<HTMLButtonElement>("[data-job-id='aaaa-1111']");
        expect(restored).toHaveAttribute("aria-current", "true");
      });
      expect(within(screen.getByTestId("jobs-details-panel")).getByRole("heading", { name: "Alpha Engineer" })).toBeInTheDocument();
    });

    it("enters batch mode and shows checkboxes when selection icon is clicked", async () => {
      const user = userEvent.setup();
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      const enterBtn = screen.getByRole("button", { name: /enter selection mode/i });
      await user.click(enterBtn);

      expect(screen.getByRole("button", { name: /select alpha engineer/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /select beta developer/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /select gamma designer/i })).toBeInTheDocument();
    });

    it("selects individual items and shows correct count", async () => {
      const user = userEvent.setup();
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      await user.click(screen.getByRole("button", { name: /select alpha engineer/i }));

      expect(screen.getByText("1 selected")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /select beta developer/i }));
      expect(screen.getByText("2 selected")).toBeInTheDocument();
    });

    it("select all toggles all items", async () => {
      const user = userEvent.setup();
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      await user.click(screen.getByRole("button", { name: /select all/i }));

      expect(screen.getByText("3 selected")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /deselect all/i }));
      expect(screen.getByText("Select all")).toBeInTheDocument();
    });

    it("batch delete sends a single batch-delete request and removes items from list", async () => {
      const user = userEvent.setup();
      const { mockFetch } = setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      await user.click(screen.getByRole("button", { name: /select alpha engineer/i }));
      await user.click(screen.getByRole("button", { name: /select beta developer/i }));

      await user.click(screen.getByRole("button", { name: /^delete$/i }));

      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText(/delete 2 jobs\?/i)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: /delete 2 jobs/i }));

      const batchCalls = mockFetch.mock.calls.filter(
        ([url, init]) =>
          typeof url === "string" && url.includes("/api/jobs/batch-delete") && init?.method === "POST",
      );
      expect(batchCalls).toHaveLength(1);
      const body = JSON.parse(batchCalls[0][1]?.body as string);
      expect(body.ids).toHaveLength(2);
      expect(body.ids).toContain(jobA.id);
      expect(body.ids).toContain(jobB.id);

      const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
      await waitFor(() => {
        expect(within(resultsPane).queryByText("Alpha Engineer")).not.toBeInTheDocument();
        expect(within(resultsPane).queryByText("Beta Developer")).not.toBeInTheDocument();
        expect(within(resultsPane).getByText("Gamma Designer")).toBeInTheDocument();
      });
    }, 10_000);

    it("exits batch mode after deletion and clears selection", async () => {
      const user = userEvent.setup();
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      await user.click(screen.getByRole("button", { name: /select alpha engineer/i }));
      await user.click(screen.getByRole("button", { name: /^delete$/i }));

      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: /delete 1 job/i }));

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /select beta developer/i })).not.toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: /enter selection mode/i })).toBeInTheDocument();
    });

    it("keeps the failed batch selection ready for retry", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("/api/jobs/batch-delete") && init?.method === "POST") {
          return new Response(JSON.stringify({ error: "Temporary delete failure" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.startsWith("/api/jobs?")) {
          return new Response(
            JSON.stringify({
              items: [jobA, jobB, jobC],
              nextCursor: null,
              totalCount: 3,
              facets: { jobLevels: ["Mid"] },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.startsWith("/api/jobs/")) {
          return new Response(JSON.stringify({ id: jobA.id, description: "desc" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
      }));

      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();
      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      await user.click(screen.getByRole("button", { name: /select alpha engineer/i }));
      await user.click(screen.getByRole("button", { name: /select beta developer/i }));
      await user.click(screen.getByRole("button", { name: /^delete$/i }));
      await user.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: /delete 2 jobs/i,
        }),
      );

      expect(await screen.findByText("2 selected")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /select alpha engineer/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /select beta developer/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^delete$/i })).toBeEnabled();
    });

    it("exits batch mode when X button is clicked without deleting", async () => {
      const user = userEvent.setup();
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      await user.click(screen.getByRole("button", { name: /select alpha engineer/i }));
      expect(screen.getByText("1 selected")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /exit selection mode/i }));

      expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /enter selection mode/i })).toBeInTheDocument();
      expect((await screen.findAllByText("Alpha Engineer")).length).toBeGreaterThan(0);
    });

    it("totalCount in header updates correctly after batch delete", async () => {
      const user = userEvent.setup();
      setupMultiJobFetch();
      renderWithClient(<JobsClient initialItems={[jobA, jobB, jobC]} initialCursor={null} />);
      await waitForJobsRendered();

      await waitFor(() => {
        expect(screen.getByText("3 loaded")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /enter selection mode/i }));
      await user.click(screen.getByRole("button", { name: /select all/i }));
      await user.click(screen.getByRole("button", { name: /^delete$/i }));

      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: /delete 3 jobs/i }));

      const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
      await waitFor(() => {
        expect(within(resultsPane).queryByText("Alpha Engineer")).not.toBeInTheDocument();
        expect(within(resultsPane).queryByText("Beta Developer")).not.toBeInTheDocument();
        expect(within(resultsPane).queryByText("Gamma Designer")).not.toBeInTheDocument();
      });
    });
  });

});
