// Canonical PDF filename logic lives in the shared layer so the client (resume
// preview/download) and server (Content-Disposition, persisted names) stay in
// lockstep. Re-exported here to preserve existing server import paths.
export {
  buildPdfFilename,
  contentDispositionAttachment,
  type PdfDocKind,
} from "@/lib/shared/pdfFilename";
