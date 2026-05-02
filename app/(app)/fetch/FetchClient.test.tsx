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
    startRun: startRunMock,
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
      expect(startRunMock).toHaveBeenCalledWith("run-1");
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
      expect(startRunMock).toHaveBeenCalledWith("run-1");
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
    expect(body.excludeDescriptionRules).toEqual(["identity_requirement"]);
    expect(body.sourceOptions).toBeUndefined();
  });

  it("renders fetch action buttons inside the card", () => {
    renderFetch();

    const actions = screen.getByTestId("fetch-actions");
    expect(actions).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /start fetch/i })).toBeInTheDocument();
  });

  it("opens title exclusions with polished motion and bounded menu sizing", async () => {
    const user = userEvent.setup();
    renderFetch();

    const trigger = screen.getByTestId("title-exclusions-trigger");
    await user.click(trigger);

    const menu = await screen.findByTestId("title-exclusions-menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveClass("h-12", "rounded-2xl");
    expect(menu.className).toContain("w-[var(--radix-dropdown-menu-trigger-width)]");
    expect(menu.className).toContain("data-[state=open]:animate-in");
    expect(menu.className).toContain("data-[state=open]:zoom-in-95");
  });

  it("shows explicit experience requirement exclusions in the description menu", async () => {
    const user = userEvent.setup();
    renderFetch();

    await user.click(screen.getByTestId("description-exclusions-trigger"));

    expect(await screen.findByText("Requires 5+ years experience")).toBeInTheDocument();
    expect(screen.getByText(/minimum requirement of 5 or more years/i)).toBeInTheDocument();
  });
});
