import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useLayoutEffect } from "react";
import { GuideProvider, useGuide } from "./GuideContext";
import { Toaster } from "@/components/ui/toaster";
import { resetToasts } from "@/hooks/use-toast";
import messages from "../messages/en.json";

let mockPathname = "/resume";
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1" } },
  }),
}));

type GuideStatePayload = {
  stage: "NEW_USER" | "ACTIVATED_USER" | "RETURNING_USER";
  checklist: {
    resume_setup: boolean;
    first_fetch: boolean;
    review_jobs: boolean;
    generate_first_pdf: boolean;
    mark_applied: boolean;
  };
  completedCount: number;
  totalCount: number;
  isComplete: boolean;
  dismissed: boolean;
  dismissedAt: string | null;
  completedAt: string | null;
  persisted: boolean;
};

function createState(overrides?: Partial<GuideStatePayload>): GuideStatePayload {
  return {
    stage: "NEW_USER",
    checklist: {
      resume_setup: false,
      first_fetch: false,
      review_jobs: false,
      generate_first_pdf: false,
      mark_applied: false,
    },
    completedCount: 0,
    totalCount: 5,
    isComplete: false,
    dismissed: false,
    dismissedAt: null,
    completedAt: null,
    persisted: true,
    ...overrides,
  };
}

