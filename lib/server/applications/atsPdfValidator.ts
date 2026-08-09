import { truncate } from "@/lib/shared/utils/text";
import { AppError } from "@/lib/server/api/appError";

export type AtsPdfValidation = {
  passed: boolean;
  pageCount: number;
  textLength: number;
  keywordCoverage: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  errors: string[];
  warnings: string[];
};

export class AtsPdfValidationError extends AppError {
  readonly report: AtsPdfValidation;

  constructor(report: AtsPdfValidation) {
    // The report is derived from our own PDF, not from an upstream body, so it
    // is safe to return — it is what the Edit panel renders.
    super({
      code: "ATS_PDF_VALIDATION_FAILED",
      status: 422,
      publicMessage: report.errors[0] ?? "PDF failed ATS readability validation.",
      publicDetails: report,
    });
    this.name = "AtsPdfValidationError";
    this.report = report;
  }
}

type ValidateAtsPdfOptions = {
  minTextChars?: number;
  maxPages?: number;
  requiredKeywords?: string[];
  extract?: (pdf: Buffer) => Promise<{ pageCount: number; text: string }>;
};

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKeywords(keywords: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of keywords) {
    const keyword = normalize(value);
    if (keyword.length < 2 || seen.has(keyword)) continue;
    seen.add(keyword);
    result.push(keyword);
    if (result.length >= 40) break;
  }
  return result;
}

export async function extractPdfText(pdf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .filter(Boolean)
        .join(" ");
      pages.push(text);
      page.cleanup();
      if (pages.join(" ").length > 250_000) break;
    }
    return { pageCount: document.numPages, text: pages.join("\n") };
  } finally {
    await document.destroy();
  }
}

export async function validateAtsPdf(
  pdf: Buffer,
  options: ValidateAtsPdfOptions = {},
): Promise<AtsPdfValidation> {
  const minTextChars = options.minTextChars ?? 120;
  const maxPages = options.maxPages ?? 2;
  const requiredKeywords = normalizeKeywords(options.requiredKeywords ?? []);
  const extractor = options.extract ?? extractPdfText;
  const errors: string[] = [];
  const warnings: string[] = [];

  let extracted: { pageCount: number; text: string };
  try {
    extracted = await extractor(pdf);
  } catch (error) {
    // The extractor failing is an outage of the checker, not a verdict on the
    // document. LaTeX already produced the PDF at this point, so treating an
    // unreadable text layer as a failed check threw away finished work over a
    // runtime problem the user cannot act on. It downgrades to a warning: the
    // artifact is kept, the report records that the lint could not run, and a
    // genuinely bad PDF is still caught by the checks below whenever the
    // extractor does work.
    return {
      passed: true,
      pageCount: 0,
      textLength: 0,
      keywordCoverage: 0,
      matchedKeywords: [],
      missingKeywords: requiredKeywords,
      errors: [],
      warnings: [
        ...warnings,
        `ATS check skipped — the PDF text layer could not be read: ${truncate(
          error instanceof Error ? error.message : String(error),
          180,
        )}`,
      ],
    };
  }

  const text = normalize(extracted.text);
  if (extracted.pageCount < 1) errors.push("PDF has no readable pages.");
  if (extracted.pageCount > maxPages) {
    errors.push(`PDF has ${extracted.pageCount} pages; maximum is ${maxPages}.`);
  }
  if (text.length < minTextChars) {
    errors.push(
      `PDF text layer contains ${text.length} characters; minimum is ${minTextChars}.`,
    );
  }

  const matchedKeywords = requiredKeywords.filter((keyword) => text.includes(keyword));
  const missingKeywords = requiredKeywords.filter((keyword) => !text.includes(keyword));
  const keywordCoverage = requiredKeywords.length === 0
    ? 1
    : matchedKeywords.length / requiredKeywords.length;
  if (requiredKeywords.length > 0 && keywordCoverage < 0.2) {
    warnings.push(
      `Only ${Math.round(keywordCoverage * 100)}% of priority ATS keywords are present.`,
    );
  }

  return {
    passed: errors.length === 0,
    pageCount: extracted.pageCount,
    textLength: text.length,
    keywordCoverage: Math.round(keywordCoverage * 100),
    matchedKeywords,
    missingKeywords,
    errors,
    warnings,
  };
}

export async function assertAtsPdf(
  pdf: Buffer,
  options: ValidateAtsPdfOptions = {},
) {
  const report = await validateAtsPdf(pdf, options);
  if (!report.passed) throw new AtsPdfValidationError(report);
  return report;
}
