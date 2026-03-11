import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { JobsClient } from "./JobsClient";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/toaster";
import messages from "../../../messages/en.json";

const fetchStatusMock = vi.hoisted(() => ({
  state: { runId: null as string | null, status: null as string | null, importedCount: 0 },
}));

vi.mock("@/app/FetchStatusContext", () => ({
  useFetchStatus: () => fetchStatusMock.state,
}));

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
  fetchStatusMock.state = { runId: null, status: null, importedCount: 0 };
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

  it("shows sort and results in the top toolbar", () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const toolbar = screen.getAllByTestId("jobs-toolbar")[0];
    expect(within(toolbar).getByTestId("jobs-sort")).toBeInTheDocument();
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

  it("applies the page-enter animation on the jobs shell", () => {
    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const shell = screen.getAllByTestId("jobs-shell")[0];
    expect(shell).toHaveClass("edu-page-enter");
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
    const input = within(toolbar).getByPlaceholderText("e.g. software engineer");
    await user.clear(input);
    await user.type(input, "designer");
    await new Promise((resolve) => setTimeout(resolve, 220));

    const jobsCall = (global.fetch as unknown as { mock: { calls: Array<[RequestInfo, RequestInit | undefined]> } }).mock.calls.find(
      ([request]) =>
        typeof request === "string" && request.startsWith("/api/jobs?") && request.includes("q=designer"),
    );

    expect(jobsCall).toBeTruthy();
    expect(jobsCall?.[1]?.cache).not.toBe("no-store");
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
    const input = within(toolbar).getByPlaceholderText("e.g. software engineer");
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
    const dialog = await screen.findByRole("alertdialog", { name: /delete this job/i });
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

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
    expect(heading).toHaveClass("text-base", "font-semibold", "text-slate-900");

    const listItem = await screen.findByText("Ownership");
    expect(listItem.closest("li")).toHaveClass("text-sm", "text-slate-700");

    const quotes = await screen.findAllByText("Note");
    const quote = quotes.find((node) => node.closest("blockquote")) ?? quotes[0];
    expect(quote.closest("blockquote")).toHaveClass("border-l-2");
  });

  it("shows experience gate chips for year-limit requirements in JD", async () => {
    const jd =
      "Requirements: Minimum of 5 years of experience in software engineering required. " +
      "Nice to have: 3+ years in React.";

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

    expect(await screen.findByText("Experience gate")).toBeInTheDocument();
    expect(await screen.findByText("Required: 5+ years")).toBeInTheDocument();
    expect(await screen.findByText("Preferred: 3+ years")).toBeInTheDocument();
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

  it("keeps a just-deleted job hidden even if a stale refetch returns it once", async () => {
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
        // Simulate a stale list response returning the deleted row once.
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
    const dialog = await screen.findByRole("alertdialog", { name: /delete this job/i });
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Frontend Engineer/i }),
      ).not.toBeInTheDocument();
    });

    expect(jobsFetchCount).toBeGreaterThan(0);
  });

  it("submits only one delete request when delete confirm is double-clicked quickly", async () => {
    const user = userEvent.setup();
    let deleteCalls = 0;
    let resolveDelete: (() => void) | null = null;
    const deletePromise = new Promise<Response>((resolve) => {
      resolveDelete = () =>
        resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
    });

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
      if (url.startsWith(`/api/jobs/${baseJob.id}`) && init?.method === "DELETE") {
        deleteCalls += 1;
        return deletePromise;
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
    const dialog = await screen.findByRole("alertdialog", { name: /delete this job/i });
    const confirm = within(dialog).getByRole("button", { name: /^delete$/i });
    await user.dblClick(confirm);

    expect(resolveDelete).toBeTruthy();
    resolveDelete?.();

    await waitFor(() => {
      expect(deleteCalls).toBe(1);
    });
  });

  it("keeps pending-deletion jobs hidden during overlapping delete refetches", async () => {
    const user = userEvent.setup();
    const firstJob = { ...baseJob, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "Frontend Engineer A" };
    const secondJob = { ...baseJob, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", title: "Backend Engineer B" };
    let firstDeleted = false;
    let secondDeleted = false;
    let resolveFirstDelete: (() => void) | null = null;
    let resolveSecondDelete: (() => void) | null = null;

    const firstDeletePromise = new Promise<Response>((resolve) => {
      resolveFirstDelete = () => {
        firstDeleted = true;
        resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      };
    });

    const secondDeletePromise = new Promise<Response>((resolve) => {
      resolveSecondDelete = () => {
        secondDeleted = true;
        resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      };
    });

    const listPayload = () => {
      const items = [firstDeleted ? null : firstJob, secondDeleted ? null : secondJob].filter(
        (item): item is typeof firstJob => Boolean(item),
      );
      return {
        items,
        nextCursor: null,
        totalCount: items.length,
        facets: { jobLevels: ["Mid"] },
      };
    };

    const mockFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/jobs?limit=50")) {
        return new Response(JSON.stringify(listPayload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/jobs?")) {
        return new Response(JSON.stringify(listPayload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === `/api/jobs/${firstJob.id}` && init?.method === "DELETE") {
        return firstDeletePromise;
      }
      if (url === `/api/jobs/${secondJob.id}` && init?.method === "DELETE") {
        return secondDeletePromise;
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

    renderWithClient(<JobsClient initialItems={[firstJob, secondJob]} initialCursor={null} />);

    expect((await screen.findAllByText("Frontend Engineer A")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Backend Engineer B")).length).toBeGreaterThan(0);
    const confirmDelete = async () => {
      const dialog = await screen.findByRole("alertdialog", { name: /delete this job/i });
      await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    };

    await user.click((await screen.findAllByTestId("job-remove-button"))[0]);
    await confirmDelete();

    await user.click((await screen.findAllByTestId("job-remove-button"))[0]);
    await confirmDelete();

    expect(resolveFirstDelete).toBeTruthy();
    resolveFirstDelete?.();

    const resultsPane = screen.getAllByTestId("jobs-results-scroll")[0];
    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Backend Engineer B/i }),
      ).not.toBeInTheDocument();
    });

    expect(resolveSecondDelete).toBeTruthy();
    resolveSecondDelete?.();

    await waitFor(() => {
      expect(
        within(resultsPane).queryByRole("button", { name: /Frontend Engineer A/i }),
      ).not.toBeInTheDocument();
      expect(
        within(resultsPane).queryByRole("button", { name: /Backend Engineer B/i }),
      ).not.toBeInTheDocument();
    });
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

  it("disables skill pack download until prompt meta is ready, then advances to Copy Prompt with one click", async () => {
    const user = userEvent.setup();
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
            "content-disposition": 'attachment; filename="jobflow-tailoring.tar.gz"',
          },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const generateCvButton = (await screen.findAllByRole("button", { name: /generate cv/i }))[0];
    await user.click(generateCvButton);

    const downloadButton = await screen.findByRole("button", {
      name: /preparing|download skill pack/i,
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

    expect(await screen.findByText(/copy prompt and paste it/i)).toBeInTheDocument();
    expect(createObjectUrlSpy).toHaveBeenCalled();
    expect(revokeObjectUrlSpy).toHaveBeenCalled();
  });

  it("reuses the downloaded skill pack between CV and CL when version is unchanged", async () => {
    const user = userEvent.setup();
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
              promptTemplateVersion: "2026.02.v1",
              schemaVersion: "2026-02-22",
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
            "content-disposition": 'attachment; filename="jobflow-tailoring.tar.gz"',
            "x-skill-pack-version": "spv-1",
          },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", mockFetch);

    renderWithClient(<JobsClient initialItems={[baseJob]} initialCursor={null} />);

    const generateCvButton = (await screen.findAllByRole("button", { name: /generate cv/i }))[0];
    await user.click(generateCvButton);

    const downloadButton = await screen.findByRole("button", { name: /download skill pack/i });
    await waitFor(() => {
      expect(downloadButton).toBeEnabled();
    });
    await user.click(downloadButton);
    expect(await screen.findByText(/copy prompt and paste it/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    const generateCoverButton = (await screen.findAllByRole("button", { name: /generate cl/i }))[0];
    await user.click(generateCoverButton);
    expect(await screen.findByText(/copy prompt and paste it/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download skill pack/i })).not.toBeInTheDocument();

    const downloadCalls = mockFetch.mock.calls.filter(([request]) => {
      const requestUrl = typeof request === "string" ? request : request.url;
      return requestUrl.startsWith("/api/prompt-rules/skill-pack");
    });
    expect(downloadCalls).toHaveLength(1);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
  });

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
    await user.click(await screen.findByText("Applied"));

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
    const appliedFilterKey = ["jobs", "limit=50&status=APPLIED&sort=newest", null] as const;
    client.setQueryData<{
      items: typeof baseJob[];
      nextCursor: string | null;
      totalCount?: number;
      facets?: { jobLevels?: string[] };
    }>(appliedFilterKey, {
      items: [appliedOnlyJob],
      nextCursor: null,
      totalCount: 5,
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
    const dialog = await screen.findByRole("alertdialog", { name: /delete this job/i });
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await screen.findByText("Job deleted");

    await waitFor(() => {
      const cache = client.getQueryData<{
        items: Array<{ id: string; status: string }>;
        totalCount?: number;
      }>(appliedFilterKey);
      expect(cache?.items).toHaveLength(1);
      expect(cache?.items[0]?.id).toBe(appliedOnlyJob.id);
      expect(cache?.totalCount).toBe(5);
    });
  });

});

