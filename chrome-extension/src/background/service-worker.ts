import type { MessageType, MessageResponse } from "@ext/shared/types";
import { setToken, clearToken, getAuthStatus } from "./auth";
import { fetchProfile, fetchFlatProfile, postSubmission, fetchSubmissions, fetchFieldMappings, putFieldMapping, matchJob, markJobApplied } from "./api";
import { enqueue } from "./syncQueue";
import { processQueue } from "./syncProcessor";

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
      const flat = await fetchFlatProfile(message.locale);
      return { success: true, data: flat };
    }

    case "RECORD_SUBMISSION": {
      try {
        await postSubmission(message.data as Record<string, unknown>);
      } catch {
        // Offline or server error — queue for later sync
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
      } catch {
        await enqueue("field_mapping", message.data as Record<string, unknown>);
        return { success: true };
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

    default:
      return { success: false, error: "Unknown message type" };
  }
}

/** Handle keyboard shortcuts. */
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "fill-form") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_FILL" });
    }
  }

  if (command === "toggle-widget") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_WIDGET" });
    }
  }
});

/** Process offline sync queue when connectivity is restored. */
self.addEventListener("online", () => {
  processQueue();
});

/** Also process queue on service worker startup (handles restart after being idle). */
processQueue();
