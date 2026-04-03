import type { DetectedField } from "@ext/shared/types";

/** Interface for ATS-specific adapters. */
export interface AtsAdapter {
  readonly name: string;
  /** Check if this adapter can handle the current page. */
  canHandle(url: string, doc: Document): boolean;
  /** Detect fields using ATS-specific logic. Returns empty if falling back to generic. */
  detectFields(doc: Document): DetectedField[];
}
