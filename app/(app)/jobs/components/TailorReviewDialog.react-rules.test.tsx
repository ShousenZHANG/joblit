import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
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

const api = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}));

vi.mock("../[id]/tailor/useTailorDraft", () => ({
  useTailorDraft: () => mockDraft,
}));

vi.mock("@/lib/api/fetchJson", () => ({
  fetchJson: api.fetchJson,
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
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
    api.fetchJson.mockReset();
    mockDraft = makeDraft({
      kind: "error",
      message: "This can be any localized conflict message",
      conflict: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it("aborts an in-flight preview when the dialog unmounts", async () => {
    vi.useFakeTimers();
    mockDraft = makeDraft({ kind: "saved", at: 1 });
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <TailorReviewDialog
        open
        draft={{ ...draft, resumePdfUrl: null }}
        onOpenChange={vi.fn()}
        onFinalized={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_400);
    });
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });

  it("does not automatically retry a failed preview and surfaces Retry-After", async () => {
    vi.useFakeTimers();
    mockDraft = makeDraft({ kind: "saved", at: 1 });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Preview is updating too quickly. Try again shortly.",
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "12",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TailorReviewDialog
        open
        draft={{ ...draft, resumePdfUrl: null }}
        onOpenChange={vi.fn()}
        onFinalized={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_400);
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Try again in 12 seconds.",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("flushes pending edits before closing the review", async () => {
    mockDraft = makeDraft({ kind: "saved", at: 1 });
    const onOpenChange = vi.fn();
    render(
      <TailorReviewDialog
        open
        draft={draft}
        onOpenChange={onOpenChange}
        onFinalized={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(mockDraft.flushNow).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("keeps the review open when the close-time save fails", async () => {
    mockDraft = makeDraft({ kind: "saved", at: 1 });
    mockDraft.flushNow.mockRejectedValueOnce(new Error("network offline"));
    const onOpenChange = vi.fn();
    render(
      <TailorReviewDialog
        open
        draft={draft}
        onOpenChange={onOpenChange}
        onFinalized={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("network offline");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("flushes pending edits before discarding them", async () => {
    mockDraft = makeDraft({ kind: "saved", at: 1 });
    api.fetchJson.mockResolvedValueOnce({
      aiContent,
      aiContentHash: "reset-hash",
    });
    render(
      <TailorReviewDialog
        open
        draft={draft}
        onOpenChange={vi.fn()}
        onFinalized={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(api.fetchJson).toHaveBeenCalledOnce();
      expect(mockDraft.replaceFromServer).toHaveBeenCalledWith(
        aiContent,
        "reset-hash",
      );
    });
    expect(api.fetchJson).toHaveBeenCalledWith(
      `/api/applications/${draft.applicationId}/discard`,
      {
        method: "POST",
        body: JSON.stringify({ expectedHash: "hash" }),
      },
    );
    expect(mockDraft.flushNow.mock.invocationCallOrder[0]).toBeLessThan(
      api.fetchJson.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
