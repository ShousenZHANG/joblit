import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { TailorClient } from "./TailorClient";

const aiContent: AiContent = {
  schemaVersion: 1,
  generatedAt: "2026-07-11T00:00:00.000Z",
  promptMetaHash: "sha256:test",
  cv: {
    summary: { aiText: "Summary", originalText: "Original" },
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

vi.mock("./useTailorDraft", () => ({
  useTailorDraft: () => mockDraft,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogAction: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("./SummarySection", () => ({ SummarySection: () => null }));
vi.mock("./BulletsSection", () => ({ BulletsSection: () => null }));
vi.mock("./SkillsSection", () => ({ SkillsSection: () => null }));
vi.mock("./CoverParagraphsSection", () => ({ CoverParagraphsSection: () => null }));
vi.mock("./PdfPreview", () => ({ PdfPreview: () => null }));
vi.mock("./SaveIndicator", () => ({ SaveIndicator: () => null }));
vi.mock("./ConflictDialog", () => ({
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

const props = {
  applicationId: "application-1",
  initialStatus: "DRAFT" as const,
  initialAiContent: aiContent,
  initialAiContentHash: "hash",
  resumePdfUrl: "/resume.pdf",
  coverPdfUrl: "/cover.pdf",
  job: {
    id: "job-1",
    title: "Engineer",
    company: "Joblit",
    location: "Sydney",
    market: "AU",
  },
};

describe("TailorClient React rules", () => {
  beforeEach(() => {
    mockDraft = makeDraft({
      kind: "error",
      message: "Another tab changed this draft",
      conflict: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not read the clock during render", () => {
    const nowSpy = vi.spyOn(Date, "now");

    render(<TailorClient {...props} />);

    expect(nowSpy).not.toHaveBeenCalled();
  });

  it("derives the conflict dialog from the current save status", () => {
    const { rerender } = render(<TailorClient {...props} />);
    expect(screen.getByTestId("conflict-dialog")).toBeInTheDocument();

    mockDraft = makeDraft({ kind: "saved", at: 1 });
    rerender(<TailorClient {...props} />);

    expect(screen.queryByTestId("conflict-dialog")).not.toBeInTheDocument();
  });
});
