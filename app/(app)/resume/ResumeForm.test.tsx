import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ResumeForm } from "@/components/resume/ResumeForm";
import messages from "@/messages/en.json";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderForm = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ResumeForm />
    </NextIntlClientProvider>,
  );

describe("ResumeForm", () => {
  const closePreviewIfOpen = () => {
    const closeButton = screen.queryByRole("button", { name: "Close" });
    if (closeButton) {
      fireEvent.click(closeButton);
    }
  };

  it("renders personal info step with required fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ profile: null }), { status: 200 })),
    );

    renderForm();

    expect(await screen.findByRole("heading", { name: "Personal info" })).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();

    const nextButtons = screen.getAllByRole("button", { name: "Next" });
    nextButtons.forEach((button) => expect(button).toBeDisabled());

    const previewButton = screen.getByRole("button", { name: "Preview" });
    expect(previewButton).toBeDisabled();
  });

  it("advances to summary after basics are filled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ profile: null }), { status: 200 })),
    );

    renderForm();

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

    const nextButton = screen
      .getAllByRole("button", { name: "Next" })
      .find((button) => !button.hasAttribute("disabled"));
    expect(nextButton).toBeTruthy();
    fireEvent.click(nextButton!);

    closePreviewIfOpen();
    expect(await screen.findByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByLabelText("Summary")).toBeInTheDocument();
  });

  it("adds experience bullets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ profile: null }), { status: 200 })),
    );

    renderForm();

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

    const firstNextButton = screen
      .getAllByRole("button", { name: "Next" })
      .find((button) => !button.hasAttribute("disabled"));
    expect(firstNextButton).toBeTruthy();
    fireEvent.click(firstNextButton!);
    closePreviewIfOpen();
    fireEvent.change(await screen.findByLabelText("Summary"), {
      target: { value: "Focused engineer." },
    });
    const secondNextButton = screen
      .getAllByRole("button", { name: "Next" })
      .find((button) => !button.hasAttribute("disabled"));
    expect(secondNextButton).toBeTruthy();
    fireEvent.click(secondNextButton!);
    closePreviewIfOpen();

    const addBulletButtons = screen.getAllByRole("button", { name: "Add bullet" });
    fireEvent.click(addBulletButtons[0]);

    const bulletInputs = screen.getAllByLabelText("Experience bullet");
    expect(bulletInputs.length).toBe(2);
  });

  it("opens preview dialog from the preview button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ profile: null }), { status: 200 })),
    );

    renderForm();

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

    const previewButton = screen.getByRole("button", { name: "Preview" });
    fireEvent.click(previewButton);
    expect(await screen.findByRole("heading", { name: "PDF preview" })).toBeInTheDocument();
  });

  it("uses mobile-safe preview and action-bar hooks for responsive layout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ profile: null }), { status: 200 })),
    );

    renderForm();

    expect(await screen.findByRole("heading", { name: "Personal info" })).toBeInTheDocument();

    const actionBar = screen.getByTestId("resume-action-bar");
    expect(actionBar).toBeInTheDocument();
    expect(actionBar).toHaveStyle({ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" });

    fireEvent.change(screen.getByLabelText("Full name"), {
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

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("heading", { name: "PDF preview" })).toBeInTheDocument();

    const previewDialog = screen.getByTestId("resume-preview-dialog");
    expect(previewDialog).toHaveClass("h-[100dvh]", "w-[100vw]", "sm:h-[92vh]");
  });

  it("exposes a stable guide anchor for the resume setup step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ profile: null }), { status: 200 })),
    );

    const { container } = renderForm();
    expect(await screen.findByRole("heading", { name: "Personal info" })).toBeInTheDocument();
    expect(container.querySelector('[data-guide-anchor="resume_setup"]')).toBeTruthy();
  });

  it("auto-refreshes preview when content changes while preview is open", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/resume-profile") {
        return new Response(JSON.stringify({ profile: null }), { status: 200 });
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
      fetchMock.mock.calls.filter(([firstArg]) => firstArg === "/api/resume-pdf").length;

    renderForm();

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

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("heading", { name: "PDF preview" })).toBeInTheDocument();

    await waitFor(() => {
      expect(getPreviewCallCount()).toBe(1);
    }, { timeout: 2000 });

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Senior Software Engineer" },
    });

    await waitFor(() => {
      expect(getPreviewCallCount()).toBe(2);
    }, { timeout: 2200 });
  });
});
