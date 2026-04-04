import { detectForms } from "./detector/formDetector";
import { fillFields, type FlatProfile } from "./filler/formFiller";
import { sendMessage } from "@ext/shared/messaging";
import { mountWidget, unmountWidget, isWidgetMounted } from "./widget/mount";
import { FloatingWidget } from "./widget/FloatingWidget";
import { recordSubmission, interceptFormSubmits } from "./recorder/submissionRecorder";
import type { DetectedField, FormDetectionResult } from "@ext/shared/types";

let widget: FloatingWidget | null = null;
let currentDetection: FormDetectionResult | null = null;
let currentProfile: FlatProfile | null = null;
let cleanupSubmitListener: (() => void) | null = null;

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
      return true;
    }

    if (message.type === "TOGGLE_WIDGET") {
      toggleWidget();
      sendResponse({ success: true });
      return true;
    }
  });

  // Auto-detect forms after page loads
  setTimeout(() => {
    currentDetection = detectForms(document);
    if (currentDetection.fields.length > 0) {
      initWidget(currentDetection);
      // Set up submit interception
      cleanupSubmitListener = interceptFormSubmits(
        currentDetection.fields,
        currentDetection.atsProvider,
      );
    }
  }, 1000);

  // Watch for SPA navigation / dynamic form loading
  const observer = new MutationObserver(() => {
    const newDetection = detectForms(document);
    if (newDetection.fields.length > 0 && newDetection.fields.length !== currentDetection?.fields.length) {
      currentDetection = newDetection;
      if (widget) {
        widget.setFields(newDetection.fields);
      }
      // Re-setup submit interception
      cleanupSubmitListener?.();
      cleanupSubmitListener = interceptFormSubmits(
        newDetection.fields,
        newDetection.atsProvider,
      );
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/** Initialize the floating widget. */
async function initWidget(detection: FormDetectionResult) {
  const mounted = mountWidget();
  if (!mounted) return;

  widget = new FloatingWidget(mounted.container, {
    onFill: () => performFill(),
    onRecordSubmission: () => {
      if (currentDetection) {
        recordSubmission(currentDetection.fields, currentDetection.atsProvider);
      }
    },
    onCorrectMapping: (fieldSelector, newProfilePath) => {
      sendMessage({
        type: "RECORD_SUBMISSION",
        data: { type: "CORRECT_MAPPING", fieldSelector, newProfilePath },
      });
    },
  });

  widget.setFields(detection.fields);

  // Fetch profile for widget preview
  const response = await sendMessage<{ flat: FlatProfile }>({ type: "GET_FLAT_PROFILE" });
  if (response.success && response.data?.flat) {
    currentProfile = response.data.flat;
    widget.setProfile(currentProfile);
  }
}

/** Toggle widget visibility. */
function toggleWidget() {
  if (!isWidgetMounted()) {
    if (currentDetection && currentDetection.fields.length > 0) {
      initWidget(currentDetection);
    }
  } else if (widget) {
    widget.toggle();
  } else {
    unmountWidget();
  }
}

/** Perform form detection and filling. */
async function performFill() {
  if (!currentDetection) {
    currentDetection = detectForms(document);
  }

  if (currentDetection.fields.length === 0) {
    return { filled: 0, skipped: 0, message: "No form fields detected on this page." };
  }

  // Fetch flat profile if not cached
  if (!currentProfile) {
    const response = await sendMessage<{ flat: FlatProfile }>({ type: "GET_FLAT_PROFILE" });
    if (!response.success || !response.data?.flat) {
      return { filled: 0, skipped: 0, message: "Could not load profile. Please check your connection." };
    }
    currentProfile = response.data.flat;
  }

  const result = fillFields(currentDetection.fields, currentProfile);

  // Update widget if present
  if (widget) {
    widget.setFields(currentDetection.fields);
  }

  return {
    ...result,
    atsProvider: currentDetection.atsProvider,
    totalDetected: currentDetection.fields.length,
    message: `Filled ${result.filled} of ${currentDetection.fields.length} fields (${currentDetection.atsProvider}).`,
  };
}

// Run
init();
