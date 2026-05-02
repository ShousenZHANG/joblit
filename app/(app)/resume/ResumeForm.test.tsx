import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ResumeFormProvider } from "@/components/resume/ResumeContext";
import { ResumePageLayout } from "@/components/resume/ResumePageLayout";
import messages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

const guideMocks = vi.hoisted(() => ({
  isTaskHighlighted: vi.fn(() => false),
  markTaskComplete: vi.fn(),
}));

vi.mock("@/app/GuideContext", () => ({
  useGuide: () => ({
    isTaskHighlighted: guideMocks.isTaskHighlighted,
    markTaskComplete: guideMocks.markTaskComplete,
  }),
}));

vi.mock("@/components/resume/ResumePdfPreview", () => ({
  ResumePdfPreview: ({ pdfUrl }: { pdfUrl: string }) => (
    <div data-testid="resume-pdf-preview" data-pdf-url={pdfUrl} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  guideMocks.isTaskHighlighted.mockClear();
  guideMocks.markTaskComplete.mockClear();
});

function toUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function emptyProfileJson() {
  return {
    profile: null,
    profiles: [],
    activeProfile: null,
    activeProfileId: null,
  };
}

function mockEmptyProfileFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = toUrl(input);
    if (url.startsWith("/api/resume-profile")) {
      return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderResumePage(locale = "en", selectedMessages = messages) {
  return render(
    <NextIntlClientProvider locale={locale} messages={selectedMessages}>
      <div className="app-shell">
        <ResumeFormProvider>
          <ResumePageLayout />
        </ResumeFormProvider>
      </div>
    </NextIntlClientProvider>,
  );
}

async function fillBasics() {
  fireEvent.change(await screen.findByLabelText("Full name"), {
    target: { value: "Jane Doe" },
  });
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Software Engineer" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "jane@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Phone"), {
    target: { value: "+1 555 0100" },
  });
}

function firstButton(name: string) {
  return screen.getAllByRole("button", { name })[0];
}

function firstTab(name: string) {
  return screen.getAllByRole("tab", { name })[0];
}

describe("Resume page", () => {
  it("renders the production personal-info layout with disabled actions until content exists", async () => {
    mockEmptyProfileFetch();

    renderResumePage();

    expect(await screen.findByRole("heading", { name: "Personal info" })).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    screen
      .getAllByRole("button", { name: "Preview" })
      .forEach((button) => expect(button).toBeDisabled());
    screen
      .getAllByRole("button", { name: "Save selected resume" })
      .forEach((button) => expect(button).toBeDisabled());
  });

  it("uses the CN resume section order and CN-specific personal-info fields", async () => {
    mockEmptyProfileFetch();

    const { container } = renderResumePage("zh-CN", zhMessages);

    expect(
      await screen.findByRole("heading", { name: zhMessages.resumeForm.personalInfo }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: zhMessages.resumeForm.summary })).not.toBeInTheDocument();
    expect(container.querySelector("#resume-availability-month")).toBeTruthy();
    expect(container.querySelector("#resume-gender")).toBeNull();
    expect(container.querySelector("#resume-age")).toBeNull();
  });

  it("switches sections through the real section navigation", async () => {
    mockEmptyProfileFetch();

    renderResumePage();

    expect(await screen.findByRole("heading", { name: "Personal info" })).toBeInTheDocument();

    fireEvent.click(firstTab("Summary"));

    expect(await screen.findByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Summary" })).toBeInTheDocument();
  });

  it("adds experience bullets on the production experience section", async () => {
    mockEmptyProfileFetch();

    renderResumePage();

    expect(await screen.findByRole("heading", { name: "Personal info" })).toBeInTheDocument();
    fireEvent.click(firstTab("Professional experience"));

    expect(
      await screen.findByRole("heading", { name: "Professional experience" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add bullet" }));

    expect(screen.getAllByLabelText("Experience bullet")).toHaveLength(2);
  });

  it("opens the mobile-safe preview dialog from the preview action", async () => {
    mockEmptyProfileFetch();

    renderResumePage();
    await fillBasics();

    const previewButton = firstButton("Preview");
    expect(previewButton).toBeEnabled();
    fireEvent.click(previewButton);

    expect(await screen.findByRole("heading", { name: "PDF preview" })).toBeInTheDocument();
    expect(screen.getByTestId("resume-preview-dialog")).toHaveClass(
      "h-[100dvh]",
      "w-[100vw]",
      "sm:h-[92vh]",
    );
  });

  it("keeps the save action anchored in the section rail and completes the guide task on save", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = toUrl(input);
      if (url.startsWith("/api/resume-profile") && init?.method === "POST") {
        return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
      }
      if (url.startsWith("/api/resume-profile")) {
        return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderResumePage();
    await fillBasics();

    const saveAnchors = container.querySelectorAll('[data-guide-anchor="resume_setup"]');
    expect(saveAnchors.length).toBeGreaterThanOrEqual(1);

    const saveButton = screen.getAllByRole("button", { name: "Save selected resume" })[0];
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(guideMocks.markTaskComplete).toHaveBeenCalledWith("resume_setup");
    });
  });

  it("auto-refreshes preview when content changes while the preview is open", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input);
      if (url.startsWith("/api/resume-profile")) {
        return new Response(JSON.stringify(emptyProfileJson()), { status: 200 });
      }
      if (url === "/api/resume-pdf") {
        return new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const getPreviewCallCount = () =>
      fetchMock.mock.calls.filter(([firstArg]) => toUrl(firstArg) === "/api/resume-pdf").length;

    renderResumePage();
    await fillBasics();

    fireEvent.click(firstButton("Preview"));
    expect(await screen.findByRole("heading", { name: "PDF preview" })).toBeInTheDocument();

    await waitFor(() => {
      expect(getPreviewCallCount()).toBe(1);
    });

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Senior Software Engineer" },
    });

    await waitFor(
      () => {
        expect(getPreviewCallCount()).toBe(2);
      },
      { timeout: 2200 },
    );
  });
});
