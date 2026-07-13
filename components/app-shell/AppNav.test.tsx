import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  useSession: () => ({
    data: { user: { email: "alex@joblit.tech" } },
  }),
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

function createDeferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function openMobileMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("app-nav-mobile-menu"));
  return screen.findByRole("menu");
}

describe("AppNav", () => {
  beforeEach(() => {
    signOutMock.mockReset();
    signOutMock.mockResolvedValue(undefined);
    openGuideMock.mockClear();
    mockPathname = "/jobs";
  });

  it("localizes navigation and exposes touch-safe controls", () => {
    render(<AppNav />);

    expect(screen.getByTestId("app-nav")).toHaveAttribute(
      "aria-label",
      "primary",
    );
    expect(screen.getByTestId("app-nav-mobile-menu")).toHaveClass(
      "h-11",
      "w-11",
    );
    expect(
      screen.getByRole("button", { name: "openCommands" }),
    ).toHaveAttribute("aria-haspopup", "dialog");
    expect(
      screen.getByRole("button", { name: "openCommands" }),
    ).toHaveClass("focus-visible:ring-2", "active:scale-95");
  });

  it("does not perform a manual scroll reset from links", async () => {
    const user = userEvent.setup();
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    render(<AppNav />);
    const resume = desktopScope().getByRole("link", { name: /resume/i });
    resume.addEventListener("click", (event) => event.preventDefault());

    await user.click(resume);

    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  it("prevents duplicate sign-out and exposes pending state", async () => {
    const user = userEvent.setup();
    signOutMock.mockReturnValue(new Promise(() => undefined));
    render(<AppNav />);
    const signOut = screen.getAllByRole("button", { name: /signOut/i })[0];

    await user.dblClick(signOut);

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(signOut).toBeDisabled();
    expect(signOut).toHaveAttribute("aria-busy", "true");
  });

  it("keeps overflow sign-out mounted and guarded until it resolves", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred();
    signOutMock.mockReturnValue(deferred.promise);
    render(<AppNav />);
    const menu = await openMobileMenu(user);

    await user.click(within(menu).getByRole("menuitem", { name: "signOut" }));

    const pending = within(menu).getByRole("menuitem", {
      name: "signingOut",
    });
    expect(pending).toBeVisible();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending).toHaveAttribute("aria-disabled", "true");
    await user.click(pending);
    expect(signOutMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    await waitFor(() => {
      const restored = within(menu).getByRole("menuitem", { name: "signOut" });
      expect(restored).toHaveAttribute("aria-busy", "false");
      expect(restored).not.toHaveAttribute("aria-disabled");
    });
  });

  it("restores overflow sign-out after a rejected request", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred();
    signOutMock.mockReturnValue(deferred.promise);
    render(<AppNav />);
    const menu = await openMobileMenu(user);

    await user.click(within(menu).getByRole("menuitem", { name: "signOut" }));

    expect(
      within(menu).getByRole("menuitem", { name: "signingOut" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(signOutMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.reject(new Error("sign-out failed"));
      await deferred.promise.catch(() => undefined);
    });

    await waitFor(() => {
      const restored = within(menu).getByRole("menuitem", { name: "signOut" });
      expect(restored).toHaveAttribute("aria-busy", "false");
      expect(restored).not.toHaveAttribute("aria-disabled");
    });
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("uses touch-sized locale and theme controls in the overflow menu", async () => {
    const user = userEvent.setup();
    render(<AppNav />);
    const menu = await openMobileMenu(user);

    expect(within(menu).getByRole("button", { name: "EN" })).toHaveClass(
      "min-h-11",
      "min-w-11",
    );
    expect(
      within(menu).getByRole("button", { name: "themeSwitchToDark" }),
    ).toHaveClass("h-11", "w-11");
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
    expect(scope.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("marks the link matching the current path as active", () => {
    mockPathname = "/resume/rules";
    render(<AppNav />);
    const resume = desktopScope().getByRole("link", { name: /resume/i });
    expect(resume).toHaveAttribute("aria-current", "page");
  });

  it("marks a nested route active in the mobile overflow", async () => {
    const user = userEvent.setup();
    mockPathname = "/resume/rules";
    render(<AppNav />);
    const menu = await openMobileMenu(user);
    const resume = within(menu).getByRole("menuitem", { name: /resume/i });

    expect(resume).toHaveAttribute("aria-current", "page");
    expect(resume).toHaveClass(
      "bg-brand-emerald-50",
      "text-brand-emerald-text",
    );
  });

  it("does not mark a sibling prefix as the active route", async () => {
    const user = userEvent.setup();
    mockPathname = "/jobs-board";
    render(<AppNav />);

    expect(
      desktopScope().getByRole("link", { name: /jobs/i }),
    ).not.toHaveAttribute("aria-current");

    const menu = await openMobileMenu(user);
    const jobs = within(menu).getByRole("menuitem", { name: /jobs/i });
    expect(jobs).not.toHaveAttribute("aria-current");
    expect(jobs).not.toHaveClass("bg-brand-emerald-50");
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