function Harness() {
  const { closeGuide, markTaskComplete, openGuide, state } = useGuide();
  return (
    <div>
      <button type="button" data-guide-anchor="resume_setup">
        anchor-resume
      </button>
      <button type="button" onClick={() => markTaskComplete("resume_setup")}>
        complete-first
      </button>
      <button type="button" onClick={closeGuide}>
        close-guide
      </button>
      <button type="button" onClick={openGuide}>
        open-guide
      </button>
      <span data-testid="guide-count">
        {state ? `${state.completedCount}/${state.totalCount}` : "none"}
      </span>
    </div>
  );
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("GuideContext", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.sessionStorage.setItem("joblit_guide_welcome_shown", "1");
    vi.restoreAllMocks();
    mockPathname = "/resume";
    pushMock.mockReset();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.guideAnchor === "resume_setup") {
        return {
          x: 96,
          y: 80,
          top: 80,
          left: 96,
          right: 236,
          bottom: 116,
          width: 140,
          height: 36,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps completed checklist items when reopen response is stale", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "/api/onboarding/state" && !init?.method) {
        return new Response(
          JSON.stringify({ state: createState() }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === "/api/onboarding/state" && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body ?? "{}")) as { type?: string };
        if (payload.type === "complete_task") {
          return new Response(
            JSON.stringify({
              state: createState({
                checklist: {
                  resume_setup: true,
                  first_fetch: false,
                  review_jobs: false,
                  generate_first_pdf: false,
                  mark_applied: false,
                            },
                completedCount: 1,
              }),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (payload.type === "reopen") {
          return new Response(
            JSON.stringify({ state: createState() }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
      }

      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    renderWithIntl(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("0/5");
    });

    fireEvent.click(screen.getByRole("button", { name: "complete-first" }));
    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("1/5");
    });

    fireEvent.click(screen.getByRole("button", { name: "close-guide" }));
    fireEvent.click(screen.getByRole("button", { name: "open-guide" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([, init]) => {
          if (!init?.body) return false;
          const payload = JSON.parse(String(init.body)) as { type?: string };
          return payload.type === "reopen";
        }),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("1/5");
    });
  });

  it("opens the Quick Start panel and routes to the active task", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/onboarding/state" && !init?.method) {
        return new Response(
          JSON.stringify({ state: createState() }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "/api/onboarding/state" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ state: createState() }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.sessionStorage.setItem("joblit_guide_welcome_shown", "1");

    renderWithIntl(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("0/5");
    });

    const openGuideButton = screen.getByRole("button", { name: "open-guide" });
    openGuideButton.focus();
    fireEvent.click(openGuideButton);

    // The Quick Start panel renders with all five tasks listed in order.
    await waitFor(() => {
      expect(screen.getByTestId("guide-quickstart-panel")).toBeInTheDocument();
    });
    const panel = screen.getByTestId("guide-quickstart-panel");
    const backdrop = screen.getByTestId("guide-modal-backdrop");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop).not.toHaveClass("md:hidden");
    expect(
      screen
        .getByRole("button", { name: "anchor-resume", hidden: true })
        .closest('[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(document.body).toHaveAttribute("data-scroll-locked");
    const dismissButton = screen.getByRole("button", {
      name: messages.guide.dismissPanel,
    });
    expect(dismissButton).toHaveClass(
      "[@media(any-pointer:coarse)]:min-h-11",
      "[@media(any-pointer:coarse)]:min-w-11",
    );
    const list = screen.getByTestId("guide-quickstart-list");
    expect(list).toHaveTextContent(/Set up your master resume/i);
    expect(list).toHaveTextContent(/Run your first job fetch/i);

    fireEvent.click(dismissButton);
    await waitFor(() => {
      expect(screen.queryByTestId("guide-quickstart-panel")).not.toBeInTheDocument();
    });
    expect(document.body).not.toHaveAttribute("data-scroll-locked");
    await waitFor(() => {
      expect(openGuideButton).toHaveFocus();
    });

    fireEvent.click(openGuideButton);
    await waitFor(() => {
      expect(screen.getByTestId("guide-quickstart-panel")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("guide-quickstart-panel")).not.toBeInTheDocument();
    });
    expect(document.body).not.toHaveAttribute("data-scroll-locked");
    await waitFor(() => {
      expect(openGuideButton).toHaveFocus();
    });

    fireEvent.click(openGuideButton);
    await waitFor(() => {
      expect(screen.getByTestId("guide-quickstart-panel")).toBeInTheDocument();
    });

    // Clicking the primary "Take me there" CTA on the current task routes
    // to its href — for a fresh user that's /resume.
    const takeMeThere = screen.getAllByRole("button", { name: /take me there/i })[0];
    fireEvent.click(takeMeThere);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/resume");
    });

    // Routing also closes the panel so the user lands cleanly on the page.
    await waitFor(() => {
      expect(screen.queryByTestId("guide-quickstart-panel")).not.toBeInTheDocument();
    });
    expect(document.body).not.toHaveAttribute("data-scroll-locked");
  });

  it("renders an inline coachmark on the task page and auto-dismisses on completion", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/onboarding/state" && !init?.method) {
        return new Response(JSON.stringify({ state: createState() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/onboarding/state" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ state: createState() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithIntl(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("0/5");
    });

    fireEvent.click(screen.getByRole("button", { name: "open-guide" }));
    await waitFor(() => {
      expect(screen.getByTestId("guide-quickstart-panel")).toBeInTheDocument();
    });

    // "Take me there" navigates and arms the coachmark for resume_setup.
    fireEvent.click(screen.getAllByRole("button", { name: /take me there/i })[0]);
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/resume");
    });

    // The Harness already mounts a [data-guide-anchor="resume_setup"]
    // element, so the coachmark should locate it on the next poll tick.
    await waitFor(
      () => {
        expect(screen.getByTestId("guide-coachmark")).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
    expect(setIntervalSpy.mock.calls.filter((call) => call[1] === 200)).toHaveLength(0);
    const coachmark = screen.getByTestId("guide-coachmark");
    expect(coachmark).toHaveAttribute("role", "dialog");
    expect(coachmark).toHaveAttribute("aria-modal", "false");
    expect(document.body).not.toHaveAttribute("data-scroll-locked");
    expect(
      screen
        .getByRole("button", { name: "anchor-resume" })
        .closest('[aria-hidden="true"]'),
    ).toBeNull();

    // Completing the task auto-dismisses the coachmark.
    fireEvent.click(screen.getByRole("button", { name: "complete-first" }));
    await waitFor(() => {
      expect(screen.queryByTestId("guide-coachmark")).not.toBeInTheDocument();
    });
  });
});

/**
 * The completion loop. Completing a task used to end in silence: the coachmark
 * vanished and nothing pointed at the next step, so five tasks played as five
 * disconnected hints. Now each completion acknowledges the progress and offers
 * the next step in one gesture.
 */
