import { describe, expect, it } from "vitest";
import {
  buildPdfFilename,
  contentDispositionAttachment,
  contentDispositionInline,
} from "./pdfFilename";

const isHeaderSafe = (value: string) => [...value].every((c) => c.charCodeAt(0) <= 255);

describe("buildPdfFilename", () => {
  it("formats `{Full Name} {Title}_CV.pdf` with spaces preserved", () => {
    expect(buildPdfFilename("Alex Morgan", "Software Engineer", "cv")).toBe(
      "Alex Morgan Software Engineer_CV.pdf",
    );
  });

  it("uses the _CL suffix for cover letters", () => {
    expect(buildPdfFilename("Alex Morgan", "Software Engineer", "cl")).toBe(
      "Alex Morgan Software Engineer_CL.pdf",
    );
  });

  it("defaults to a CV when no kind is given", () => {
    expect(buildPdfFilename("Jane Doe", "Product Manager")).toBe(
      "Jane Doe Product Manager_CV.pdf",
    );
  });

  it("preserves original casing (no forced title-case)", () => {
    expect(buildPdfFilename("Ada Lovelace", "iOS Engineer", "cv")).toBe(
      "Ada Lovelace iOS Engineer_CV.pdf",
    );
  });

  it("strips diacritics", () => {
    expect(buildPdfFilename("José Núñez", "Señor Developer", "cv")).toBe(
      "Jose Nunez Senor Developer_CV.pdf",
    );
  });

  it("replaces filename-hostile characters with single spaces", () => {
    expect(buildPdfFilename("A/B\\C", "X:Y?Z", "cv")).toBe("A B C X Y Z_CV.pdf");
  });

  it("collapses repeated whitespace", () => {
    expect(buildPdfFilename("Alex   Morgan", "Sr.   Engineer", "cv")).toBe(
      "Alex Morgan Sr Engineer_CV.pdf",
    );
  });

  it("keeps CJK names intact", () => {
    expect(buildPdfFilename("张三", "软件工程师", "cv")).toBe("张三 软件工程师_CV.pdf");
  });

  it("handles name-only or title-only input", () => {
    expect(buildPdfFilename("Alex Morgan", "", "cv")).toBe("Alex Morgan_CV.pdf");
    expect(buildPdfFilename("", "Software Engineer", "cv")).toBe("Software Engineer_CV.pdf");
  });

  it("falls back when both name and title are empty", () => {
    expect(buildPdfFilename("", "", "cv")).toBe("Resume_CV.pdf");
    expect(buildPdfFilename(null, undefined, "cl")).toBe("Resume_CL.pdf");
  });

  it("accepts a custom fallback (e.g. localized)", () => {
    expect(buildPdfFilename("", "", "cv", "未命名简历")).toBe("未命名简历_CV.pdf");
  });

  it("never leaks a missing segment into the name as undefined/null", () => {
    const names = [
      buildPdfFilename(undefined, "Software Engineer"),
      buildPdfFilename("Alex Morgan", null, "cl"),
      buildPdfFilename(undefined, undefined),
    ];
    for (const name of names) {
      expect(name).not.toContain("undefined");
      expect(name).not.toContain("null");
      expect(name).toMatch(/^.+_(?:CV|CL)\.pdf$/);
    }
  });

  it("keeps punctuation out of the head but never leaves it empty", () => {
    expect(buildPdfFilename("O'Brien-Smith, Jr.", "Sr. Engineer (Backend)")).toBe(
      "O Brien Smith Jr Sr Engineer Backend_CV.pdf",
    );
    expect(buildPdfFilename("***", "###")).toBe("Resume_CV.pdf");
  });
});

describe("contentDispositionAttachment", () => {
  it("uses a plain filename for ASCII names", () => {
    const value = contentDispositionAttachment("Alex Morgan Software Engineer_CV.pdf");
    expect(value).toContain('filename="Alex Morgan Software Engineer_CV.pdf"');
    expect(value).toContain("filename*=UTF-8''");
    expect(isHeaderSafe(value)).toBe(true);
  });

  it("encodes non-ASCII (CJK) names so the header stays ISO-8859-1 safe", () => {
    const filename = buildPdfFilename("张三", "软件工程师", "cv");
    const value = contentDispositionAttachment(filename);
    // The raw header value must never contain a char > 255 (would throw when
    // assigned to a Response header).
    expect(isHeaderSafe(value)).toBe(true);
    // ASCII fallback replaces CJK with underscores; the real name survives in
    // the percent-encoded filename* param.
    expect(value).toMatch(/filename="[\x20-\x7E]+"/);
    const encoded = value.match(/filename\*=UTF-8''(.+)$/)?.[1] ?? "";
    expect(decodeURIComponent(encoded)).toBe(filename);
  });
});

describe("contentDispositionInline", () => {
  it("encodes exactly like the attachment variant", () => {
    const filename = buildPdfFilename("张三", "软件工程师", "cl");
    const inline = contentDispositionInline(filename);

    expect(inline.startsWith("inline; ")).toBe(true);
    expect(isHeaderSafe(inline)).toBe(true);
    expect(inline.replace(/^inline; /, "")).toBe(
      contentDispositionAttachment(filename).replace(/^attachment; /, ""),
    );
  });
});
