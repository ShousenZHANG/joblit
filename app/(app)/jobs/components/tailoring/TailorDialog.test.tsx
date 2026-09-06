import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guide = vi.hoisted(() => ({ markTaskComplete: vi.fn() }));
vi.mock("@/app/GuideContext", () => ({
  useGuide: () => ({ markTaskComplete: guide.markTaskComplete }),
}));

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "test-user" } } }) }));
vi.mock("@/lib/client/localTailoring/companionClient", async (original) => ({
  ...await original<typeof import("@/lib/client/localTailoring/companionClient")>(),
  accountFingerprint: async () => "a".repeat(64),
  launchCompanion: vi.fn(),
}));
import { pairingToken } from "@/lib/client/localTailoring/companionClient";

import messages from "@/messages/en.json";
import { TailorDialog } from "./TailorDialog";
import { useTailorReviewController } from "../../hooks/useTailorReviewController";
import type { JobItem } from "../../types";

const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const SUMMARY =
  "Grounded platform engineer with eight years across Kubernetes, Go and TypeScript, shipping serverless data pipelines for Australian fintechs and holding full working rights.";

const PUBLICATION_DRAFT = {
  status: "DRAFT",
  resume: {
    status: "DRAFT",
    contentHash: "resume-content",
    publishedHash: null,
  },
  cover: { status: "MISSING", contentHash: null, publishedHash: null },
};

const PUBLICATION_FINAL = {
  status: "FINAL",
  resume: {
    status: "FINAL",
    contentHash: "resume-content",
    publishedHash: "resume-content",
  },
  cover: { status: "MISSING", contentHash: null, publishedHash: null },
};

const AI_CONTENT = {
  schemaVersion: 2,
  generatedAt: "2026-08-10T00:00:00.000Z",
  promptMetaHash: "prompt-hash",
  cv: {
    summary: { aiText: SUMMARY, originalText: "Engineer.", accepted: true },
    skillsSelection: { aiSelection: [{ group: 0, items: [0] }] },
  },
  cover: {
    paragraphOne: { aiText: "", accepted: true },
    paragraphTwo: { aiText: "", accepted: true },
    paragraphThree: { aiText: "", accepted: true },
  },
};

const SNAPSHOT = {
  applicationId: APPLICATION_ID,
  publication: PUBLICATION_DRAFT,
  aiContentHash: "content-hash",
  aiContent: AI_CONTENT,
  masterSkills: [
    { category: "Languages", items: ["TypeScript", "Go"] },
    { category: "Platform", items: ["Kubernetes"] },
  ],
  documents: {
    resume: { pdfUrl: null, pdfName: "Alex CV.pdf" },
    cover: { pdfUrl: null, pdfName: "Alex CL.pdf" },
  },
  job: {
    id: JOB_ID,
    title: "Platform Engineer",
    company: "Lumi",
    location: "Sydney",
    market: "AU",
  },
};

function job(
  applicationId: string | null = null,
  market: string | null = null,
): JobItem {
  return {
    id: JOB_ID,
    title: "Platform Engineer",
    company: "Lumi",
    location: "Sydney",
    jobUrl: "https://example.com/job",
    status: "NEW",
    market,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    applicationId,
  } as JobItem;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Harness({
  applicationId,
  market,
}: {
  applicationId: string | null;
  market: string | null;
}) {
  const controller = useTailorReviewController();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          controller.openTailorDialog(job(applicationId, market), "resume")
        }
      >
        open
      </button>
      <TailorDialog
        job={controller.session?.job ?? null}
        initialTarget={controller.session?.target ?? "resume"}
        draft={controller.draft}
        draftLoading={controller.draftLoading}
        draftError={controller.draftError}
        onOpenChange={(open) => {
          if (!open) controller.cancelTailorDialog();
        }}
        onImported={controller.handleImported}
        onFinalized={controller.handleFinalized}
      />
    </>
  );
}

