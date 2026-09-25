import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { SiteHeader } from "./SiteHeader";

const session = vi.hoisted(() => ({
  status: "unauthenticated" as "authenticated" | "unauthenticated" | "loading",
}));
const theme = vi.hoisted(() => ({ value: "light", setTheme: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: session.status }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: theme.value, setTheme: theme.setTheme }) }));

const nav = messages.landingExperience.nav;
const cta = messages.landing.nav;
const originalWidth = window.innerWidth;

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

function renderHeader() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SiteHeader />
      <section id="how-it-works" aria-label="How it works destination"><h2>How it works</h2></section>
      <button type="button">Outside navigation</button>
    </NextIntlClientProvider>,
  );
}

function mobileMenu() {
  const toggle = screen.getByRole("button", { name: nav.closeMenu });
  return document.getElementById(toggle.getAttribute("aria-controls")!)!;
}

describe("SiteHeader interaction", () => {
  beforeEach(() => { session.status = "unauthenticated"; theme.value = "light"; theme.setTheme.mockReset(); setWidth(390); });
  afterEach(() => { cleanup(); setWidth(originalWidth); vi.restoreAllMocks(); });

  it("opens from the keyboard, reaches menu links, and restores toggle focus on Escape", async () => {
    const user = userEvent.setup();
    renderHeader();
    const toggle = screen.getByRole("button", { name: nav.openMenu });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const menu = mobileMenu();
    await user.tab();
    expect(within(menu).getByRole("link", { name: nav.howItWorks })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    expect(menu).not.toBeInTheDocument();
  });

  it("hands focus to the anchor destination before removing the menu", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole("button", { name: nav.openMenu }));
    const menu = mobileMenu();
    within(menu).getByRole("link", { name: nav.howItWorks }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "How it works destination" })).toHaveFocus();
    expect(menu).not.toBeInTheDocument();
  });

  it.each(["menu link", "toggle"] as const)("moves %s focus to the visible home link at the desktop breakpoint", async focusOn => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole("button", { name: nav.openMenu }));
    const menu = mobileMenu();
    if (focusOn === "menu link") within(menu).getByRole("link", { name: nav.howItWorks }).focus();
    act(() => setWidth(960));
    expect(menu).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: nav.home })).toHaveFocus();
  });

  it("does not steal focus from other content when a resize closes the menu", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole("button", { name: nav.openMenu }));
    const outside = screen.getByRole("button", { name: "Outside navigation" });
    outside.focus();
    act(() => setWidth(960));
    expect(outside).toHaveFocus();
    expect(screen.getByRole("button", { name: nav.openMenu })).toHaveAttribute("aria-expanded", "false");
  });

  it.each([
    ["light", "dark", messages.common.themeSwitchToDark],
    ["dark", "light", messages.common.themeSwitchToLight],
  ] as const)("keeps the theme switch in the main navigation in %s mode", async (current, next, label) => {
    theme.value = current;
    const user = userEvent.setup();
    renderHeader();
    const navigation = screen.getByRole("navigation", { name: nav.primary });
    const control = within(navigation).getByRole("button", { name: label });
    await user.click(control);
    expect(theme.setTheme).toHaveBeenCalledWith(next);
    await user.click(screen.getByRole("button", { name: nav.openMenu }));
    expect(within(navigation).getByRole("button", { name: label })).toBe(control);
  });

  it("offers the language switch and source link inside the mobile menu", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole("button", { name: nav.openMenu }));
    const menu = mobileMenu();
    expect(within(menu).getByRole("button", { name: "EN" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "中文" })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: nav.github })).toHaveAttribute("href", "https://github.com/ShousenZHANG/joblit");
  });

  it.each([
    ["unauthenticated", cta.startFree, "/login?callbackUrl=/jobs"],
    ["loading", cta.startFree, "/jobs"],
    ["authenticated", cta.openApp, "/jobs"],
  ] as const)("routes and labels the workspace link for a %s visitor", (status, label, href) => {
    session.status = status;
    renderHeader();
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
  });
});
