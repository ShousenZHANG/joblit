import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { Nav } from "./Nav";

const session = vi.hoisted(() => ({
  status: "loading" as "authenticated" | "unauthenticated" | "loading",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: session.status }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

function renderNav(locale: "en" | "zh" = "en") {
  const messages = locale === "en" ? en : zh;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Nav />
    </NextIntlClientProvider>,
  );
}

describe("landing Nav", () => {
  beforeEach(() => {
    session.status = "loading";
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the loading CTA focusable and lets the protected app route resolve auth", () => {
    renderNav();

    const cta = screen.getByRole("link", { name: en.landing.nav.startFree });
    expect(cta).toHaveAttribute("href", "/jobs");
    expect(cta).not.toHaveAttribute("aria-disabled");
    expect(cta).not.toHaveAttribute("tabindex", "-1");
    expect(cta).not.toHaveClass("pointer-events-none");

    const retiredHref = ["#", "access"].join("");
    const linkHrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(linkHrefs).not.toContain(retiredHref);
  });

  it("routes authenticated visitors directly to the app", () => {
    session.status = "authenticated";
    renderNav();

    expect(screen.getByRole("link", { name: en.landing.nav.openApp })).toHaveAttribute(
      "href",
      "/jobs",
    );
  });

  it("anchors the three page movements in argument order", () => {
    renderNav();

    // The nav mirrors the page's argument: the loop, the boundary, the
    // objections. Each href must point at a real section id on the page —
    // page.test.tsx asserts the matching targets exist.
    expect(
      screen.getByRole("link", { name: en.landing.nav.howItWorks }),
    ).toHaveAttribute("href", "#flow");
    expect(
      screen.getByRole("link", { name: en.landing.nav.architecture }),
    ).toHaveAttribute("href", "#architecture");
    expect(
      screen.getByRole("link", { name: en.landing.nav.faq }),
    ).toHaveAttribute("href", "#faq");
  });

  it("keeps the CTA as the only solid control in the right cluster", () => {
    renderNav();

    const cta = screen.getByRole("link", { name: en.landing.nav.startFree });
    const github = screen.getByRole("link", { name: en.landing.nav.github });
    const theme = screen.getByRole("button", { name: "Switch to dark theme" });
    const localeEn = screen.getByRole("button", { name: "EN" });

    // One solid element: the CTA fills with the foreground color. Everything
    // else is a ghost — no border chrome, no foreground fill, muted active
    // states only.
    expect(cta.className).toContain("bg-foreground");
    for (const ghost of [github, theme, localeEn]) {
      expect(ghost.className).not.toContain("bg-foreground");
      expect(ghost.className).not.toContain("border-border");
    }

    // One focus ring family across every control, CTA included.
    for (const control of [cta, github, theme, localeEn]) {
      expect(control.className).toContain(
        "focus-visible:ring-brand-emerald-600",
      );
    }

    // One control height: touch-sized in the bar, collapsing to the desktop
    // height at lg.
    expect(github.className).toContain("h-11");
    expect(github.className).toContain("lg:h-9");
    expect(cta.className).toContain("h-11");
    expect(cta.className).toContain("lg:h-9");
  });

  it("uses localized Chinese labels and closes the mobile menu with Escape", async () => {
    const user = userEvent.setup();
    renderNav("zh");

    expect(screen.getByRole("navigation", { name: zh.landing.nav.primary })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: zh.landing.nav.home })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: zh.landing.nav.github })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换到深色主题" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: zh.landing.nav.openMenu }));
    expect(screen.getByRole("button", { name: zh.landing.nav.closeMenu })).toBeInTheDocument();
    expect(document.getElementById("mobile-nav-panel")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(document.getElementById("mobile-nav-panel")).not.toBeInTheDocument();
    });
  });

  it("provides 44px mobile targets, visible focus styles, and safe external links", () => {
    renderNav();

    const github = screen.getByRole("link", { name: en.landing.nav.github });
    const cta = screen.getByRole("link", { name: en.landing.nav.startFree });
    const menu = screen.getByRole("button", { name: en.landing.nav.openMenu });

    expect(github).toHaveClass("h-11", "min-w-11");
    expect(cta).toHaveClass("h-11", "min-w-11");
    expect(menu).toHaveClass("h-11", "w-11");
    expect(menu).toHaveClass("lg:hidden");
    expect(github.className).toContain("focus-visible:ring-2");
    expect(cta.className).toContain("focus-visible:ring-2");
    expect(github).toHaveAttribute("target", "_blank");
    expect(github).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("keeps the tablet login target touchable", () => {
    session.status = "unauthenticated";
    renderNav();

    expect(screen.getByRole("link", { name: en.landing.nav.logIn })).toHaveClass(
      "h-11",
      "lg:h-9",
    );
  });

  it("keeps the compact menu at tablet width and closes it at the lg breakpoint", async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole("button", { name: en.landing.nav.openMenu }));

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 768 });
    fireEvent(window, new Event("resize"));
    expect(document.getElementById("mobile-nav-panel")).toBeInTheDocument();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    fireEvent(window, new Event("resize"));
    await waitFor(() => {
      expect(document.getElementById("mobile-nav-panel")).not.toBeInTheDocument();
    });
  });
});