function renderHarness(
  applicationId: string | null = null,
  market: string | null = null,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>
        <Harness applicationId={applicationId} market={market} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

/** Session routes and the installed companion share a durable task receipt. */
function stubRoutes(options: { running?: boolean; completed?: boolean; currentDraft?: boolean; currentPdfUrl?: string } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let finalized = !!options.completed;
  const task = () => ({
    taskId: "task-1", jobId: JOB_ID, target: "resume", attempt: 1, maxAttempts: 3,
    status: finalized ? "completed" : "generating",
    ...(finalized ? { result: { applicationId: APPLICATION_ID, aiContentHash: "content-hash", resumePdfUrl: "https://example.com/final-cv.pdf", resumePdfName: "Alex CV.pdf" } } : {}),
  });
  let exists = !!options.completed;
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    if (url.endsWith("/pair")) return json({ protocolVersion: 1, account: "a".repeat(64), token: "paired" });
    if (url.endsWith("/status")) return json({ protocolVersion: 1, runtime: { state: "ready" }, auth: { state: "ready" } });
    if (url === "/api/local-tailoring/tasks" && init?.method === "POST") {
      exists = true;
      return json({ taskId: "task-1", capability: "one-task", expiresAt: "2026-09-06T10:00:00Z", prompt: { instructions: "instructions", input: "input" } });
    }
    if (url === "http://127.0.0.1:8791/tasks" && init?.method === "POST") { finalized = !options.running; return json({ task: task() }); }
    if (url.startsWith("/api/local-tailoring/tasks?")) return json({ task: exists ? task() : null });
    if (url.includes("127.0.0.1") && url.includes("/tasks?")) return json({ tasks: exists ? [task()] : [] });

    if (url.includes("/finalize")) {
      finalized = true;
      return json({
        status: "FINAL",
        publication: PUBLICATION_FINAL,
        aiContentHash: "content-hash",
        resumePdfUrl: "https://example.com/final-cv.pdf",
        resumePdfName: "Alex CV.pdf",
      });
    }

    if (url.includes("/review-snapshot")) {
      return json(
        finalized && !options.currentDraft
          ? {
              ...SNAPSHOT,
              publication: PUBLICATION_FINAL,
              documents: {
                resume: {
                  pdfUrl: options.currentPdfUrl ?? "https://example.com/final-cv.pdf",
                  pdfName: "Alex CV.pdf",
                },
                cover: { pdfUrl: null, pdfName: "Alex CL.pdf" },
              },
            }
          : SNAPSHOT,
      );
    }

    return json({ error: { code: "NOT_MOCKED", message: "not mocked" } }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function generateButton() {
  return screen.getByRole("button", {
    name: messages.tailor.dialog.generateLocally,
  });
}

/** Open the dialog on a job that already carries a saved draft. */
async function openSavedDraft(user: ReturnType<typeof userEvent.setup>) {
  const calls = stubRoutes();
  renderHarness(APPLICATION_ID);
  await user.click(screen.getByRole("button", { name: "open" }));
  await screen.findByText(messages.tailor.summary.title);
  return calls;
}

describe("TailorDialog", () => {
  beforeEach(() => {
    guide.markTaskComplete.mockReset();
    localStorage.clear();
    pairingToken("a".repeat(64), "paired");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps connecting and generating separate and loads the completed PDF receipt", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    const calls = stubRoutes();
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByRole("button", { name: messages.tailor.companion.connect })).toBeEnabled());
    expect(generateButton()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: messages.tailor.companion.connect }));
    await waitFor(() => expect(generateButton()).toBeEnabled());
    expect(calls.some((call) => call.url === "/api/local-tailoring/tasks")).toBe(false);
    await user.click(generateButton());
    expect(await screen.findByRole("link", { name: messages.tailor.dialog.openPdf })).toHaveAttribute("href", "https://example.com/final-cv.pdf");
    expect(calls.some((call) => call.url.includes("manual-generate") || call.url.includes("/finalize"))).toBe(false);
  });

  it("recovers a completed task on reopen without launching another generation", async () => {
    const user = userEvent.setup();
    const calls = stubRoutes({ completed: true });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByRole("link", { name: messages.tailor.dialog.openPdf })).toBeInTheDocument();
    expect(calls.some((call) => call.init?.method === "POST")).toBe(false);
  });

  it("does not use an old completed receipt to mark a newer saved draft as published", async () => {
    const user = userEvent.setup();
    const calls = stubRoutes({ completed: true, currentDraft: true });
    renderHarness(APPLICATION_ID);
    await user.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByLabelText(messages.tailor.summary.aria)).toHaveValue(SUMMARY);
    expect(screen.queryByText(messages.tailor.dialog.publishedSummary)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: messages.tailor.dialog.openPdf })).not.toBeInTheDocument();
    expect(calls.filter((call) => call.url.includes("/review-snapshot"))).toHaveLength(1);
  });

  it("uses the current snapshot PDF instead of a historical task's PDF URL", async () => {
    const user = userEvent.setup();
    stubRoutes({ completed: true, currentPdfUrl: "https://example.com/newer-cv.pdf" });
    renderHarness(APPLICATION_ID);
    await user.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByRole("link", { name: messages.tailor.dialog.openPdf })).toHaveAttribute("href", "https://example.com/newer-cv.pdf");
  });

  it("lists review and publish as inert rows before anything is generated", async () => {
    const user = userEvent.setup();
    stubRoutes();
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(messages.tailor.dialog.stepReviewTitle)).toBeInTheDocument();
    expect(dialog.getByText(messages.tailor.dialog.stepPublishTitle)).toBeInTheDocument();
    // Listed, not reachable: neither expands and neither body leaks out.
    expect(
      dialog.queryByRole("button", { name: messages.tailor.dialog.stepReviewTitle }),
    ).not.toBeInTheDocument();
    expect(
      dialog.queryByRole("button", { name: messages.tailor.dialog.stepPublishTitle }),
    ).not.toBeInTheDocument();
    expect(
      dialog.queryByRole("button", { name: messages.tailor.dialog.finalize }),
    ).not.toBeInTheDocument();
  });

  it("opens a saved draft straight on the review step", async () => {
    const user = userEvent.setup();
    await openSavedDraft(user);

    expect(screen.getByLabelText(messages.tailor.summary.aria)).toHaveValue(SUMMARY);
    expect(
      screen.getByRole("button", { name: "Remove TypeScript" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Add Kubernetes" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("publishes a saved draft from the Publish phase", async () => {
    const user = userEvent.setup();
    const calls = await openSavedDraft(user);

    expect(
      screen.queryByText(messages.tailor.dialog.stepPublishBody),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: messages.tailor.dialog.stepPublishTitle }),
    );
    expect(
      await screen.findByText(messages.tailor.dialog.stepPublishBody),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: messages.tailor.dialog.finalize }),
    );

    expect(
      await screen.findByRole("link", { name: messages.tailor.dialog.openPdf }),
    ).toHaveAttribute("href", "https://example.com/final-cv.pdf");
    expect(
      calls.some((call) => call.url.includes("/finalize?target=resume")),
    ).toBe(true);
  });

  it("re-expands the review phase from its collapsed row", async () => {
    const user = userEvent.setup();
    await openSavedDraft(user);

    await user.click(
      screen.getByRole("button", { name: messages.tailor.dialog.stepPublishTitle }),
    );
    expect(
      screen.queryByLabelText(messages.tailor.summary.aria),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: messages.tailor.dialog.stepReviewTitle }),
    );
    expect(
      await screen.findByLabelText(messages.tailor.summary.aria),
    ).toBeInTheDocument();
  });

  it("moves a skill between the selection and the remaining bank", async () => {
    const user = userEvent.setup();
    await openSavedDraft(user);

    await user.click(screen.getByRole("button", { name: "Add Go" }));

    expect(
      await screen.findByRole("button", { name: "Remove Go" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(messages.tailor.skills.resetSelection),
    ).toBeInTheDocument();
  });

  it("keeps review and publish inert for a target with nothing generated yet", async () => {
    const user = userEvent.setup();
    await openSavedDraft(user);

    await user.click(screen.getByRole("tab", { name: messages.tailor.docCover }));

    const dialog = within(screen.getByRole("dialog"));
    // The generate button follows the tab; the phases below it stay listed.
    expect(dialog.getByRole("button", { name: messages.tailor.dialog.generateLocally }))
      .toBeInTheDocument();
    expect(
      dialog.queryByRole("button", { name: messages.tailor.dialog.stepReviewTitle }),
    ).not.toBeInTheDocument();
    expect(
      dialog.queryByRole("button", { name: messages.tailor.dialog.finalize }),
    ).not.toBeInTheDocument();
  });
});


