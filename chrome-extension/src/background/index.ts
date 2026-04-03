import type { MessageType, MessageResponse } from "@ext/shared/types";
import { setToken, clearToken, getAuthStatus } from "./auth";
import { fetchProfile, fetchFlatProfile } from "./api";

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
