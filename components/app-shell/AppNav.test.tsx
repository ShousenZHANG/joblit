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

const marketState = vi.hoisted(() => ({ value: "AU" as "AU" | "CN" }));
vi.mock("@/hooks/useMarket", () => ({
  useMarket: () => marketState.value,
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

/**
 * Language, theme, the guide and signing out are once-or-rarely actions, so
 * they moved behind the account avatar rather than standing in the bar.
 */
async function openAccountMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("app-nav-account"));
  return screen.findByRole("menu");
}

describe("AppNav", () => {
  beforeEach(() => {
    signOutMock.mockReset();
    signOutMock.mockResolvedValue(undefined);
    openGuideMock.mockClear();
    mockPathname = "/jobs";
    marketState.value = "AU";
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
    const menu = await openAccountMenu(user);
    const signOut = within(menu).getByRole("menuitem", { name: /signOut/i });

    await user.click(signOut);
    await user.click(signOut);

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(
      within(menu).getByRole("menuitem", { name: /signingOut/i }),
    ).toHaveAttribute("aria-busy", "true");
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

  it("renders the 3 primary AU app links in the desktop nav", () => {
    render(<AppNav />);
    const scope = desktopScope();
    expect(scope.getByRole("link", { name: /jobs/i })).toBeInTheDocument();
    expect(scope.getByRole("link", { name: /fetch/i })).toBeInTheDocument();
    expect(scope.getByRole("link", { name: /resume/i })).toBeInTheDocument();
    expect(scope.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
    // Two routes became popovers rather than pages: trending was never a
    // workspace, and Runner setup turned out to be one credential and one
    // command.
    expect(
      scope.queryByRole("link", { name: /discover/i }),
    ).not.toBeInTheDocument();
    expect(scope.queryByRole("link", { name: /agent/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("runner-setup-trigger")).toBeInTheDocument();
  });

  it("keeps the CN navigation focused on Resume", () => {
    marketState.value = "CN";
    render(<AppNav />);

    const scope = desktopScope();
    expect(scope.queryByRole("link", { name: /jobs/i })).not.toBeInTheDocument();
    expect(scope.queryByRole("link", { name: /fetch/i })).not.toBeInTheDocument();
    expect(scope.getByRole("link", { name: /resume/i })).toBeInTheDocument();
    expect(
      scope.queryByRole("link", { name: /agent/i }),
    ).not.toBeInTheDocument();
  });

  it("offers the trending popover in both markets", () => {
    render(<AppNav />);
    expect(screen.getByTestId("trending-trigger")).toBeInTheDocument();
    cleanup();

    marketState.value = "CN";
    render(<AppNav />);
    expect(screen.getByTestId("trending-trigger")).toBeInTheDocument();
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

  it("keeps the session identity and sign-out in the account menu, not the bar", async () => {
    const user = userEvent.setup();
    render(<AppNav />);

    // The address identifies the session; it is not a control, so it does not
    // stand in the bar.
    expect(screen.queryByText(/alex@joblit\.tech/i)).not.toBeInTheDocument();

    const menu = await openAccountMenu(user);
    expect(within(menu).getByText(/alex@joblit\.tech/i)).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: /signOut/i }),
    ).toBeInTheDocument();
  });

  it("renders a sticky container so the nav follows page scroll", () => {
    render(<AppNav />);
    const nav = screen.getByTestId("app-nav");
    expect(nav.className).toMatch(/\bsticky\b/);
  });

  it("reaches the guide and its progress from the account menu", async () => {
    const user = userEvent.setup();
    render(<AppNav />);
    const menu = await openAccountMenu(user);

    const guide = within(menu).getByRole("menuitem", { name: /guide/i });
    expect(guide).toBeInTheDocument();
    expect(within(menu).getByText("3/5")).toBeInTheDocument();
  });
});
