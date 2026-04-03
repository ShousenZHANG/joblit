import type { FieldCategory } from "./fieldTaxonomy";

/** A detected form field with classification metadata. */
export interface DetectedField {
  /** The DOM element */
  element: HTMLElement;
  /** CSS selector for re-finding */
  selector: string;
  /** Input type (text, email, tel, file, select, textarea, etc.) */
  inputType: string;
  /** Classified category */
  category: FieldCategory;
  /** Classification confidence (0-1) */
  confidence: number;
  /** Raw label text found near the field */
  labelText: string;
  /** name attribute */
  name: string;
  /** id attribute */
  id: string;
  /** placeholder text */
  placeholder: string;
}

/** Result of form detection on a page. */
export interface FormDetectionResult {
  /** ATS provider name */
  atsProvider: string;
  /** Detected fields */
  fields: DetectedField[];
  /** The form element(s) found */
  forms: HTMLFormElement[];
}

/** Message types for chrome.runtime messaging. */
export type MessageType =
  | { type: "GET_PROFILE"; locale?: string }
  | { type: "GET_FLAT_PROFILE"; locale?: string }
  | { type: "FILL_FORM" }
  | { type: "RECORD_SUBMISSION"; data: Record<string, unknown> }
  | { type: "GET_AUTH_STATUS" }
  | { type: "SET_TOKEN"; token: string }
  | { type: "CLEAR_TOKEN" };

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
