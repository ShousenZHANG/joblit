import type { MessageType, MessageResponse, WidgetPosition } from "@ext/shared/types";
import { STORAGE_KEYS } from "@ext/shared/constants";
import { JOBLIT_WEB_ORIGIN } from "@ext/shared/hermesTypes";
import { setToken, clearToken, getAuthStatus } from "./auth";
import { fetchProfile, fetchFlatProfile, postSubmission, fetchSubmissions, fetchFieldMappings, putFieldMapping, matchJob, markJobApplied, importSeekJobs } from "./api";
import { enqueue } from "./syncQueue";
import { processQueue } from "./syncProcessor";
import { sendToActiveTab } from "./tabBridge";
import { HermesApiError, isRetryableApiError, toPublicLocalAiError } from "./apiErrors";
import { ensureTrustedLocalStorage } from "./storageSecurity";
import {
  checkHermesSettings,
  forgetHermesSettings,
  getHermesSettingsPublic,
  getLocalAiRun,
  getPublicLocalAiStatus,
  repairLocalAiRun,
  startLocalAiRun,
  stopLocalAiRun,
  testAndSaveHermesSettings,
} from "./hermesRuns";

const storageReady = ensureTrustedLocalStorage();

function isJoblitWebSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.tab) return false;
  const rawUrl = sender.url ?? sender.tab.url;
  if (!rawUrl) return false;
  try {
    return new URL(rawUrl).origin === JOBLIT_WEB_ORIGIN;
  } catch {
    return false;
  }
}

function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  // Trust our own packaged pages wherever they render: the popup has no
  // sender.tab, but the full settings view (?view=settings) is a real tab.
  // The extension-id + chrome-extension:// URL prefix is the security
  // boundary; being in a tab does not change the trust level.
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  return sender.url.startsWith(chrome.runtime.getURL(""));
}

function requireSender(allowed: boolean): void {
  if (!allowed) throw new HermesApiError("FORBIDDEN_CALLER", "Forbidden extension caller");
}

