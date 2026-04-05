import { detectForms } from "./detector/formDetector";
import { fillFields, advanceMultiStepForm, type FlatProfile, type HistoricalOverrides } from "./filler/formFiller";
import { simulateInput } from "./filler/inputSimulator";
import { sendMessage } from "@ext/shared/messaging";
import { mountWidget, unmountWidget, isWidgetMounted } from "./widget/mount";
import { FloatingWidget, type FieldRuleData } from "./widget/FloatingWidget";
import { recordSubmission, interceptFormSubmits } from "./recorder/submissionRecorder";
import { generateFormSignature, matchFieldsFromHistory } from "./detector/similarity";
import type { SubmissionRecord, MappingRule } from "./detector/similarity";
import type { DetectedField, FormDetectionResult, SubmissionQueryParams, FieldMappingQueryParams } from "@ext/shared/types";
import { STORAGE_KEYS } from "@ext/shared/constants";

let widget: FloatingWidget | null = null;
let currentDetection: FormDetectionResult | null = null;
let currentProfile: FlatProfile | null = null;
let cleanupSubmitListener: (() => void) | null = null;

/** Load user preferences from storage. */
async function loadPreferences(): Promise<{ autoFill: boolean; showWidget: boolean }> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.PREFERENCES, (result) => {
      const prefs = result[STORAGE_KEYS.PREFERENCES];
      resolve({
        autoFill: prefs?.autoFill ?? false,
        showWidget: prefs?.showWidget ?? true,
      });
    });
  });
}

/** Main entry point for the content script. */
async function init() {
  const prefs = await loadPreferences();

  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "TRIGGER_FILL") {
      performFill().then((result) => {
        sendResponse({ success: true, ...result });
      }).catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : "Fill failed";
        sendResponse({ success: false, error: errorMessage, filled: 0, skipped: 0 });
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
      // Mount widget if preference enabled
      if (prefs.showWidget) {
        initWidget(currentDetection);
      }

      // Set up submit interception
      cleanupSubmitListener = interceptFormSubmits(
        currentDetection.fields,
        currentDetection.atsProvider,
      );

      // Auto-fill if preference enabled
      if (prefs.autoFill) {
        performFill();
      }
    }
  }, 1000);

  // Watch for SPA navigation / dynamic form loading
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    try {
      // Detect SPA URL changes
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        currentDetection = null;
        currentProfile = null;
      }

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
    } catch {
      // Non-critical — observer fires frequently, don't crash on transient DOM states
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
    onSaveRule: (rule: FieldRuleData) => {
      // Determine scope-based atsProvider/pageDomain
      const atsProvider = rule.scope === "global" ? "" : rule.atsProvider;
      const pageDomain = rule.scope === "site" ? rule.pageDomain : "";

      sendMessage({
        type: "PUT_FIELD_MAPPING",
        data: {
          fieldSelector: rule.fieldSelector,
          fieldLabel: rule.fieldLabel,
          profilePath: rule.profilePath,
          staticValue: rule.staticValue ?? null,
          atsProvider,
          pageDomain,
          source: "user",
        },
      });
    },
    onApplyValue: (fieldSelector: string, value: string) => {
      // Find the actual DOM element and apply the value
      const field = currentDetection?.fields.find((f) => f.selector === fieldSelector);
      if (field?.element) {
        simulateInput(field.element, value);
      }
    },
  });

  widget.setFields(detection.fields);
  widget.setAtsProvider(detection.atsProvider);

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
    // Detect forms on demand if not yet detected (e.g. user clicks before 1s timeout)
    if (!currentDetection || currentDetection.fields.length === 0) {
      currentDetection = detectForms(document);
    }
    if (currentDetection.fields.length > 0) {
      initWidget(currentDetection);
      // Widget starts collapsed — expand it immediately so fields are visible
      if (widget) {
        widget.toggle();
      }
    }
  } else if (widget) {
    widget.toggle();
  } else {
    unmountWidget();
  }
}

/** Fetch historical overrides for the current form. */
async function fetchHistoricalOverrides(
  fields: DetectedField[],
  atsProvider: string,
): Promise<HistoricalOverrides> {
  const overrides: HistoricalOverrides = {};
  const domain = window.location.hostname;
  const signature = generateFormSignature(fields);

  try {
    // Fetch ALL rules for this user — don't filter by pageDomain on the server
    // so we get global rules (pageDomain=""), ATS-level rules, and site-specific
    // rules. The matching logic in matchFieldsFromHistory handles prioritization.
    const [subsResponse, rulesResponse] = await Promise.all([
      sendMessage<SubmissionRecord[]>({
        type: "GET_SUBMISSIONS",
        params: { atsProvider, pageDomain: domain, limit: 20 },
      }),
      sendMessage<MappingRule[]>({
        type: "GET_FIELD_MAPPINGS",
        params: { atsProvider },
      }),
    ]);

    const submissions = Array.isArray(subsResponse.data) ? subsResponse.data : [];
    const rules = Array.isArray(rulesResponse.data) ? rulesResponse.data : [];

    if (submissions.length === 0 && rules.length === 0) return overrides;

    const matches = matchFieldsFromHistory(
      fields,
      signature,
      domain,
      atsProvider,
      submissions,
      rules,
      currentProfile,
    );

    for (const [selector, match] of matches) {
      overrides[selector] = match.value;
    }
  } catch {
    // Non-critical — fall back to profile-only fill
  }

  return overrides;
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

  // Fetch historical overrides (non-blocking on failure)
  const historicalOverrides = await fetchHistoricalOverrides(
    currentDetection.fields,
    currentDetection.atsProvider,
  );

  // Signal fill start to widget
  if (widget) {
    widget.setFillProgress(0, currentDetection.fields.length, "filling");
  }

  const result = fillFields(currentDetection.fields, currentProfile, historicalOverrides);

  // Signal fill complete to widget
  if (widget) {
    // Pass actual fill results (including KB/historical values) so review mode shows them
    const fillResultsMap = new Map<string, { filled: boolean; source: string; value: string }>();
    for (const fr of result.fields) {
      fillResultsMap.set(fr.selector, { filled: fr.filled, source: fr.source, value: fr.value });
    }
    widget.setFillResults(fillResultsMap);
    widget.setFillProgress(result.filled, currentDetection.fields.length, "done");
    widget.setFields(currentDetection.fields);
    // Reset progress after showing result
    setTimeout(() => {
      if (widget) widget.setFillProgress(0, 0, "idle");
    }, 3000);
  }

  // Attempt multi-step form advancement
  if (result.filled > 0) {
    setTimeout(() => {
      const advanced = advanceMultiStepForm(document);
      if (advanced) {
        // Re-detect after page transition and fill next step
        setTimeout(() => {
          currentDetection = detectForms(document);
          if (currentDetection.fields.length > 0) {
            performFill().catch(() => {
              // Non-critical — multi-step fill failed silently
            });
          }
        }, 1500);
      }
    }, 500);
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
