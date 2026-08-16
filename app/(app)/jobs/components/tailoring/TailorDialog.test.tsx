import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

async function openReviewStep(user: ReturnType<typeof userEvent.setup>) {
  const calls = stubRoutes();
  renderHarness();
  await user.click(screen.getByRole("button", { name: "open" }));
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
  beforeEach(() => guide.markTaskComplete.mockReset());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps Import inert until the paste parses against the current contract", async () => {
    const user = userEvent.setup();
    stubRoutes();
    renderHarness();
    await user.click(screen.getByRole("button", { name: "open" }));

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

  it("says the PDF only exists after publishing, and links it once it does", async () => {
    const user = userEvent.setup();
    const calls = await openReviewStep(user);

    expect(
      screen.getByText(messages.tailor.dialog.stepPublishBody),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: messages.tailor.dialog.openPdf }),
    ).not.toBeInTheDocument();

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

  it("locks review for a target that has nothing generated yet", async () => {
    const user = userEvent.setup();
    await openReviewStep(user);

    await user.click(
      screen.getByRole("tab", { name: messages.tailor.docCover }),
    );

    const dialog = within(screen.getByRole("dialog"));
    expect(
      dialog.getByText(messages.tailor.dialog.stepReviewLocked),
    ).toBeInTheDocument();
    expect(
      dialog.queryByRole("button", { name: messages.tailor.dialog.finalize }),
    ).not.toBeInTheDocument();
  });
});
