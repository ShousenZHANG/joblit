import { detectForms } from "./detector/formDetector";
import { fillFields, advanceMultiStepForm, highlightUnfilledFields, type FlatProfile, type HistoricalOverrides } from "./filler/formFiller";
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
const isIframe = window !== window.top;
/** Prevent duplicate onMessage listener if init() is called more than once (e.g. via lazyObs). */
let messageListenerRegistered = false;

/** Simple debounce — collapses rapid calls into one after `ms` of silence. */
function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
}

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

/** Set up submit interception for detected fields. */
function setupSubmitIntercept(detection: FormDetectionResult) {
  cleanupSubmitListener?.();
  cleanupSubmitListener = interceptFormSubmits(
    detection.fields,
    detection.atsProvider,
  );
}

/** Main entry point for the content script. */
async function init() {
  // Register message listener ONCE, BEFORE any early returns.
  // Only the top frame responds to popup fill/toggle requests — prevents iframe
  // race condition where an empty iframe responds with 0/0 before the top frame
  // finishes its API calls, causing the popup to show "No fields detected" even
  // though the top frame successfully fills the form.
  if (!messageListenerRegistered) {
    messageListenerRegistered = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "TRIGGER_FILL") {
        if (isIframe) return false; // Only top frame responds
        performFill().then((result) => {
          sendResponse({ success: true, ...result });
        }).catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : "Fill failed";
          sendResponse({ success: false, error: errorMessage, filled: 0, skipped: 0 });
        });
        return true;
      }

      if (message.type === "TOGGLE_WIDGET") {
        if (isIframe) return false; // Only top frame responds
        toggleWidget().then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: true }));
        return true;
      }
    });
  }

  // Known ATS domains — always initialize
  const KNOWN_ATS_PATTERNS = [
    /greenhouse\.io/i, /lever\.co/i, /myworkdayjobs\.com/i, /workday\.com/i,
    /icims\.com/i, /successfactors\.com/i, /taleo\.net/i, /smartrecruiters\.com/i,
    /bamboohr\.com/i, /jobvite\.com/i, /ashbyhq\.com/i, /rippling\.com/i,
    /careers|jobs|apply|application/i,
  ];
  const isKnownAts = KNOWN_ATS_PATTERNS.some(p => p.test(location.href));
  const hasFormElements = document.querySelector("input, textarea, select, form");

  if (!hasFormElements && !isKnownAts && !isIframe) {
    // No forms on this page — set up a lazy observer and exit
    const lazyObs = new MutationObserver(() => {
      if (document.querySelector("input, textarea, select, form")) {
        lazyObs.disconnect();
        init(); // Re-initialize now that forms exist
      }
    });
    lazyObs.observe(document.body, { childList: true, subtree: true });
    return;
  }

  const prefs = await loadPreferences();

  // Exponential retry for SPA-rendered forms
  const autoFillEnabled = prefs.autoFill;
  const DETECTION_DELAYS = [500, 1500, 3000, 6000];
  let detected = false;

  for (const delay of DETECTION_DELAYS) {
    await new Promise(resolve => setTimeout(resolve, delay));
    const result = detectForms(document);
    if (result.fields.length > 0) {
      currentDetection = result;
      if (!isIframe) {
        initWidget(currentDetection);
      }
      setupSubmitIntercept(currentDetection);
      if (autoFillEnabled) {
        await performFill();
      }
      detected = true;
      break;
    }
  }

  if (!detected) {
    // No forms found after all retries — still set up MutationObserver
    currentDetection = detectForms(document);
  }

  // Watch for SPA navigation / dynamic form loading
  let lastUrl = window.location.href;
  const debouncedDetect = debounce(() => {
    try {
      // Detect SPA URL changes
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        currentDetection = null;
        currentProfile = null;
      }

      const newDetection = detectForms(document);
      if (newDetection.fields.length > 0) {
        const newSelectors = new Set(newDetection.fields.map(f => f.selector));
        const oldSelectors = new Set(currentDetection?.fields.map(f => f.selector) ?? []);
        const changed = newSelectors.size !== oldSelectors.size ||
          [...newSelectors].some(s => !oldSelectors.has(s));
        if (changed) {
          currentDetection = newDetection;
          if (widget) {
            widget.setFields(newDetection.fields);
          }
          // Re-setup submit interception
          setupSubmitIntercept(newDetection);
        }
      }
    } catch (err) {
      if (process.env.NODE_ENV !== "production") console.warn("[Joblit] MutationObserver error:", err);
    }
  }, 500);
  const observer = new MutationObserver(debouncedDetect);

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
    onSaveRule: async (rule: FieldRuleData): Promise<boolean> => {
      // Determine scope-based atsProvider/pageDomain
      const atsProvider = rule.scope === "global" ? "" : rule.atsProvider;
      const pageDomain = rule.scope === "site" ? rule.pageDomain : "";

      const response = await sendMessage({
        type: "PUT_FIELD_MAPPING",
        data: {
          fieldSelector: rule.fieldSelector,
          fieldLabel: rule.fieldLabel,
          profilePath: rule.profilePath,
          staticValue: rule.staticValue || undefined,
          atsProvider,
          pageDomain,
          source: "user",
        },
      });
      return response.success;
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
async function toggleWidget(): Promise<void> {
  if (!isWidgetMounted()) {
    // Detect forms on demand if not yet detected (e.g. user clicks before 1s timeout)
    if (!currentDetection || currentDetection.fields.length === 0) {
      currentDetection = detectForms(document);
    }
    if (currentDetection.fields.length > 0) {
      if (!isIframe) {
        // Await so that `widget` is assigned before we call toggle()
        await initWidget(currentDetection);
      }
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
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.warn("[Joblit] Historical overrides fetch failed:", err);
  }

  return overrides;
}

/** Perform form detection and filling. */
async function performFill() {
  // Always re-detect forms fresh — the user may have clicked Fill after
  // the page finished loading (SPA), or fields may have changed since init.
  currentDetection = detectForms(document);

  if (currentDetection.fields.length === 0) {
    // Last resort: wait 1s for SPA render and try once more
    await new Promise((resolve) => setTimeout(resolve, 1000));
    currentDetection = detectForms(document);
  }

  if (currentDetection.fields.length === 0) {
    return { filled: 0, skipped: 0, message: "No form fields detected on this page." };
  }

  // Always fetch fresh profile to ensure latest data
  const response = await sendMessage<{ flat: FlatProfile }>({ type: "GET_FLAT_PROFILE" });
  if (!response.success || !response.data?.flat) {
    return { filled: 0, skipped: 0, message: "Could not load profile. Please check your connection." };
  }
  currentProfile = response.data.flat;

  // Fetch historical overrides (non-blocking on failure)
  const historicalOverrides = await fetchHistoricalOverrides(
    currentDetection.fields,
    currentDetection.atsProvider,
  );

  // Load default answers from extension storage
  const defaultAnswers = await new Promise<Record<string, string>>((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.DEFAULT_ANSWERS, (result) => {
      resolve(result[STORAGE_KEYS.DEFAULT_ANSWERS] ?? {});
    });
  });

  // Merge default answers into profile (profile values take priority)
  const mergedProfile: FlatProfile = {
    ...defaultAnswers,
    ...currentProfile,
  };

  // Signal fill start to widget
  if (widget) {
    widget.setFillProgress(0, currentDetection.fields.length, "filling");
  }

  const result = fillFields(currentDetection.fields, mergedProfile, historicalOverrides);

  // Highlight unfilled fields on the page so user knows what needs manual input
  const removeHighlights = highlightUnfilledFields(currentDetection.fields);
  // Auto-remove highlights after 30 seconds
  setTimeout(removeHighlights, 30000);

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
