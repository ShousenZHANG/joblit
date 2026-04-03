import { detectForms } from "./detector/formDetector";
import { fillFields, type FlatProfile } from "./filler/formFiller";
import { sendMessage } from "@ext/shared/messaging";

/** Main entry point for the content script. */
async function init() {
  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "TRIGGER_FILL") {
      performFill().then((result) => {
        sendResponse({ success: true, data: result });
      }).catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : "Fill failed";
        sendResponse({ success: false, error: errorMessage });
      });
      return true; // async response
    }

    if (message.type === "TOGGLE_WIDGET") {
      // TODO: Phase 2 — toggle floating widget
      sendResponse({ success: true });
      return true;
    }
  });
}

/** Perform form detection and filling. */
async function performFill() {
  // 1. Detect forms on the page
  const detection = detectForms(document);

  if (detection.fields.length === 0) {
    return { filled: 0, skipped: 0, message: "No form fields detected on this page." };
  }

  // 2. Fetch flat profile from background
  const response = await sendMessage<{ flat: FlatProfile }>(
    { type: "GET_FLAT_PROFILE" },
  );

  if (!response.success || !response.data?.flat) {
    return { filled: 0, skipped: 0, message: "Could not load profile. Please check your connection." };
  }

  // 3. Fill the detected fields
  const result = fillFields(detection.fields, response.data.flat);

  return {
    ...result,
    atsProvider: detection.atsProvider,
    totalDetected: detection.fields.length,
    message: `Filled ${result.filled} of ${detection.fields.length} fields (${detection.atsProvider}).`,
  };
}

// Run
init();
