import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/en.json";
import { PdfPreview, withPreviewCacheBust } from "./PdfPreview";

describe("withPreviewCacheBust", () => {
  it("does not append a query to a browser Blob URL", () => {
    const url = "blob:https://www.joblit.tech/preview-id";

    expect(withPreviewCacheBust(url, 123)).toBe(url);
  });

  it("still cache-busts persisted HTTP artifacts", () => {
    expect(withPreviewCacheBust("https://blob.example/resume.pdf", 123)).toBe(
      "https://blob.example/resume.pdf?preview=123",
    );
  });
});

describe("PdfPreview download", () => {
  afterEach(cleanup);

  function renderPreview(pdfUrl: string) {
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PdfPreview
          pdfUrl={pdfUrl}
          jobTitle="Software Engineer"
          downloadFilename="Alex Morgan Software Engineer_CV.pdf"
          onRefresh={() => {}}
          isRefreshing={false}
          lastRefreshedAt={null}
          autoRefresh={false}
        />
      </NextIntlClientProvider>,
    );
  }

  // Without an explicit name the browser derives one from the URL: a Blob
  // storage path for persisted artifacts, an opaque UUID for `blob:` previews.
  it("names the download canonically for a persisted artifact URL", () => {
    renderPreview("https://blob.example/applications/u1/j1/resume.abc-def.pdf");

    expect(screen.getByText("PDF").closest("a")).toHaveAttribute(
      "download",
      "Alex Morgan Software Engineer_CV.pdf",
    );
  });

  it("names the download canonically for an in-memory preview URL", () => {
    renderPreview("blob:https://www.joblit.tech/9f2c-preview");

    expect(screen.getByText("PDF").closest("a")).toHaveAttribute(
      "download",
      "Alex Morgan Software Engineer_CV.pdf",
    );
  });
});
