import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMotionPreference } from "./useMotionPreference";

const originalMatchMedia = window.matchMedia;
afterEach(() => { cleanup(); window.matchMedia = originalMatchMedia; });

describe("useMotionPreference", () => {
  it("uses a still server snapshot without reading browser APIs", () => {
    const matchMedia = vi.fn(() => { throw new Error("Server rendering must not inspect the browser"); });
    window.matchMedia = matchMedia;
    function Preference() {
      return <span>{useMotionPreference() ? "still" : "animated"}</span>;
    }
    expect(renderToString(<Preference />)).toBe("<span>still</span>");
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it("reacts to media-query events and removes its subscription on unmount", () => {
    const media = Object.assign(new EventTarget(), { matches: false });
    const remove = vi.spyOn(media, "removeEventListener");
    window.matchMedia = () => media as MediaQueryList;
    const { result, unmount } = renderHook(() => useMotionPreference());
    expect(result.current).toBe(false);
    act(() => { media.matches = true; media.dispatchEvent(new Event("change")); });
    expect(result.current).toBe(true);
    act(() => { media.matches = false; media.dispatchEvent(new Event("change")); });
    expect(result.current).toBe(false);
    unmount();
    expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
