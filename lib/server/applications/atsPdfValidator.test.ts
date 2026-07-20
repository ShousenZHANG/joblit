import { describe, expect, it } from "vitest";
import { validateAtsPdf } from "./atsPdfValidator";

const PDF = Buffer.from("%PDF-1.7\nmock");

describe("validateAtsPdf", () => {
  it("passes a short machine-readable two-page application and reports keyword coverage", async () => {
    const result = await validateAtsPdf(PDF, {
      minTextChars: 20,
      maxPages: 2,
      requiredKeywords: ["TypeScript", "AWS", "Kubernetes"],
      extract: async () => ({
        pageCount: 2,
        text: "Backend engineer delivering secure TypeScript APIs on AWS.",
      }),
    });

    expect(result.passed).toBe(true);
    expect(result.keywordCoverage).toBe(67);
    expect(result.matchedKeywords).toEqual(["typescript", "aws"]);
    expect(result.missingKeywords).toEqual(["kubernetes"]);
  });

  it("blocks PDFs with no usable text layer or too many pages", async () => {
    const result = await validateAtsPdf(PDF, {
      minTextChars: 100,
      maxPages: 2,
      extract: async () => ({ pageCount: 3, text: "image only" }),
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("maximum is 2"),
        expect.stringContaining("minimum is 100"),
      ]),
    );
  });

  it("fails closed when the parser cannot read the document", async () => {
    const result = await validateAtsPdf(PDF, {
      extract: async () => {
        throw new Error("invalid xref");
      },
    });

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain("invalid xref");
  });
});
