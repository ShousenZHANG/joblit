import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authGate = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next-auth/next", () => ({
  getServerSession: authGate.getServerSession,
}));

vi.mock("next/navigation", () => ({
  redirect: authGate.redirect,
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("./LoginPageClient", () => ({
  default: () => <div data-testid="login-client">Sign in</div>,
}));

import LoginPage from "./page";

describe("login server gate", () => {
  beforeEach(() => {
    authGate.getServerSession.mockReset();
    authGate.redirect.mockReset();
    authGate.redirect.mockImplementation((destination: string) => {
      throw new Error(`NEXT_REDIRECT:${destination}`);
    });
  });

  it("redirects an authenticated visitor before rendering login UI", async () => {
    authGate.getServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });

    await expect(
      LoginPage({
        searchParams: Promise.resolve({
          callbackUrl: "/resume?source=landing",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/resume?source=landing");

    expect(authGate.redirect).toHaveBeenCalledOnce();
    expect(authGate.redirect).toHaveBeenCalledWith(
      "/resume?source=landing",
    );
  });

  it("rejects an unsafe callback before redirecting an authenticated visitor", async () => {
    authGate.getServerSession.mockResolvedValue({
      user: { id: "user-1" },
    });

    await expect(
      LoginPage({
        searchParams: Promise.resolve({
          callbackUrl: "//evil.example/steal",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/jobs");

    expect(authGate.redirect).toHaveBeenCalledWith("/jobs");
  });

  it("renders the sign-in surface only for an unauthenticated visitor", async () => {
    authGate.getServerSession.mockResolvedValue(null);

    const page = await LoginPage({
      searchParams: Promise.resolve({}),
    });
    render(page);

    expect(screen.getByTestId("login-client")).toBeInTheDocument();
    expect(authGate.redirect).not.toHaveBeenCalled();
  });
});
