import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuideProvider, useGuide } from "./GuideContext";

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
    triage_first_job: boolean;
    generate_first_pdf: boolean;
    download_first_pdf: boolean;
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
      triage_first_job: false,
      generate_first_pdf: false,
      download_first_pdf: false,
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

describe("GuideContext", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    mockPathname = "/resume";
    pushMock.mockReset();
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
                  triage_first_job: false,
                  generate_first_pdf: false,
                  download_first_pdf: false,
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

    render(
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

  it("starts the guided tour and navigates steps via Next", async () => {
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

    render(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("guide-count")).toHaveTextContent("0/5");
    });

    fireEvent.click(screen.getByRole("button", { name: "open-guide" }));

    await waitFor(() => {
      expect(screen.getByTestId("guide-tour-card")).toBeInTheDocument();
      expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/fetch");
    });

    fireEvent.click(screen.getByRole("button", { name: /end tour/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("guide-tour-card")).not.toBeInTheDocument();
    });
  });
});
