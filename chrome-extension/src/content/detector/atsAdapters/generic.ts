import type { AtsAdapter } from "./types";
import type { DetectedField } from "@ext/shared/types";

/** Generic adapter — always matches, relies on generic detection in formDetector. */
export const genericAdapter: AtsAdapter = {
  name: "generic",

  canHandle(_url: string, _doc: Document): boolean {
    return true; // Catch-all
  },

  detectFields(): DetectedField[] {
    return []; // Return empty to trigger generic detection
  },
};
