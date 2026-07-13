import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { TailorReviewDialog, type TailorReviewDraft } from "./TailorReviewDialog";

const aiContent: AiContent = {
  schemaVersion: 1,
  generatedAt: "2026-07-11T00:00:00.000Z",
  promptMetaHash: "sha256:test",
  cv: {
    summary: { aiText: "Summary", originalText: "Original", accepted: true },
    latestExperience: { experienceIndex: 0, addedBullets: [] },
    skillsAdditions: [],
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

type MockDraft = {
  aiContent: AiContent;
  setAiContent: ReturnType<typeof vi.fn>;
  saveStatus:
    | { kind: "error"; message: string; conflict: true }
    | { kind: "saved"; at: number };
  flushNow: ReturnType<typeof vi.fn>;
  replaceFromServer: ReturnType<typeof vi.fn>;
  currentHash: string;
};

let mockDraft: MockDraft;

vi.mock("../[id]/tailor/useTailorDraft", () => ({
  useTailorDraft: () => mockDraft,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));

vi.mock("../[id]/tailor/SummarySection", () => ({ SummarySection: () => null }));
vi.mock("../[id]/tailor/BulletsSection", () => ({ BulletsSection: () => null }));
vi.mock("../[id]/tailor/SkillsSection", () => ({ SkillsSection: () => null }));
vi.mock("../[id]/tailor/CoverParagraphsSection", () => ({ CoverParagraphsSection: () => null }));
vi.mock("../[id]/tailor/PdfPreview", () => ({ PdfPreview: () => null }));
vi.mock("../[id]/tailor/SaveIndicator", () => ({ SaveIndicator: () => null }));
vi.mock("../[id]/tailor/ConflictDialog", () => ({
  ConflictDialog: () => <div data-testid="conflict-dialog" />,
}));

function makeDraft(saveStatus: MockDraft["saveStatus"]): MockDraft {
  return {
    aiContent,
    setAiContent: vi.fn(),
    saveStatus,
    flushNow: vi.fn().mockResolvedValue("hash"),
    replaceFromServer: vi.fn(),
    currentHash: "hash",
  };
}

const draft: TailorReviewDraft = {
  applicationId: "application-1",
  target: "resume",
  initialStatus: "DRAFT",
  initialAiContent: aiContent,
  initialAiContentHash: "hash",
  resumePdfUrl: "/resume.pdf",
  coverPdfUrl: "/cover.pdf",
  job: {
    id: "job-1",
    title: "Engineer",
    company: "Joblit",
    location: "Sydney",
  },
};

describe("TailorReviewDialog React rules", () => {
  beforeEach(() => {
    mockDraft = makeDraft({
      kind: "error",
      message: "This can be any localized conflict message",
      conflict: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not read the clock during render", () => {
    const nowSpy = vi.spyOn(Date, "now");

    render(
      <TailorReviewDialog
        open
        draft={draft}
        onOpenChange={vi.fn()}
        onFinalized={vi.fn()}
      />,
    );

    expect(nowSpy).not.toHaveBeenCalled();
  });

  it("derives the conflict dialog from the current save status", () => {
    const view = render(
      <TailorReviewDialog
        open
        draft={draft}
        onOpenChange={vi.fn()}
        onFinalized={vi.fn()}
      />,
    );
    expect(screen.getByTestId("conflict-dialog")).toBeInTheDocument();

    mockDraft = makeDraft({ kind: "saved", at: 1 });
    view.rerender(
      <TailorReviewDialog
        open
        draft={draft}
        onOpenChange={vi.fn()}
        onFinalized={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("conflict-dialog")).not.toBeInTheDocument();
  });
});
