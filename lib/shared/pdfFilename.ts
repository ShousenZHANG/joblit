/**
 * Canonical résumé / cover-letter download filename builder.
 *
 * Single source of truth shared by the server (Content-Disposition headers,
 * persisted `resumePdfName` / `coverPdfName`) and the client (resume preview /
 * download `<a download>` attributes) so every PDF a user saves is named the
 * same way:  `{Full Name} {Title}_{CV|CL}.pdf`.
 *
 *   buildPdfFilename("Eddy Zhang", "Software Engineer", "cv")
 *     -> "Eddy Zhang Software Engineer_CV.pdf"
 *   buildPdfFilename("Eddy Zhang", "Software Engineer", "cl")
 *     -> "Eddy Zhang Software Engineer_CL.pdf"
 */

export type PdfDocKind = "cv" | "cl";

const KIND_SUFFIX: Record<PdfDocKind, string> = { cv: "CV", cl: "CL" };

const COMBINING_DIACRITICS = /[̀-ͯ]/g;
const NON_FILENAME_CHARS = /[^\p{L}\p{N} ]+/gu;

/**
 * Sanitize one filename segment: strip Latin diacritics and any character that
 * is illegal or awkward in a download filename (path separators, quotes,
 * punctuation), while preserving Unicode letters — including CJK — digits and
 * single spaces so names read naturally.
 */
function sanitizeSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS, "") // é -> e
    .replace(NON_FILENAME_CHARS, " ") // keep letters/digits/space, others -> space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build `{Full Name} {Title}_{CV|CL}.pdf`. When both name and title are empty
 * (or sanitize to nothing) the head falls back to `fallback`.
 */
export function buildPdfFilename(
  fullName: string | null | undefined,
  title: string | null | undefined,
  kind: PdfDocKind = "cv",
  fallback = "Resume",
): string {
  const name = sanitizeSegment(fullName ?? "");
  const role = sanitizeSegment(title ?? "");
  const head = [name, role].filter(Boolean).join(" ") || fallback;
  return `${head}_${KIND_SUFFIX[kind]}.pdf`;
}

/**
 * Build a `Content-Disposition: attachment` header value that survives the
 * ISO-8859-1 (ByteString) constraint on HTTP header values.
 *
 * Non-ASCII filenames (e.g. CJK names) cannot go in a raw `filename="..."`
 * param — they throw when assigned to a header. Per RFC 6266 / 5987 we emit an
 * ASCII fallback in `filename=` plus a percent-encoded UTF-8 `filename*=` that
 * modern browsers prefer, so "张三 软件工程师_CV.pdf" downloads with its real
 * name while old clients still get a sane ASCII name.
 */
export function contentDispositionAttachment(filename: string): string {
  const asciiFallback =
    filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "download.pdf";
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