describe("GuideContext — completion loop", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.sessionStorage.setItem("joblit_guide_welcome_shown", "1");
    resetToasts();
    vi.restoreAllMocks();
    mockPathname = "/resume";
    pushMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    resetToasts();
  });

  function stubStateFetch(overrides?: Partial<GuideStatePayload>) {
    const fetchMock = vi.fn(async (input: RequestInfo, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/onboarding/state") {
        return new Response(JSON.stringify({ state: createState(overrides) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function renderLoop(overrides?: Partial<GuideStatePayload>) {
    stubStateFetch(overrides);
    return renderWithIntl(
      <GuideProvider>
        <Harness />
        <Toaster />
      </GuideProvider>,
    );
  }

  function CompleteAsSoonAsStateAppears() {
    const { markTaskComplete, state } = useGuide();

    useLayoutEffect(() => {
      if (state && !state.checklist.resume_setup) {
        markTaskComplete("resume_setup");
      }
    }, [markTaskComplete, state]);

    return <span data-testid="immediate-guide-count">{state?.completedCount ?? "none"}</span>;
  }

  function CompleteTwoTasksAsSoonAsStateAppears() {
    const { markTaskComplete, state } = useGuide();

    useLayoutEffect(() => {
      if (state && !state.checklist.resume_setup && !state.checklist.first_fetch) {
        markTaskComplete("resume_setup");
        markTaskComplete("first_fetch");
      }
    }, [markTaskComplete, state]);

    return <span data-testid="batched-guide-count">{state?.completedCount ?? "none"}</span>;
  }

  it("acknowledges a task completed immediately after onboarding state appears", async () => {
    stubStateFetch();

    renderWithIntl(
      <GuideProvider>
        <CompleteAsSoonAsStateAppears />
        <Toaster />
      </GuideProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("immediate-guide-count")).toHaveTextContent("1");
    });

    expect(
      await screen.findByText(new RegExp(messages.guide.task_resume_setup_title)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(messages.guide.task_first_fetch_title), {
        selector: "[data-slot='toast-description']",
      }),
    ).toBeInTheDocument();
  });

  it("keeps consecutive layout-effect completions in state and persistence", async () => {
    const fetchMock = stubStateFetch();

    renderWithIntl(
      <GuideProvider>
        <CompleteTwoTasksAsSoonAsStateAppears />
      </GuideProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("batched-guide-count")).toHaveTextContent("2");
    });

    await waitFor(() => {
      const completionPayloads = fetchMock.mock.calls.flatMap(([, init]) => {
        if (!init?.body) return [];
        const payload = JSON.parse(String(init.body)) as {
          type?: string;
          taskId?: string;
          checklist?: GuideStatePayload["checklist"];
        };
        return payload.type === "complete_task" ? [payload] : [];
      });

      expect(completionPayloads).toHaveLength(2);
      expect(completionPayloads.at(-1)?.checklist).toMatchObject({
        resume_setup: true,
        first_fetch: true,
      });
    });
  });

  it("acknowledges a completion and offers the next step", async () => {
    renderLoop();
    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("0/5");
    });

    fireEvent.click(screen.getByRole("button", { name: "complete-first" }));

    // Toast names the finished task and points at the next one (first_fetch).
    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(messages.guide.task_resume_setup_title)),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(new RegExp(messages.guide.task_first_fetch_title), {
        selector: "[data-slot='toast-description']",
      }),
    ).toBeInTheDocument();
  });

  it("jumps to the next task from the toast", async () => {
    renderLoop();
    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("0/5");
    });

    fireEvent.click(screen.getByRole("button", { name: "complete-first" }));
    const cta = await screen.findByRole("button", {
      name: messages.guide.takeMeThere,
    });
    fireEvent.click(cta);

    expect(pushMock).toHaveBeenCalledWith("/fetch");
  });

  it("stays silent when the user dismissed the guide", async () => {
    renderLoop({ dismissed: true, dismissedAt: "2026-07-01T00:00:00.000Z" });
    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("0/5");
    });

    fireEvent.click(screen.getByRole("button", { name: "complete-first" }));

    // The completion still records; the celebration does not appear.
    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("1/5");
    });
    expect(
      screen.queryByText(new RegExp(messages.guide.task_resume_setup_title)),
    ).not.toBeInTheDocument();
  });

  it("celebrates the final task without offering a next step", async () => {
    renderLoop({
      checklist: {
        resume_setup: false,
        first_fetch: true,
        review_jobs: true,
        generate_first_pdf: true,
        mark_applied: true,
      },
      completedCount: 4,
    });
    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("4/5");
    });

    fireEvent.click(screen.getByRole("button", { name: "complete-first" }));

    // The all-done copy appears in the toast and may also appear in the
    // panel's completion view; either way it must exist and no next-step CTA
    // may accompany it.
    await waitFor(() => {
      expect(screen.getAllByText(messages.guide.allDone).length).toBeGreaterThan(0);
    });
    expect(
      screen.queryByRole("button", { name: messages.guide.takeMeThere }),
    ).not.toBeInTheDocument();
  });

  it("labels the floating launcher with the next step instead of a generic title", async () => {
    renderLoop({
      // RETURNING_USER: the welcome panel does not auto-open, so the launcher
      // is visible immediately.
      stage: "RETURNING_USER",
      checklist: {
        resume_setup: true,
        first_fetch: false,
        review_jobs: false,
        generate_first_pdf: false,
        mark_applied: false,
      },
      completedCount: 1,
    });

    const widget = await screen.findByTestId("guide-floating-widget");
    expect(widget.textContent).toContain(messages.guide.task_first_fetch_title);
  });
});
