import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { TailorClient } from "./TailorClient";

const aiContent: AiContent = {
  schemaVersion: 1,
  generatedAt: "2026-07-11T00:00:00.000Z",
  promptMetaHash: "sha256:test",
  cv: {
    summary: { aiText: "Summary", originalText: "Original", accepted: true },
    latestExperience: { experienceIndex: 0, addedBullets: [] },
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

const api = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}));
const router = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("./useTailorDraft", () => ({
  useTailorDraft: () => mockDraft,
}));

vi.mock("@/lib/api/fetchJson", () => ({
  fetchJson: api.fetchJson,
  ApiError: class ApiError extends Error {},
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogAction: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("./SummarySection", () => ({ SummarySection: () => null }));
vi.mock("./BulletsSection", () => ({ BulletsSection: () => null }));
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
  resumePdfName: "Jane Doe Engineer_CV.pdf",
  coverPdfName: "Jane Doe Engineer_CL.pdf",
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
    api.fetchJson.mockReset();
    router.push.mockReset();
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

  it("flushes pending edits before returning to jobs", async () => {
    mockDraft = makeDraft({ kind: "saved", at: 1 });
    render(<TailorClient {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "backToJobs" }));

    await waitFor(() => {
      expect(mockDraft.flushNow).toHaveBeenCalledOnce();
      expect(router.push).toHaveBeenCalledWith("/jobs");
    });
    expect(mockDraft.flushNow.mock.invocationCallOrder[0]).toBeLessThan(
      router.push.mock.invocationCallOrder[0],
    );
  });

  it("stays in the editor when saving before navigation fails", async () => {
    mockDraft = makeDraft({ kind: "saved", at: 1 });
    mockDraft.flushNow.mockRejectedValueOnce(new Error("Save failed"));
    render(<TailorClient {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "backToJobs" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("flushes and sends the current hash before discarding edits", async () => {
    mockDraft = makeDraft({ kind: "saved", at: 1 });
    mockDraft.flushNow.mockResolvedValueOnce("latest-hash");
    api.fetchJson.mockResolvedValueOnce({
      aiContent,
      aiContentHash: "reset-hash",
    });
    render(<TailorClient {...props} />);

    const discardButtons = screen.getAllByRole("button", {
      name: "discardChanges",
    });
    fireEvent.click(discardButtons.at(-1)!);

    await waitFor(() => {
      expect(api.fetchJson).toHaveBeenCalledWith(
        "/api/applications/application-1/discard",
        {
          method: "POST",
          body: JSON.stringify({ expectedHash: "latest-hash" }),
        },
      );
    });
    expect(mockDraft.flushNow.mock.invocationCallOrder[0]).toBeLessThan(
      api.fetchJson.mock.invocationCallOrder[0],
    );
    expect(mockDraft.replaceFromServer).toHaveBeenCalledWith(
      aiContent,
      "reset-hash",
    );
  });
});
