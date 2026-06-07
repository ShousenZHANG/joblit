import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { FetchClient } from "./FetchClient";
import messages from "../../../messages/en.json";

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  value: vi.fn(),
  writable: true,
});

const pushMock = vi.fn();
const startRunMock = vi.fn();
const markTaskCompleteMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "user-1",
      },
    },
  }),
}));

vi.mock("@/app/GuideContext", () => ({
  useGuide: () => ({
    isTaskHighlighted: () => false,
    markTaskComplete: markTaskCompleteMock,
  }),
}));

vi.mock("@/app/FetchStatusContext", () => ({
  useFetchStatus: () => ({
    startRuns: startRunMock,
    status: null,
    runId: null,
    error: null,
    open: false,
    setOpen: vi.fn(),
    cancelRun: vi.fn(),
    importedCount: 0,
    elapsedSeconds: 0,
  }),
}));

describe("FetchClient", () => {
  function renderFetch() {
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FetchClient />
      </NextIntlClientProvider>,
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    startRunMock.mockReset();
    markTaskCompleteMock.mockReset();
    localStorage.clear();

    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/fetch-runs" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "run-1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/fetch-runs/run-1/trigger" && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
  });

  it("does not start a page-level polling interval after submitting fetch", async () => {
    const user = userEvent.setup();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    renderFetch();

    await user.click(screen.getByRole("button", { name: /start fetch/i }));

    await waitFor(() => {
      expect(startRunMock).toHaveBeenCalledWith([{ id: "run-1", source: "jobspy" }]);
    });

    const pollingCalls = setIntervalSpy.mock.calls.filter((call) => call[1] === 3000);
    expect(pollingCalls).toHaveLength(0);
  });

  it("splits multiple titles into queries when creating a fetch run", async () => {
    const user = userEvent.setup();

    renderFetch();

    const titleInput = screen.getAllByPlaceholderText(/e\.g\. software engineer/i)[0];
    fireEvent.change(titleInput, {
      target: {
        value: "Software Engineer, Frontend Engineer | Backend Engineer",
      },
    });
    await user.click(screen.getByRole("button", { name: /start fetch/i }));

    await waitFor(() => {
      expect(startRunMock).toHaveBeenCalledWith([{ id: "run-1", source: "jobspy" }]);
    });

    const fetchMock = global.fetch as unknown as {
      mock: { calls: Array<[RequestInfo | URL, RequestInit | undefined]> };
    };
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/fetch-runs" && init?.method === "POST",
    );

    expect(createCall).toBeTruthy();
    const body = JSON.parse(String(createCall?.[1]?.body ?? "{}"));

    expect(body.title).toBe("Software Engineer");
    expect(body.queries).toEqual([
      "Software Engineer",
      "Frontend Engineer",
      "Backend Engineer",
    ]);
    expect(body.smartExpand).toBe(true);
    expect(body.excludeDescriptionRules).toEqual([
      "identity_requirement",
      "experience_requirement_4_plus",
    ]);
    expect(body.sourceOptions).toBeUndefined();
  });

  it("fetches LinkedIn + Seek in parallel when source is Both", async () => {
    const user = userEvent.setup();
    // Source-aware mock so the two runs get distinct ids (the panel keys lanes
    // by id). Returns run-jobspy / run-seek per the POST body's `source`.
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/fetch-runs" && init?.method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const id = body.source === "seek" ? "run-seek" : "run-jobspy";
        return new Response(JSON.stringify({ id }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (/\/api\/fetch-runs\/(run-jobspy|run-seek)\/trigger$/.test(url) && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FetchClient seekEnabled />
      </NextIntlClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /^both$/i }));
    await user.click(screen.getByRole("button", { name: /start fetch/i }));

    // Tracks both lanes, in source order.
    await waitFor(() => {
      expect(startRunMock).toHaveBeenCalledWith([
        { id: "run-jobspy", source: "jobspy" },
        { id: "run-seek", source: "seek" },
      ]);
    });

    // One create POST per source, each carrying its own `source`.
    const createCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/fetch-runs" && init?.method === "POST",
    );
    expect(createCalls).toHaveLength(2);
    const sources = createCalls
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")).source)
      .sort();
    expect(sources).toEqual(["jobspy", "seek"]);

    // Both runs dispatched.
    const triggerCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        typeof url === "string" &&
        /\/api\/fetch-runs\/(run-jobspy|run-seek)\/trigger$/.test(url) &&
        init?.method === "POST",
    );
    expect(triggerCalls).toHaveLength(2);
  });

  it("renders fetch action buttons inside the card", () => {
    renderFetch();

    const actions = screen.getByTestId("fetch-actions");
    expect(actions).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /start fetch/i })).toBeInTheDocument();
  });

  it("opens title exclusions dropdown with bounded menu sizing and animation", async () => {
    const user = userEvent.setup();
    renderFetch();

    const trigger = screen.getByTestId("title-exclusions-trigger");
    await user.click(trigger);

    const menu = await screen.findByTestId("title-exclusions-menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveClass("h-11", "rounded-2xl");
    expect(menu.className).toContain("w-[var(--radix-dropdown-menu-trigger-width)]");
    expect(menu.className).toContain("data-[state=open]:animate-in");
    expect(menu.className).toContain("data-[state=open]:zoom-in-95");
  });

  it("defaults the minimum-experience filter to 4+ and lists rights rules separately", async () => {
    const user = userEvent.setup();
    renderFetch();

    // Experience is now its own select, defaulted to 4+ years.
    expect(screen.getByText("Requires 4+ years experience")).toBeInTheDocument();

    // The description-rules dropdown now holds rights rules only.
    await user.click(screen.getByTestId("description-exclusions-trigger"));
    expect(await screen.findByText("No visa sponsorship")).toBeInTheDocument();
  });

  it("lists recent fetches and re-runs one back into the form", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/fetch-runs" && init?.method !== "POST") {
        return new Response(
          JSON.stringify({
            runs: [
              {
                id: "r1",
                status: "SUCCEEDED",
                market: "AU",
                importedCount: 7,
                title: "Platform Engineer",
                queryCount: 3,
                location: "Melbourne, Victoria, Australia",
                hoursOld: 24,
                smartExpand: true,
                sources: null,
                excludeKeywords: null,
                createdAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderFetch();

    expect(await screen.findByText("Platform Engineer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /re-run platform engineer/i }));

    await waitFor(() => {
      const titleInput = screen.getAllByPlaceholderText(
        /e\.g\. software engineer/i,
      )[0] as HTMLInputElement;
      expect(titleInput.value).toBe("Platform Engineer");
    });
  });

  it("sends a custom title term and the default experience exclusion in the run body", async () => {
    const user = userEvent.setup();
    renderFetch();

    const customInput = screen.getByLabelText(/add custom title exclusion term/i);
    await user.type(customInput, "intern");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await user.click(screen.getByRole("button", { name: /start fetch/i }));
    await waitFor(() => {
      expect(startRunMock).toHaveBeenCalledWith([{ id: "run-1", source: "jobspy" }]);
    });

    const fetchMock = global.fetch as unknown as {
      mock: { calls: Array<[RequestInfo | URL, RequestInit | undefined]> };
    };
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/fetch-runs" && init?.method === "POST",
    );
    const body = JSON.parse(String(createCall?.[1]?.body ?? "{}"));

    expect(body.excludeTitleTerms).toContain("intern");
    expect(body.excludeDescriptionRules).toContain("experience_requirement_4_plus");
    // Removed filters must no longer be sent.
    expect(body.remoteOnly).toBeUndefined();
    expect(body.minSalary).toBeUndefined();
    expect(body.strictness).toBeUndefined();
    expect(body.excludeJobTypes).toBeUndefined();
  });
});
