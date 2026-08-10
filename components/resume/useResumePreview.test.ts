import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumeProfileSchema } from "@/lib/shared/schemas/resumeProfile";
import { useResumePreview } from "./useResumePreview";
import type { ResumeProfilePayload } from "./types";

/**
 * The dedup keys in this hook decide whether a compile happens at all, so a
 * bug in them is invisible in the UI until a preview silently never appears.
 * These tests pin the two states that actually shipped broken.
 */

const VALID_PROFILE = {
  locale: "en-AU",
  summary: "Engineer with a decade of platform work.",
  basics: {
    fullName: "Jane Doe",
    title: "Engineer",
    email: "jane@example.com",
    phone: "+61400000000",
    location: "Sydney",
  },
  links: [],
  skills: [],
  experiences: [],
  projects: [],
  education: [],
};

// schedulePreview silently no-ops on a payload the shared schema rejects, so
// an invalid fixture would make every test here pass by never fetching at
// all. Assert validity up front and fail loudly instead.
it("uses a fixture the shared schema accepts", () => {
  const parsed = ResumeProfileSchema.safeParse(VALID_PROFILE);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
});

function setup() {
  const fetchMock = vi.fn(
    async () =>
      new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const hook = renderHook(() =>
    useResumePreview({
      buildPayload: () => VALID_PROFILE as ResumeProfilePayload,
      hasAnyContent: true,
      t: (key: string) => key,
      toast: () => undefined,
    }),
  );
  return { hook, fetchMock };
}

beforeEach(() => {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => `blob:${Math.random()}`,
    revokeObjectURL: () => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useResumePreview dedup", () => {
  it("skips a repeat request for a payload already on screen", async () => {
    const { hook, fetchMock } = setup();

    act(() => hook.result.current.schedulePreview(0));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(hook.result.current.previewStatus).toBe("ready"),
    );

    act(() => hook.result.current.schedulePreview(0));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recompiles the same payload after resetPreview clears the state", async () => {
    // "New version → copy" produces a byte-identical draft. Clearing the PDF
    // without clearing the key it was built from left the pane permanently
    // blank: the recompile deduped against a preview that no longer existed.
    const { hook, fetchMock } = setup();

    act(() => hook.result.current.schedulePreview(0));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.pdfUrl).not.toBeNull());

    act(() => hook.result.current.resetPreview());
    expect(hook.result.current.pdfUrl).toBeNull();
    expect(hook.result.current.previewedKey).toBeNull();

    act(() => hook.result.current.schedulePreview(0));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("reports the key it rendered so callers can show pending changes", async () => {
    const { hook } = setup();
    expect(hook.result.current.previewedKey).toBeNull();

    act(() => hook.result.current.schedulePreview(0));
    await waitFor(() =>
      expect(hook.result.current.previewedKey).toBe(
        JSON.stringify(VALID_PROFILE),
      ),
    );
  });
});
