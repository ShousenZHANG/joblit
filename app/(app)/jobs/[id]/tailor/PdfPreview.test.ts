import { describe, expect, it } from "vitest";
import { withPreviewCacheBust } from "./PdfPreview";

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
