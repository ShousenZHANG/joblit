import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCtaHref } from "./useCtaHref";

const session = vi.hoisted(() => ({
  status: "loading" as "authenticated" | "unauthenticated" | "loading",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: session.status }),
}));

describe("useCtaHref", () => {
  beforeEach(() => {
    session.status = "loading";
  });

  it.each([
    ["authenticated", "/jobs"],
    ["unauthenticated", "/login"],
    ["loading", "#access"],
  ] as const)("routes %s sessions to %s without disabling the CTA", (status, href) => {
    session.status = status;

    const { result } = renderHook(() => useCtaHref());

    expect(result.current).toEqual({ href, disabled: false });
  });
});