describe("TailorDialog interaction protection", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("allows closing during generation without cancelling the independent task", async () => {
    const user = userEvent.setup();
    pairingToken("a".repeat(64), "paired");
    const calls = stubRoutes({ running: true });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(generateButton()).toBeEnabled());
    await user.click(generateButton());
    expect(await screen.findByRole("button", { name: messages.tailor.companion.cancel })).toBeEnabled();
    expect(screen.getByText(messages.tailor.companion.closeSafe)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith("/cancel"))).toBe(false);
  });

  it("flushes pending edits before closing", async () => {
    const user = userEvent.setup();
    const calls = await openSavedDraft(user);
    const originalFetch = globalThis.fetch;
    let resolveSave!: (response: Response) => void;
    let savedBody = "";
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo, init?: RequestInit) => {
      if (String(input).endsWith("/draft")) {
        savedBody = String(init?.body);
        return new Promise<Response>((resolve) => { resolveSave = resolve; });
      }
      return originalFetch(input, init);
    }));
    await user.click(screen.getByRole("button", { name: "Add Go" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(JSON.parse(savedBody).aiContent.cv.skillsSelection.userSelection).toBeDefined();
    resolveSave(json({ aiContentHash: "saved-hash", publication: PUBLICATION_DRAFT }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.some((call) => call.url.includes("/finalize"))).toBe(false);
  });

  it("keeps edits visible if closing cannot save them", async () => {
    const user = userEvent.setup();
    await openSavedDraft(user);
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "SAVE_FAILED", message: "Save unavailable" } }, 503)));
    await user.click(screen.getByRole("button", { name: "Add Go" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Go" })).toBeInTheDocument();
  });
});
