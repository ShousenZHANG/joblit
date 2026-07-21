// Canonical PDF filename logic lives in the shared layer so the client (resume
// preview/download) and server (Content-Disposition, persisted names) stay in
// lockstep. Re-exported here to preserve existing server import paths.
import { asRecord, toStringValue } from "@/lib/shared/utils/text";

export {
  buildPdfFilename,
  contentDispositionAttachment,
  contentDispositionInline,
  type PdfDocKind,
} from "@/lib/shared/pdfFilename";

/**
 * Read the filename segments straight off the stored profile.
 *
 * Server code used to pass `mapResumeProfile(profile).candidate.name`, which
 * has already crossed the LaTeX boundary: escapeLatex rewrites "~" as
 * "\textasciitilde{}", and the filename sanitizer then keeps the letters,
 * producing "Ana textasciitilde Silva Engineer_CV.pdf". The client builds its
 * `<a download>` names from the raw `basics` fields, so a name with "~" or "^"
 * came out differently depending on which side produced it. Reading the raw
 * profile here is what makes the two agree.
 */
export function resumeFilenameSegments(profile: unknown): {
  name: string;
  title: string;
} {
  const basics = asRecord(asRecord(profile).basics);
  return {
    name: toStringValue(basics.fullName),
    title: toStringValue(basics.title),
  };
}