function isWidgetPosition(value: unknown): value is WidgetPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const position = value as Record<string, unknown>;
  const pixel = /^(?:0|[1-9]\d{0,3})px$/;
  return (
    Object.keys(position).length === 2 &&
    typeof position.right === "string" &&
    pixel.test(position.right) &&
    typeof position.bottom === "string" &&
    pixel.test(position.bottom)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Handle messages from content scripts and popup. */
chrome.runtime.onMessage.addListener(
  (
    message: MessageType,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((err: unknown) => {
        if (err instanceof HermesApiError) {
          const publicError = toPublicLocalAiError(err);
          sendResponse({
            success: false,
            error: publicError.message,
            errorCode: publicError.code,
            retryable: publicError.retryable,
          });
          return;
        }
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        sendResponse({ success: false, error: errorMessage });
      });

    // Return true to indicate async response
    return true;
  },
);

async function handleMessage(
  message: MessageType,
  sender: chrome.runtime.MessageSender,
): Promise<MessageResponse> {
  try {
    await storageReady;
  } catch {
    throw new HermesApiError("EXTENSION_STORAGE_UNAVAILABLE", "Secure extension storage is unavailable");
  }
  switch (message.type) {
    case "GET_AUTH_STATUS": {
      const status = await getAuthStatus();
      return { success: true, data: status };
    }

    case "SET_TOKEN": {
      await setToken(message.token);
      return { success: true };
    }

    case "CLEAR_TOKEN": {
      await clearToken();
      return { success: true };
    }

    case "GET_PROFILE": {
      const profile = await fetchProfile(message.locale);
      return { success: true, data: profile };
    }

    case "GET_FLAT_PROFILE": {
      const flat = await fetchFlatProfile(message.locale, message.force);
      return { success: true, data: flat };
    }

    case "FILL_ACTIVE_TAB":
      return sendToActiveTab<MessageResponse>({ type: "TRIGGER_FILL" });

    case "TOGGLE_ACTIVE_TAB":
      return sendToActiveTab<MessageResponse>({ type: "TOGGLE_WIDGET" });

    case "RECORD_SUBMISSION": {
      try {
        await postSubmission(message.data as Record<string, unknown>);
      } catch (err) {
        if (!isRetryableApiError(err)) throw err;
        if (process.env.NODE_ENV !== "production") console.warn("[Joblit] Submission failed, queuing:", err);
        await enqueue("submission", message.data as Record<string, unknown>);
      }
      return { success: true };
    }

    case "GET_SUBMISSIONS": {
      const submissions = await fetchSubmissions(message.params ?? {});
      return { success: true, data: submissions };
    }

    case "GET_FIELD_MAPPINGS": {
      const mappings = await fetchFieldMappings(message.params ?? {});
      return { success: true, data: mappings };
    }

    case "PUT_FIELD_MAPPING": {
      try {
        const mapping = await putFieldMapping(message.data as Record<string, unknown>);
        return { success: true, data: mapping };
      } catch (err) {
        if (isRetryableApiError(err)) {
          if (process.env.NODE_ENV !== "production") console.warn("[Joblit] Field mapping save failed, queuing:", err);
          await enqueue("field_mapping", message.data as Record<string, unknown>);
        }
        const errorMessage = err instanceof Error ? err.message : "Save failed";
        return { success: false, error: errorMessage };
      }
    }

    case "MATCH_JOB": {
      const job = await matchJob(message.url);
      return { success: true, data: job };
    }

    case "MARK_JOB_APPLIED": {
      const result = await markJobApplied(message.jobId);
      return { success: true, data: result };
    }

    case "IMPORT_SEEK_JOBS": {
      const result = await importSeekJobs(message.data.items);
      return { success: true, data: result };
    }

    case "GET_CONTENT_SETTINGS": {
      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.PREFERENCES,
        STORAGE_KEYS.WIDGET_POSITION,
      ]);
      const preferences = isRecord(stored[STORAGE_KEYS.PREFERENCES])
        ? stored[STORAGE_KEYS.PREFERENCES]
        : {};
      const safePreferences = {
        autoFill: preferences?.autoFill === true,
        showWidget: preferences?.showWidget !== false,
      };
      const position = stored[STORAGE_KEYS.WIDGET_POSITION];
      return {
        success: true,
        data: {
          preferences: safePreferences,
          ...(isWidgetPosition(position) ? { widgetPosition: position } : {}),
        },
      };
    }

    case "SET_WIDGET_POSITION": {
      if (!isWidgetPosition(message.position)) {
        throw new HermesApiError("INVALID_REQUEST", "Invalid widget position");
      }
      await chrome.storage.local.set({ [STORAGE_KEYS.WIDGET_POSITION]: message.position });
      return { success: true };
    }

    case "LOCAL_AI_GET_STATUS": {
      requireSender(isJoblitWebSender(sender));
      return { success: true, data: await getPublicLocalAiStatus() };
    }

    case "LOCAL_AI_START_RUN": {
      requireSender(isJoblitWebSender(sender));
      return { success: true, data: await startLocalAiRun(message.payload) };
    }

    case "LOCAL_AI_GET_RUN": {
      requireSender(isJoblitWebSender(sender));
      return { success: true, data: await getLocalAiRun(message.payload) };
    }

    case "LOCAL_AI_STOP_RUN": {
      requireSender(isJoblitWebSender(sender));
      return { success: true, data: await stopLocalAiRun(message.payload) };
    }

    case "LOCAL_AI_REPAIR_RUN": {
      requireSender(isJoblitWebSender(sender));
      return { success: true, data: await repairLocalAiRun(message.payload) };
    }

    case "GET_HERMES_SETTINGS": {
      requireSender(isExtensionPageSender(sender));
      return { success: true, data: await getHermesSettingsPublic() };
    }

    case "CHECK_HERMES_SETTINGS": {
      requireSender(isExtensionPageSender(sender));
      return { success: true, data: await checkHermesSettings() };
    }

    case "TEST_AND_SAVE_HERMES_SETTINGS": {
      requireSender(isExtensionPageSender(sender));
      return { success: true, data: await testAndSaveHermesSettings(message.data) };
    }

    case "CLEAR_HERMES_SETTINGS": {
      requireSender(isExtensionPageSender(sender));
      await forgetHermesSettings();
      return { success: true };
    }

    default:
      return { success: false, error: "Unknown message type" };
  }
}

/** Handle keyboard shortcuts. */
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "fill-form") {
    await sendToActiveTab({ type: "TRIGGER_FILL" }).catch(() => {
      // Keyboard commands have no response surface; keep failures non-blocking.
    });
  }

  if (command === "toggle-widget") {
    await sendToActiveTab({ type: "TOGGLE_WIDGET" }).catch(() => {
      // Keyboard commands have no response surface; keep failures non-blocking.
    });
  }
});

/** Process offline sync queue when connectivity is restored. */
self.addEventListener("online", () => {
  void storageReady.then(() => processQueue()).catch(() => undefined);
});

/** Also process queue on service worker startup (handles restart after being idle). */
void storageReady.then(() => processQueue()).catch(() => undefined);
