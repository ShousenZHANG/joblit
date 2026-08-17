import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/GuideContext", () => ({
  useGuide: () => ({ markTaskComplete: vi.fn() }),
}));

import messages from "@/messages/en.json";
import { TailorDialog } from "./TailorDialog";
import { useTailorReviewController } from "../../hooks/useTailorReviewController";
import type { JobItem } from "../../types";

/**
 * The dialog changes shape three times in one mount — locked, loading, editing —
 * and switches document under a live autosaving session. Each of those is a
 * chance to make a hook conditional, and React reports that as a console error
 * long before it becomes a visible bug.
 */

const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const SUMMARY =
  "Grounded platform engineer with eight years across Kubernetes, Go and TypeScript, shipping serverless data pipelines for Australian fintechs and holding full working rights.";

const PUBLICATION = {
  status: "DRAFT",
  resume: { status: "DRAFT", contentHash: "resume-content", publishedHash: null },
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
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
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
    applicationId: APPLICATION_ID,
  } as JobItem;
}

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function Harness() {
  const controller = useTailorReviewController();
  return (
    <>
      <button
        type="button"
        onClick={() => controller.openTailorDialog(job(), "resume")}
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

describe("TailorDialog React rules", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps hook order stable across loading, editing and target switches", async () => {
    const errors: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/review-snapshot")) {
          return json({
            applicationId: APPLICATION_ID,
            publication: PUBLICATION,
            aiContentHash: "content-hash",
            aiContent: AI_CONTENT,
            masterSkills: [{ category: "Languages", items: ["TypeScript"] }],
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
          });
        }
        return json({
          prompt: { systemPrompt: "system", userPrompt: "user" },
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-08-01T00:00:00.000Z",
          },
        });
      }),
    );

    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "open" }));
    await screen.findByText(messages.tailor.summary.title);
    await user.click(
      screen.getByRole("tab", { name: messages.tailor.docCover }),
    );
    // Cover has nothing imported, so its accordion opens on the copy phase.
    await screen.findByRole("button", {
      name: messages.tailor.dialog.copyPrompt,
    });
    // The resume tab carries a draft, so its status is part of its name.
    await user.click(
      screen.getByRole("tab", {
        name: new RegExp(`^${messages.tailor.docResume}`),
      }),
    );
    await screen.findByText(messages.tailor.summary.title);

    expect(
      errors.filter((entry) => /hook/i.test(String(entry[0]))),
    ).toEqual([]);
  });
});
