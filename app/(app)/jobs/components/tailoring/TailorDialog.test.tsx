import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guide = vi.hoisted(() => ({ markTaskComplete: vi.fn() }));
vi.mock("@/app/GuideContext", () => ({
  useGuide: () => ({ markTaskComplete: guide.markTaskComplete }),
}));

import messages from "@/messages/en.json";
import { parseResumeManualOutput } from "@/lib/server/applications/manualImportParser";
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

/**
 * Serves NDJSON the way the sidecar does: one event per line. jsdom has no
 * `ReadableStream`, so this borrows Node's — the client only calls
 * `getReader()`, which both implementations share.
 */
function ndjson(events: unknown[]): Response {
  const body = new NodeReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

/** The raw model shape the import boundary parses — what the sidecar returns. */
const RAW_OUTPUT = JSON.stringify({
  cvSummary: SUMMARY,
  skillsSelection: [{ group: 0, items: [0] }],
});

const GENERATED = [
  { phase: "generate", attempt: 1, of: 3 },
  { phase: "done", ok: true, attempts: 1, rawOutput: RAW_OUTPUT, aiContent: AI_CONTENT },
];

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

/**
 * App routes only. The sidecar lives off-origin and every test that needs it
 * layers its own stream on top, so a call to 127.0.0.1 that reaches here is a
 * test that forgot to.
 */
function stubRoutes(options: { finalizeFails?: boolean; importFails?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let finalized = false;
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });

    if (url.includes("127.0.0.1")) return ndjson(GENERATED);

    if (url.startsWith("/api/applications/manual-generate")) {
      if (options.importFails) {
        return json(
          { error: { code: "SUMMARY_TOO_SHORT", message: "Summary too short" } },
          422,
        );
      }
      return json({
        applicationId: APPLICATION_ID,
        status: "DRAFT",
        publication: PUBLICATION_DRAFT,
        aiContentHash: "content-hash",
        aiContent: AI_CONTENT,
        pdfName: null,
        job: {
          id: JOB_ID,
          title: "Platform Engineer",
          company: "Lumi",
          location: "Sydney",
        },
      });
    }

    if (url.includes("/finalize")) {
      if (options.finalizeFails) {
        return json(
          { error: { code: "RENDER_FAILED", message: "LaTeX render failed" } },
          502,
        );
      }
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
        finalized
          ? {
              ...SNAPSHOT,
              publication: PUBLICATION_FINAL,
              documents: {
                resume: {
                  pdfUrl: "https://example.com/final-cv.pdf",
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
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("one click generates, imports and publishes the PDF", async () => {
    const user = userEvent.setup();
    const calls = stubRoutes();
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));

    // The only action on the screen, reachable the moment the dialog opens —
    // buried in a collapsed step, one click quietly becomes several again.
    await user.click(generateButton());

    expect(
      await screen.findByRole("link", { name: messages.tailor.dialog.openPdf }),
    ).toHaveAttribute("href", "https://example.com/final-cv.pdf");
    expect(
      screen.getByText(messages.tailor.dialog.publishedSummary),
    ).toBeInTheDocument();

    expect(
      calls.some((call) =>
        call.url.startsWith("/api/applications/manual-generate"),
      ),
    ).toBe(true);
    const finalizeCall = calls.find((call) =>
      call.url.includes("/finalize?target=resume"),
    );
    // The CAS baseline travels straight from the import response.
    expect(JSON.parse(String(finalizeCall?.init?.body))).toEqual({
      expectedHash: "content-hash",
    });
  });

  // Generation runs from a sidecar that reads the current profile, so there is
  // no issued-prompt receipt to check the result against and none is claimed.
  it("imports without asserting prompt provenance it does not have", async () => {
    const user = userEvent.setup();
    const calls = stubRoutes();
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));
    await user.click(generateButton());
    await screen.findByRole("link", { name: messages.tailor.dialog.openPdf });

    const imported = calls.find((call) =>
      call.url.startsWith("/api/applications/manual-generate"),
    );
    expect(imported?.url).toContain("finalize=false");
    const body = JSON.parse(String(imported?.init?.body));
    expect(body).toEqual(
      expect.objectContaining({ jobId: JOB_ID, target: "resume", source: "manual_import" }),
    );
    expect(body).not.toHaveProperty("promptMeta");
    expect(
      calls.some((call) => call.url.startsWith("/api/applications/prompt")),
    ).toBe(false);

    // Contract, enforced with the production parser rather than a mock that
    // accepts anything: what the chain submits must be the RAW model shape.
    // This is the assertion that was missing when the chain shipped the
    // aiContent aggregate and every mocked test stayed green while the real
    // import refused it.
    expect(parseResumeManualOutput(body.modelOutput).data).not.toBeNull();
    expect(body.modelOutput).toBe(RAW_OUTPUT);
  });

  it("falls back to the review step when publishing fails after import", async () => {
    const user = userEvent.setup();
    stubRoutes({ finalizeFails: true });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));
    await user.click(generateButton());

    // The imported draft is stored and editable; nothing claims to be published.
    expect(
      await screen.findByLabelText(messages.tailor.summary.aria),
    ).toHaveValue(SUMMARY);
    expect(
      screen.queryByText(messages.tailor.dialog.publishedSummary),
    ).not.toBeInTheDocument();
  });

  // The server resolves the resume profile from the job's market. Letting the
  // sidecar default to en-AU would have it choose skills by index against a
  // different bank than the one the import validates against — for a CN job
  // that publishes skills the candidate never picked.
  it.each([
    ["CN", "zh-CN"],
    ["AU", "en-AU"],
    [null, "en-AU"],
  ])("generates a %s job against the %s profile", async (market, locale) => {
    const user = userEvent.setup();
    const calls = stubRoutes();
    renderHarness(null, market);
    await user.click(screen.getByRole("button", { name: "open" }));
    await user.click(generateButton());
    await screen.findByRole("link", { name: messages.tailor.dialog.openPdf });

    const generate = calls.find((call) => call.url.includes("127.0.0.1"));
    expect(JSON.parse(String(generate?.init?.body))).toEqual(
      expect.objectContaining({ jobId: JOB_ID, target: "resume", locale }),
    );
  });

  // Most import refusals are transient — a rate limit, a blob hiccup. Re-running
  // the model to clear one would cost another minute and another slice of quota.
  it("retries a refused import without re-running the model", async () => {
    const user = userEvent.setup();
    let refuse = true;
    const calls: { url: string; init?: RequestInit }[] = [];
    const base = (() => {
      stubRoutes();
      return globalThis.fetch as typeof fetch;
    })();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        calls.push({ url, init });
        if (url.startsWith("/api/applications/manual-generate") && refuse) {
          refuse = false;
          return json(
            { error: { code: "RATE_LIMITED", message: "Too many requests" } },
            429,
          );
        }
        return base(input, init);
      }),
    );
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));
    await user.click(generateButton());
    await screen.findByText(/Too many requests/);

    await user.click(
      screen.getByRole("button", {
        name: messages.tailor.dialog.generateRetryImport,
      }),
    );

    expect(
      await screen.findByRole("link", { name: messages.tailor.dialog.openPdf }),
    ).toBeInTheDocument();
    // Two imports, one generation: the retry reused the result already in hand.
    expect(
      calls.filter((c) => c.url.startsWith("/api/applications/manual-generate")),
    ).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes("127.0.0.1"))).toHaveLength(1);
  });

  // There is no paste box to park a refused result in any more, so the panel
  // has to hand the work back rather than drop it.
  it("offers the generated JSON back when the server refuses the import", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    stubRoutes({ importFails: true });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));
    await user.click(generateButton());

    expect(await screen.findByText(/Summary too short/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: messages.tailor.dialog.generateCopyOutput,
      }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RAW_OUTPUT));
  });

  // The local generator is a separate process someone has to start, so a
  // refused connection needs its own instruction rather than a raw error.
  it("tells the user how to start the local generator when it is unreachable", async () => {
    const user = userEvent.setup();
    stubRoutes();
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));

    const appFetch = globalThis.fetch as typeof fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("127.0.0.1")) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return appFetch(input, init);
      }),
    );

    await user.click(generateButton());

    expect(
      await screen.findByText(messages.tailor.dialog.generatorOffline),
    ).toBeInTheDocument();
    // Nothing was generated, so there is nothing to hand back.
    expect(
      screen.queryByRole("button", {
        name: messages.tailor.dialog.generateCopyOutput,
      }),
    ).not.toBeInTheDocument();
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
