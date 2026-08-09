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

  it("keeps the artifact and warns when the parser itself cannot run", async () => {
    // The PDF exists by this point — LaTeX rendered it. A parser that cannot
    // read it is a broken checker, not a bad document, and discarding finished
    // work over that costs the user a generation they cannot get back by
    // retrying. Production hit exactly this: pdfjs lost its DOM shims inside
    // the serverless bundle and every task failed with a rendered PDF in hand.
    const result = await validateAtsPdf(PDF, {
      extract: async () => {
        throw new Error("DOMMatrix is not defined");
      },
    });

    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toContain("ATS check skipped");
    expect(result.warnings[0]).toContain("DOMMatrix is not defined");
  });
});
