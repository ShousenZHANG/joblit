import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { FetchClient } from "./FetchClient";
import messages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh.json";

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  value: vi.fn(),
  writable: true,
});

const pushMock = vi.fn();
const startRunMock = vi.fn();
const markTaskCompleteMock = vi.fn();
const marketMock = vi.hoisted(() => ({ value: "AU" as const }));

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

vi.mock("@/hooks/useMarket", () => ({
  useMarket: () => marketMock.value,
}));

describe("FetchClient", () => {
  function renderFetch(locale: "en" | "zh" = "en") {
    return render(
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zhMessages : messages}
      >
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
    vi.useRealTimers();
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

  it("submits through a receiver-sensitive browser fetch implementation", async () => {
    const user = userEvent.setup();
    const browserFetch = vi.fn(function (
      this: unknown,
      input: RequestInfo,
      init?: RequestInit,
    ) {
      const url = typeof input === "string" ? input : input.url;
      // A bare global fetch call is valid in browsers. The regression was the
      // trigger dependency being invoked as a method of its context object.
      if (
        url === "/api/fetch-runs/browser-run/trigger" &&
        this !== globalThis
      ) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation",
        );
      }
      if (url === "/api/fetch-runs" && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ id: "browser-run" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (
        url === "/api/fetch-runs/browser-run/trigger" &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ runs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", browserFetch);

    renderFetch();
    await user.click(screen.getByRole("button", { name: /start fetch/i }));

    await waitFor(() => {
      expect(startRunMock).toHaveBeenCalledWith([
        { id: "browser-run", source: "jobspy" },
      ]);
    });
    expect(
      screen.queryByText(/illegal invocation/i),
    ).not.toBeInTheDocument();
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
    expect(body.includeFromQueries).toBe(true);
    expect(body.excludeDescriptionRules).toEqual([
      "identity_requirement",
      "experience_requirement_4_plus",
    ]);
    expect(body.sourceOptions).toBeUndefined();
  });

  // The old control was a checkbox whose "off" state meant "skip the include
  // filter" to the AU worker and "loosen the include filter" to the GLOBAL
  // processor. One click produced different amounts from the two markets with
  // nothing on screen to say why, so the states are now named.
  async function submitWithTitleMatch(mode: "Strict" | "Relaxed" | "Off") {
    const user = userEvent.setup();
    renderFetch();

    const titleInput = screen.getAllByPlaceholderText(/e\.g\. software engineer/i)[0];
    fireEvent.change(titleInput, { target: { value: "AI Engineer" } });
    await user.click(screen.getByRole("radio", { name: mode }));
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
    return JSON.parse(String(createCall?.[1]?.body ?? "{}"));
  }

  it("sends the selected title match mode", async () => {
    expect(await submitWithTitleMatch("Off")).toMatchObject({
      titleMatch: "off",
      // The legacy boolean still ships for FetchRun rows and the AU worker's
      // compatibility projection.
      includeFromQueries: false,
    });
  });

  it("sends relaxed without claiming the filter is off", async () => {
    expect(await submitWithTitleMatch("Relaxed")).toMatchObject({
      titleMatch: "relaxed",
      includeFromQueries: true,
    });
  });

  it("defaults to strict", async () => {
    expect(await submitWithTitleMatch("Strict")).toMatchObject({
      titleMatch: "strict",
      includeFromQueries: true,
    });
  });

  it("optionally adds a filtered GLOBAL run and tracks both source lanes", async () => {
    const user = userEvent.setup();
    let createCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/fetch-runs" && init?.method === "POST") {
        createCount += 1;
        return new Response(JSON.stringify({ id: `run-${createCount}` }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (/^\/api\/fetch-runs\/run-\d+\/trigger$/.test(url) && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/fetch-runs") {
        return new Response(JSON.stringify({ runs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderFetch();
    await user.click(screen.getByTestId("global-feeds-chip"));
    await user.click(screen.getByRole("button", { name: /start fetch/i }));

    await waitFor(() => {
      expect(startRunMock).toHaveBeenCalledWith([
        { id: "run-1", source: "jobspy" },
        { id: "run-2", source: "global" },
      ]);
    });

    const createBodies = fetchMock.mock.calls
      .filter(([url, init]) => url === "/api/fetch-runs" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")));
    expect(createBodies[1]).toMatchObject({
      market: "GLOBAL",
      queries: ["Software Engineer"],
      baseQueries: ["Software Engineer"],
      location: "Sydney, New South Wales, Australia",
      hoursOld: 48,
      smartExpand: true,
      includeFromQueries: true,
      applyExcludes: true,
      excludeTitleTerms: expect.arrayContaining(["senior", "lead"]),
      excludeDescriptionRules: [
        "identity_requirement",
        "experience_requirement_4_plus",
      ],
    });
  });

  it("keeps a created lane visible when multi-source rollback cannot cancel it", async () => {
    const user = userEvent.setup();
    let createCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/fetch-runs" && init?.method === "POST") {
        createCount += 1;
        if (createCount === 1) {
          return new Response(JSON.stringify({ id: "run-visible" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ error: { message: "Global create failed" } }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (
        url === "/api/fetch-runs/run-visible/cancel" &&
        init?.method === "POST"
      ) {
        return new Response(
          JSON.stringify({ error: { message: "Cancel unavailable" } }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ runs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderFetch();
    await user.click(screen.getByTestId("global-feeds-chip"));
    await user.click(screen.getByRole("button", { name: /start fetch/i }));

    await waitFor(() => {
      expect(startRunMock).toHaveBeenCalledWith([
        { id: "run-visible", source: "jobspy" },
      ]);
    });
  });

  it("localizes Retry and keeps the error recovery target touch-sized", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        if (url === "/api/fetch-runs" && init?.method === "POST") {
          return new Response(
            JSON.stringify({ error: { message: "Create failed" } }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify({ runs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderFetch("zh");
    await user.click(
      within(screen.getByTestId("fetch-actions")).getByRole("button"),
    );

    const retry = await screen.findByRole("button", { name: "重试" });
    expect(retry).toHaveClass("h-11");
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

  it.each([
    [
      "en",
      "3 imported · partially completed",
      "Re-run",
      "Re-run Reliability Engineer",
    ],
    [
      "zh",
      "已导入 3 个 · 部分完成",
      "重新抓取",
      "重新抓取 Reliability Engineer",
    ],
  ] as const)(
    "renders localized PARTIAL fetch history as an amber terminal outcome in %s",
    async (locale, statusText, rerunText, rerunName) => {
      const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        if (url === "/api/fetch-runs" && init?.method !== "POST") {
          return new Response(
            JSON.stringify({
              runs: [
                {
                  id: "partial-run",
                  status: "PARTIAL",
                  market: "GLOBAL",
                  importedCount: 3,
                  title: "Reliability Engineer",
                  queryCount: 1,
                  location: null,
                  hoursOld: 24,
                  smartExpand: true,
                  sources: ["remoteok"],
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

      renderFetch(locale);

      const title = await screen.findByText("Reliability Engineer");
      const row = title.closest("li");
      expect(row).not.toBeNull();
      expect(row).toHaveTextContent(statusText);
      expect(row?.querySelector("span[aria-hidden]")).toHaveClass("bg-amber-500");
      expect(screen.getByRole("button", { name: rerunName })).toHaveTextContent(
        rerunText,
      );
      if (locale === "zh") {
        expect(row).not.toHaveTextContent(/imported|partially completed|re-run/i);
      }
    },
  );

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

  it.each(["create", "trigger"] as const)(
    "shows translated capacity recovery copy when %s is quota limited",
    async (limitedStep) => {
      const user = userEvent.setup();
      const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        const quotaResponse = () =>
          new Response(
            JSON.stringify({
              error: {
                code: "FETCH_RUN_QUOTA_EXCEEDED",
                message: "RAW_SERVER_CAPACITY_MESSAGE",
                reason: "USER_ACTIVE_LIMIT",
                limit: 2,
              },
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "30",
              },
            },
          );

        if (url === "/api/fetch-runs" && init?.method === "POST") {
          return limitedStep === "create"
            ? quotaResponse()
            : new Response(JSON.stringify({ id: "run-1" }), {
                status: 201,
                headers: { "Content-Type": "application/json" },
              });
        }
        if (url === "/api/fetch-runs/run-1/trigger" && init?.method === "POST") {
          return quotaResponse();
        }
        return new Response(JSON.stringify({ runs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      renderFetch();
      await user.click(screen.getByRole("button", { name: /start fetch/i }));

      expect(
        await screen.findByText("Free fetch capacity is busy right now. Try again shortly."),
      ).toBeInTheDocument();
      expect(screen.queryByText("RAW_SERVER_CAPACITY_MESSAGE")).not.toBeInTheDocument();
      expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
    },
  );
});
