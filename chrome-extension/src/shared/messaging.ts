import type { MessageType, MessageResponse } from "./types";

/** Type-safe wrapper for sending messages to the background service worker. */
export function sendMessage<T = unknown>(
  message: MessageType,
): Promise<MessageResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: MessageResponse<T>) => {
      if (chrome.runtime.lastError) {
        resolve({
          success: false,
          error: chrome.runtime.lastError.message ?? "Unknown error",
        });
        return;
      }
      resolve(response);
    });
  });
}
