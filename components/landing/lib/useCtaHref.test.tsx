import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
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

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider
        locale="en"
        messages={{
          landing: {
            nav: {
              startFree: "Start free",
              openApp: "Open app",
            },
          },
        }}
      >
        {children}
      </NextIntlClientProvider>
    );
  }

  it.each([
    ["authenticated", "/jobs", "Open app"],
    ["unauthenticated", "/login", "Start free"],
    ["loading", "/login", "Start free"],
  ] as const)("routes %s sessions to %s with label %s", (status, href, label) => {
    session.status = status;

    const { result } = renderHook(() => useCtaHref(), { wrapper });

    expect(result.current).toEqual({ href, disabled: false, label });
  });
});
