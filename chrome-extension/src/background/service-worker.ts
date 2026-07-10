import type { MessageType, MessageResponse } from "@ext/shared/types";
import { setToken, clearToken, getAuthStatus } from "./auth";
import { fetchProfile, fetchFlatProfile, postSubmission, fetchSubmissions, fetchFieldMappings, putFieldMapping, matchJob, markJobApplied, importSeekJobs } from "./api";
import { enqueue } from "./syncQueue";
import { processQueue } from "./syncProcessor";
import { sendToActiveTab } from "./tabBridge";
import { isRetryableApiError } from "./apiErrors";

/** Handle messages from content scripts and popup. */
chrome.runtime.onMessage.addListener(
  (
    message: MessageType,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err: unknown) => {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        sendResponse({ success: false, error: errorMessage });
      });

    // Return true to indicate async response
    return true;
  },
);

async function handleMessage(message: MessageType): Promise<MessageResponse> {
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
  processQueue();
});

/** Also process queue on service worker startup (handles restart after being idle). */
processQueue();
