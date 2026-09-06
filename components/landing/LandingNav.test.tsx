import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { LandingNav } from "./LandingNav";

const session = vi.hoisted(() => ({
  status: "unauthenticated" as "authenticated" | "unauthenticated" | "loading",
}));
const theme = vi.hoisted(() => ({ value: "light", setTheme: vi.fn() }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: session.status }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: theme.value, setTheme: theme.setTheme }) }));

const nav = messages.landingExperience.nav;
const originalWidth = window.innerWidth;

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

function renderNav(motionControl?: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LandingNav motionControl={motionControl} />
      <section id="workflow" aria-label="Workflow destination"><h2>Workflow</h2></section>
      <button type="button">Outside navigation</button>
    </NextIntlClientProvider>,
  );
}

function mobileMenu() {
  const toggle = screen.getByRole("button", { name: nav.closeMenu });
  return document.getElementById(toggle.getAttribute("aria-controls")!)!;
}

describe("LandingNav interaction", () => {
  beforeEach(() => { session.status = "unauthenticated"; theme.value = "light"; theme.setTheme.mockReset(); setWidth(390); });
  afterEach(() => { cleanup(); setWidth(originalWidth); vi.restoreAllMocks(); });

  it("opens from the keyboard, reaches menu links, and restores toggle focus on Escape", async () => {
    const user = userEvent.setup();
    renderNav();
    const toggle = screen.getByRole("button", { name: nav.openMenu });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const menu = mobileMenu();
    await user.tab();
    expect(within(menu).getByRole("link", { name: nav.workflow })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    expect(menu).not.toBeInTheDocument();
  });

  it("hands focus to the anchor destination before removing the menu", async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole("button", { name: nav.openMenu }));
    const menu = mobileMenu();
    const link = within(menu).getByRole("link", { name: nav.workflow });
    link.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Workflow destination" })).toHaveFocus();
    expect(menu).not.toBeInTheDocument();
  });

  it.each(["menu link", "toggle"] as const)("moves %s focus to the visible home link at the desktop breakpoint", async (focusOn) => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole("button", { name: nav.openMenu }));
    const menu = mobileMenu();
    if (focusOn === "menu link") within(menu).getByRole("link", { name: nav.workflow }).focus();
    act(() => setWidth(960));
    expect(menu).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: nav.home })).toHaveFocus();
  });

  it("does not steal focus from other content when a resize closes the disclosure", async () => {
    const user = userEvent.setup();
    renderNav();
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
  ] as const)("keeps the shared theme switch in the main navigation in %s mode", async (current, next, label) => {
    theme.value = current;
    const user = userEvent.setup();
    renderNav();
    const navigation = screen.getByRole("navigation", { name: nav.primary });
    const control = within(navigation).getByRole("button", { name: label });
    await user.click(control);
    expect(theme.setTheme).toHaveBeenCalledWith(next);
    await user.click(screen.getByRole("button", { name: nav.openMenu }));
    expect(within(navigation).getByRole("button", { name: label })).toBe(control);
  });

  it("makes the supplied motion control and locale switch available inside the mobile menu", async () => {
    const user = userEvent.setup();
    const pause = vi.fn();
    renderNav(<button type="button" onClick={pause}>Pause scene</button>);
    await user.click(screen.getByRole("button", { name: nav.openMenu }));
    const menu = mobileMenu();
    await user.click(within(menu).getByRole("button", { name: "Pause scene" }));
    expect(pause).toHaveBeenCalledOnce();
    expect(within(menu).getByRole("button", { name: "EN" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "中文" })).toBeInTheDocument();
  });

  it.each([
    ["unauthenticated", "/login?callbackUrl=/jobs"],
    ["loading", "/jobs"],
    ["authenticated", "/jobs"],
  ] as const)("routes the workspace CTA for a %s visitor", (status, href) => {
    session.status = status;
    renderNav();
    expect(screen.getByRole("link", { name: nav.workspace })).toHaveAttribute("href", href);
  });
});
