import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { AppNav } from "./AppNav";

afterEach(() => {
  // Vitest doesn't auto-cleanup React Testing Library trees; without this
  // multiple renders stack in the same document and `getByTestId` hits
  // duplicate nodes from previous tests.
  cleanup();
});

// next-intl — return key as translation so assertions can match on the
// original key rather than a translated string.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

// next-auth
const signOutMock = vi.fn();
vi.mock("next-auth/react", () => ({
  signOut: (...args: unknown[]) => signOutMock(...args),
  useSession: () => ({ data: { user: { email: "alex@joblit.tech" } } }),
}));

// next-themes — provide mounted state so ThemeToggle renders its icon.
vi.mock("next-themes", async () => {
  const actual = await vi.importActual<typeof import("next-themes")>(
    "next-themes",
  );
  return {
    ...actual,
    useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
  };
});

// pathname control
let mockPathname = "/jobs";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Guide context — lightweight stub so AppNav renders without a real provider.
const openGuideMock = vi.fn();
vi.mock("@/app/GuideContext", () => ({
  useGuide: () => ({
    openGuide: openGuideMock,
    state: { completedCount: 3, totalCount: 5, isComplete: false },
  }),
}));

/** Return the desktop link list scope so we don't match mobile-dropdown
 *  duplicates. */
function desktopScope() {
  return within(screen.getByTestId("app-nav-links"));
}

describe("AppNav", () => {
  beforeEach(() => {
    signOutMock.mockClear();
    openGuideMock.mockClear();
    mockPathname = "/jobs";
  });

  it("renders all 5 primary app links in the desktop nav", () => {
    render(<AppNav />);
    const scope = desktopScope();
    expect(scope.getByRole("link", { name: /jobs/i })).toBeInTheDocument();
    expect(scope.getByRole("link", { name: /fetch/i })).toBeInTheDocument();
    expect(scope.getByRole("link", { name: /resume/i })).toBeInTheDocument();
    expect(scope.getByRole("link", { name: /discover/i })).toBeInTheDocument();
    expect(
      scope.getByRole("link", { name: /extension/i }),
    ).toBeInTheDocument();
  });

  it("marks the link matching the current path as active", () => {
    mockPathname = "/resume/rules";
    render(<AppNav />);
    const resume = desktopScope().getByRole("link", { name: /resume/i });
    expect(resume).toHaveAttribute("aria-current", "page");
  });

  it("surfaces the signed-in email and at least one sign-out control", () => {
    render(<AppNav />);
    expect(screen.getByText(/alex@joblit\.tech/i)).toBeInTheDocument();
    const signOuts = screen.getAllByRole("button", { name: /signOut/i });
    expect(signOuts.length).toBeGreaterThan(0);
  });

  it("renders a sticky container so the nav follows page scroll", () => {
    render(<AppNav />);
    const nav = screen.getByTestId("app-nav");
    expect(nav.className).toMatch(/\bsticky\b/);
  });

  it("exposes at least one guide progress control with counts", () => {
    render(<AppNav />);
    // Desktop + mobile both render a Guide button; accept either.
    const guideButtons = screen.getAllByRole("button", { name: /guide/i });
    expect(guideButtons.length).toBeGreaterThan(0);
    // Progress badge "3/5" appears at least once.
    expect(screen.getAllByText("3/5").length).toBeGreaterThan(0);
  });
});
