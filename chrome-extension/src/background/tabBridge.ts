import type { ContentMessage } from "@ext/shared/types";

function isMissingReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /receiving end does not exist|could not establish connection/i.test(
    message,
  );
}

const INJECTION_RETRY_DELAYS_MS = [25, 75, 150] as const;

async function forwardAfterInjection<T>(
  tabId: number,
  message: ContentMessage,
): Promise<T> {
  for (
    let attempt = 0;
    attempt <= INJECTION_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return (await chrome.tabs.sendMessage(tabId, message)) as T;
    } catch (error) {
      if (
        !isMissingReceiverError(error) ||
        attempt === INJECTION_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, INJECTION_RETRY_DELAYS_MS[attempt]),
      );
    }
  }

  throw new Error("Content script did not become ready");
}

export async function sendToActiveTab<T>(
  message: ContentMessage,
): Promise<T> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) throw new Error("No active tab is available");

  const tabId = tab.id;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "JOBLIT_PING" });
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;

    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
    if (!files?.length) {
      throw new Error(
        "Content script loader is missing from the extension manifest",
      );
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files,
    });

    return forwardAfterInjection<T>(tabId, message);
  }

  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}
