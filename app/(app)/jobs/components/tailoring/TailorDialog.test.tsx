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
import { TailorDialog } from "./TailorDialog";
import { useTailorReviewController } from "../../hooks/useTailorReviewController";
import type { JobItem } from "../../types";

const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const SUMMARY =
  "Grounded platform engineer with eight years across Kubernetes, Go and TypeScript, shipping serverless data pipelines for Australian fintechs and holding full working rights.";

const RESUME_PASTE = JSON.stringify({
  cvSummary: SUMMARY,
  skillsSelection: [{ group: 0, items: [0] }],
});

const PUBLICATION_DRAFT = {
  status: "DRAFT",
  resume: {
    status: "DRAFT",
    contentHash: "resume-content",
    publishedHash: null,
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

function job(): JobItem {
  return {
    id: JOB_ID,
    title: "Platform Engineer",
    company: "Lumi",
    location: "Sydney",
    jobUrl: "https://example.com/job",
    status: "NEW",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    applicationId: null,
  } as JobItem;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PUBLICATION_FINAL = {
  status: "FINAL",
  resume: {
    status: "FINAL",
    contentHash: "resume-content",
    publishedHash: "resume-content",
  },
  cover: { status: "MISSING", contentHash: null, publishedHash: null },
};

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

function Harness() {
  const controller = useTailorReviewController();
  return (
    <>
      <button type="button" onClick={() => controller.openTailorDialog(job(), "resume")}>
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

function renderHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

function stubRoutes() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    if (url.startsWith("/api/applications/prompt")) {
      return json({
        prompt: { systemPrompt: "system", userPrompt: "user" },
        promptMeta: {
          ruleSetId: "rules-1",
          resumeSnapshotUpdatedAt: "2026-08-01T00:00:00.000Z",
        },
      });
    }
    if (url.startsWith("/api/prompt-rules/skill-pack")) {
      return new Response(new Blob(["skill-pack"]), {
        status: 200,
        headers: {
          "content-disposition": 'attachment; filename="joblit-skills-v3.zip"',
        },
      });
    }
    if (url.startsWith("/api/applications/manual-generate")) {
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
    if (url.includes("/review-snapshot")) return json(SNAPSHOT);
    if (url.includes("/finalize")) {
      return json({
        status: "FINAL",
        publication: {
          status: "FINAL",
          resume: {
            status: "FINAL",
            contentHash: "resume-content",
            publishedHash: "resume-content",
          },
          cover: { status: "MISSING", contentHash: null, publishedHash: null },
        },
        aiContentHash: "content-hash",
        resumePdfUrl: "https://example.com/final-cv.pdf",
        resumePdfName: "Alex CV.pdf",
      });
    }
    return json({ error: { code: "NOT_MOCKED", message: "not mocked" } }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

async function openPasteStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "open" }));
  await user.click(
    await screen.findByRole("button", {
      name: messages.tailor.dialog.stepPasteTitle,
    }),
  );
}

async function openReviewStep(user: ReturnType<typeof userEvent.setup>) {
  const calls = stubRoutes();
  renderHarness();
  await openPasteStep(user);
  const textarea = await screen.findByLabelText(
    messages.tailor.dialog.pasteLabel,
  );
  await user.click(textarea);
  await user.paste(RESUME_PASTE);
  await user.click(
    screen.getByRole("button", { name: messages.tailor.dialog.importResult }),
  );
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

  it("keeps Import inert until the paste parses against the current contract", async () => {
    const user = userEvent.setup();
    stubRoutes();
    renderHarness();
    await openPasteStep(user);

    const importButton = await screen.findByRole("button", {
      name: messages.tailor.dialog.importResult,
    });
    expect(importButton).toBeDisabled();

    const textarea = await screen.findByLabelText(
      messages.tailor.dialog.pasteLabel,
    );
    await user.click(textarea);
    await user.paste('{ "cvSummary": "too short" }');
    expect(
      await screen.findByText(messages.tailor.dialog.parseInvalid),
    ).toBeInTheDocument();
    expect(importButton).toBeDisabled();

    await user.clear(textarea);
    await user.paste(RESUME_PASTE);
    expect(
      await screen.findByText(messages.tailor.dialog.parseValid),
    ).toBeInTheDocument();
    await waitFor(() => expect(importButton).toBeEnabled());
  });

  it("imports a pasted result and re-reads the snapshot to reach the review step", async () => {
    const user = userEvent.setup();
    const calls = await openReviewStep(user);

    const imported = calls.find((call) =>
      call.url.startsWith("/api/applications/manual-generate"),
    );
    expect(imported?.url).toContain("finalize=false");
    expect(JSON.parse(String(imported?.init?.body))).toEqual(
      expect.objectContaining({ jobId: JOB_ID, target: "resume", source: "manual_import" }),
    );
    // The bank only travels with the snapshot, so review is unreachable until
    // it has been re-read.
    expect(
      calls.some((call) => call.url.includes("/review-snapshot")),
    ).toBe(true);

    expect(
      screen.getByLabelText(messages.tailor.summary.aria),
    ).toHaveValue(SUMMARY);
    expect(
      screen.getByRole("button", { name: "Remove TypeScript" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Add Kubernetes" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("renders phases beyond the current one as quiet title-only rows", async () => {
    const user = userEvent.setup();
    stubRoutes();
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));

    const dialog = within(screen.getByRole("dialog"));
    expect(
      await dialog.findByRole("button", {
        name: messages.tailor.dialog.copyPrompt,
      }),
    ).toBeInTheDocument();

    // No bodies leak out of the collapsed phases.
    expect(
      dialog.queryByLabelText(messages.tailor.dialog.pasteLabel),
    ).not.toBeInTheDocument();
    expect(
      dialog.queryByText(messages.tailor.dialog.stepPublishBody),
    ).not.toBeInTheDocument();
    expect(
      dialog.queryByRole("button", { name: messages.tailor.dialog.finalize }),
    ).not.toBeInTheDocument();

    // Paste is reachable ahead of time; review and publish are inert until an
    // import gives them something to act on.
    expect(
      dialog.getByRole("button", { name: messages.tailor.dialog.stepPasteTitle }),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(messages.tailor.dialog.stepReviewTitle),
    ).toBeInTheDocument();
    expect(
      dialog.queryByRole("button", {
        name: messages.tailor.dialog.stepReviewTitle,
      }),
    ).not.toBeInTheDocument();
    expect(
      dialog.getByText(messages.tailor.dialog.stepPublishTitle),
    ).toBeInTheDocument();
    expect(
      dialog.queryByRole("button", {
        name: messages.tailor.dialog.stepPublishTitle,
      }),
    ).not.toBeInTheDocument();
  });

  it("collapses Paste and expands Review after a successful import", async () => {
    const user = userEvent.setup();
    await openReviewStep(user);

    expect(
      screen.queryByLabelText(messages.tailor.dialog.pasteLabel),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(messages.tailor.dialog.importedSummary),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(messages.tailor.summary.aria),
    ).toBeInTheDocument();
  });

  it("re-expands a completed phase from its collapsed row and collapses the current one", async () => {
    const user = userEvent.setup();
    await openReviewStep(user);

    await user.click(
      screen.getByRole("button", {
        name: new RegExp(messages.tailor.dialog.stepPasteTitle),
      }),
    );
    expect(
      await screen.findByLabelText(messages.tailor.dialog.pasteLabel),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(messages.tailor.summary.aria),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: messages.tailor.dialog.stepReviewTitle }),
    );
    expect(
      await screen.findByLabelText(messages.tailor.summary.aria),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(messages.tailor.dialog.pasteLabel),
    ).not.toBeInTheDocument();
  });

  it("copies as soon as the in-flight prompt build resolves", async () => {
    const user = userEvent.setup();
    let openPromptGate!: () => void;
    const promptGate = new Promise<void>((resolve) => {
      openPromptGate = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/applications/prompt")) {
        await promptGate;
        return json({
          prompt: { systemPrompt: "system", userPrompt: "user" },
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-08-01T00:00:00.000Z",
          },
        });
      }
      return json({ error: { code: "NOT_MOCKED", message: "not mocked" } }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));

    // Never a dead "preparing" state: the copy label is live from frame one.
    const copyButton = screen.getByRole("button", {
      name: messages.tailor.dialog.copyPrompt,
    });
    expect(copyButton).toBeEnabled();
    await user.click(copyButton);
    expect(
      screen.queryByLabelText(messages.tailor.dialog.pasteLabel),
    ).not.toBeInTheDocument();

    openPromptGate();

    // The copy lands once the build resolves: the copy phase collapses to its
    // "Copied" receipt and paste opens up ready for the answer.
    expect(
      await screen.findByLabelText(messages.tailor.dialog.pasteLabel),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: new RegExp(`^${messages.tailor.dialog.stepPromptTitle}`),
      }),
    ).toHaveTextContent(messages.tailor.dialog.copied);
    await expect(navigator.clipboard.readText()).resolves.toContain(
      "SYSTEM INSTRUCTIONS START",
    );
  });

  it("downloads the skill pack from the footer link only when clicked", async () => {
    const user = userEvent.setup();
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:skill-pack");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const calls = stubRoutes();
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));

    expect(
      calls.some((call) => call.url.startsWith("/api/prompt-rules/skill-pack")),
    ).toBe(false);

    await user.click(
      screen.getByRole("button", { name: messages.tailor.dialog.skillPackLink }),
    );

    await waitFor(() => expect(anchorClickSpy).toHaveBeenCalled());
    expect(
      calls.some((call) =>
        call.url.startsWith("/api/prompt-rules/skill-pack?locale=en-AU"),
      ),
    ).toBe(true);
    expect(createObjectUrlSpy).toHaveBeenCalled();
  });

  it("publishes from the Publish phase and collapses it to a published receipt", async () => {
    const user = userEvent.setup();
    const calls = await openReviewStep(user);

    expect(
      screen.queryByText(messages.tailor.dialog.stepPublishBody),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: messages.tailor.dialog.openPdf }),
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
      screen.getByText(messages.tailor.dialog.publishedSummary),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(messages.tailor.summary.aria),
    ).not.toBeInTheDocument();
    expect(
      calls.some((call) => call.url.includes("/finalize?target=resume")),
    ).toBe(true);
  });

  it("moves a skill between the selection and the remaining bank", async () => {
    const user = userEvent.setup();
    await openReviewStep(user);

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
    await openReviewStep(user);

    await user.click(
      screen.getByRole("tab", { name: messages.tailor.docCover }),
    );

    const dialog = within(screen.getByRole("dialog"));
    expect(
      dialog.getByText(messages.tailor.dialog.stepReviewTitle),
    ).toBeInTheDocument();
    expect(
      dialog.queryByRole("button", {
        name: messages.tailor.dialog.stepReviewTitle,
      }),
    ).not.toBeInTheDocument();
    expect(
      dialog.queryByRole("button", { name: messages.tailor.dialog.finalize }),
    ).not.toBeInTheDocument();
  });

  // The local generator is a separate process someone has to start, so a
  // refused connection needs its own instruction rather than a raw error.
  it("tells the user how to start the local generator when it is unreachable", async () => {
    const user = userEvent.setup();
    stubRoutes();
    renderHarness();
    await openPasteStep(user);

    // stubRoutes answers app routes; the sidecar lives off-origin and is the
    // one call that genuinely cannot connect.
    const appFetch = globalThis.fetch as (
      input: RequestInfo,
      init?: RequestInit,
    ) => Promise<Response>;
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

    await user.click(
      screen.getByRole("button", {
        name: messages.tailor.dialog.generateLocally,
      }),
    );

    expect(
      await screen.findByText(messages.tailor.dialog.generatorOffline),
    ).toBeInTheDocument();
  });

  it("one click generates, imports and publishes the PDF", async () => {
    const user = userEvent.setup();
    const calls = stubRoutes();
    renderHarness();
    await openPasteStep(user);

    // The sidecar streams off-origin; app routes fall through to stubRoutes.
    // Snapshot reads that land after finalize see the published state, the way
    // the real snapshot would.
    const appFetch = globalThis.fetch as typeof fetch;
    let finalized = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("127.0.0.1")) {
          return ndjson([
            { phase: "generate", attempt: 1, of: 3 },
            { phase: "done", ok: true, attempts: 1, aiContent: AI_CONTENT },
          ]);
        }
        if (url.includes("/finalize")) finalized = true;
        if (url.includes("/review-snapshot") && finalized) {
          return json({
            ...SNAPSHOT,
            publication: PUBLICATION_FINAL,
            documents: {
              resume: {
                pdfUrl: "https://example.com/final-cv.pdf",
                pdfName: "Alex CV.pdf",
              },
              cover: { pdfUrl: null, pdfName: "Alex CL.pdf" },
            },
          });
        }
        return appFetch(input, init);
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: messages.tailor.dialog.generateLocally,
      }),
    );

    // The chain ends on the published receipt with the PDF link — no manual
    // import or publish click in between.
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

  it("falls back to the review step when publishing fails after import", async () => {
    const user = userEvent.setup();
    stubRoutes();
    renderHarness();
    await openPasteStep(user);

    const appFetch = globalThis.fetch as typeof fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("127.0.0.1")) {
          return ndjson([
            { phase: "done", ok: true, attempts: 1, aiContent: AI_CONTENT },
          ]);
        }
        if (url.includes("/finalize")) {
          return json(
            { error: { code: "RENDER_FAILED", message: "LaTeX render failed" } },
            502,
          );
        }
        return appFetch(input, init);
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: messages.tailor.dialog.generateLocally,
      }),
    );

    // The imported draft still lands on review, and nothing claims to be
    // published.
    expect(
      await screen.findByLabelText(messages.tailor.summary.aria),
    ).toHaveValue(SUMMARY);
    expect(
      screen.queryByText(messages.tailor.dialog.publishedSummary),
    ).not.toBeInTheDocument();
  });

  it("keeps the generated JSON in the paste box when the server refuses the import", async () => {
    const user = userEvent.setup();
    stubRoutes();
    renderHarness();
    await openPasteStep(user);

    const appFetch = globalThis.fetch as typeof fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("127.0.0.1")) {
          return ndjson([
            { phase: "done", ok: true, attempts: 1, aiContent: AI_CONTENT },
          ]);
        }
        if (url.startsWith("/api/applications/manual-generate")) {
          return json(
            { error: { code: "SUMMARY_TOO_SHORT", message: "Summary too short" } },
            422,
          );
        }
        return appFetch(input, init);
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: messages.tailor.dialog.generateLocally,
      }),
    );

    // Nothing is lost: the JSON waits in the manual path next to the error.
    const textarea = await screen.findByLabelText(
      messages.tailor.dialog.pasteLabel,
    );
    await waitFor(() =>
      expect(textarea).toHaveValue(JSON.stringify(AI_CONTENT, null, 2)),
    );
    expect(await screen.findByText(/Summary too short/)).toBeInTheDocument();
  });
});
