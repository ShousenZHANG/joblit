/** Centralized error handling for the extension. */

export interface ExtError {
  code: string;
  message: string;
  recoverable: boolean;
}

/** Classify an error into a structured ExtError. */
export function classifyError(err: unknown): ExtError {
  if (err instanceof TypeError && err.message.includes("Failed to fetch")) {
    return { code: "NETWORK", message: "error.network", recoverable: true };
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    if (msg.includes("not authenticated") || msg.includes("invalid or expired token")) {
      return { code: "AUTH", message: "error.notAuthenticated", recoverable: false };
    }

    if (msg.includes("profile fetch failed") || msg.includes("flat profile fetch failed")) {
      return { code: "PROFILE", message: "error.profileLoad", recoverable: true };
    }

    if (msg.includes("network") || msg.includes("fetch")) {
      return { code: "NETWORK", message: "error.network", recoverable: true };
    }

    return { code: "UNKNOWN", message: err.message, recoverable: false };
  }

  return { code: "UNKNOWN", message: "error.unknown", recoverable: false };
}

/** Extract a user-friendly error message from an unknown error. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unexpected error occurred.";
}
