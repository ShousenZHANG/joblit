"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { CircleHelp, LogOut } from "lucide-react";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { useRef, useState } from "react";

import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { useMarket } from "@/hooks/useMarket";
import { ThemeToggle } from "@/components/providers/ThemeProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGuide } from "@/app/GuideContext";

// AppNav — landing-aligned sticky pill for authenticated app pages.
//
// Visual contract (parity with `components/landing/Nav.tsx`):
// - `position: sticky` (NOT fixed) so the nav rides the scroll
// - Baseline: opaque pill (--landing-nav-bg) + soft emerald shadow +
//   blur + border — visible at rest, not transparent
// - On scroll (> 20px): scale 0.97, tighter padding, deeper emerald
//   shadow (motion.div animates continuously)
// - Dark mode: all colors drawn from theme tokens, no hardcoded white

interface NavLink {
  href: string;
  label: string;
}

function isRouteActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const { data } = useSession();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const { openGuide, state } = useGuide();
  const reduce = useReducedMotion();
  const [signingOut, setSigningOut] = useState(false);
  const signOutInFlight = useRef(false);
  // NOTE: the old scroll-shrink effect listened to window scroll, but the app
  // shell scrolls an inner container — window.scrollY was permanently 0 and
  // the shrink never fired. Removed as dead code (static resting style kept).

  // CN market support is temporarily limited to Resume + Discover. Jobs/Fetch
  // (and the autofill Extension) are hidden there until CN-market search ships.
  const isCN = useMarket() === "CN";
  const links: NavLink[] = isCN
    ? [
        { href: "/resume", label: t("resume") },
        { href: "/discover", label: t("discover") },
      ]
    : [
        { href: "/jobs", label: t("jobs") },
        { href: "/fetch", label: t("fetch") },
        { href: "/resume", label: t("resume") },
        { href: "/discover", label: t("discover") },
        { href: "/extension", label: t("extension") },
      ];
  const email = data?.user?.email ?? "";

  const handleSignOut = async () => {
    if (signOutInFlight.current) return;

    signOutInFlight.current = true;
    setSigningOut(true);
    try {
      await signOut({ callbackUrl: "/login" });
    } catch {
      // Keep the current session usable so the user can retry the action.
    } finally {
      signOutInFlight.current = false;
      setSigningOut(false);
    }
  };

  return (
    <nav
      data-testid="app-nav"
      aria-label={t("primary")}
      className="sticky top-3 z-50 mx-auto w-full max-w-[1360px] px-4 sm:top-4 sm:px-6"
    >
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="cosmos-nav relative flex w-full items-center justify-between gap-3 rounded-full border border-border/60 bg-[var(--landing-nav-bg,rgba(255,255,255,0.82))] px-3 py-[9px] shadow-[0_8px_24px_-12px_rgba(5,150,105,0.14),0_2px_6px_-2px_rgba(15,23,42,0.04)] backdrop-blur-xl backdrop-saturate-150 sm:px-4"
      >
        {/* Left: logo + primary links */}
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/"
            className="flex h-11 shrink-0 items-center gap-2 rounded-full text-[15px] font-semibold tracking-tight text-foreground transition-colors hover:text-brand-emerald-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 md:h-9"
            aria-label={t("home")}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
              <JoblitMark size={18} color="var(--brand-emerald-text, #047857)" ariaLabel={null} />
            </span>
            Joblit
          </Link>

          {/* Desktop link row */}
          <ul
            className="hidden items-center gap-0.5 md:flex"
            role="list"
            data-testid="app-nav-links"
          >
            {links.map((link) => {
              const active = isRouteActive(pathname, link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      "inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 " +
                      (active
                        ? "bg-brand-emerald-600 text-white shadow-sm"
                        : "text-foreground/70 hover:bg-muted hover:text-foreground")
                    }
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Right: session + controls */}
        <div className="flex items-center gap-2">
          {email ? (
            <a
              href={`mailto:${email}`}
              className="hidden rounded-full text-[12px] text-brand-emerald-text transition-colors hover:text-brand-emerald-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 xl:inline-block"
              title={email}
            >
              {email}
            </a>
          ) : null}
          {!isCN ? (
          <button
            type="button"
            onClick={openGuide}
            className="hidden h-11 items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 md:inline-flex md:h-9"
          >
            <CircleHelp className="h-3.5 w-3.5" aria-hidden />
            <span>{t("guide")}</span>
            {state ? (
              <span className="inline-flex items-center gap-1 text-brand-emerald-600">
                <svg className="h-3.5 w-3.5 -rotate-90" viewBox="0 0 16 16" aria-hidden>
                  <circle
                    cx="8"
                    cy="8"
                    r="6.5"
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.2"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx="8"
                    cy="8"
                    r="6.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={`${(state.completedCount / state.totalCount) * 40.84} 40.84`}
                    className="transition-[stroke-dasharray] duration-500 ease-out"
                  />
                </svg>
                <span className="text-[10px] font-semibold text-brand-emerald-text">
                  {state.completedCount}/{state.totalCount}
                </span>
              </span>
            ) : null}
          </button>
          ) : null}

          <div className="hidden lg:inline-flex">
            <LocaleSwitcher />
          </div>
          <ThemeToggle className="hidden sm:inline-flex" />

          {/* ⌘K affordance — the palette itself lives in the app layout and
              listens for this event, avoiding prop-drilling through a server
              component. */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("joblit:command-palette"))}
            aria-label={t("openCommands")}
            aria-haspopup="dialog"
            className="hidden h-11 items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 text-[11px] font-medium text-muted-foreground transition-[color,background-color,border-color,transform] hover:border-brand-emerald-500/40 hover:text-foreground active:scale-95 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 sm:inline-flex md:h-9"
          >
            <kbd className="font-sans text-[11px]">⌘K</kbd>
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-busy={signingOut}
            className="hidden h-11 w-[7.5rem] items-center justify-center gap-1.5 rounded-full bg-foreground px-3 text-[12px] font-semibold text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 md:inline-flex md:h-9"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            <span>{tc(signingOut ? "signingOut" : "signOut")}</span>
          </button>

          {/* Mobile overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("moreOptions")}
                data-testid="app-nav-mobile-menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-muted active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 md:hidden"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <circle cx="5" cy="12" r="2" fill="currentColor" />
                  <circle cx="12" cy="12" r="2" fill="currentColor" />
                  <circle cx="19" cy="12" r="2" fill="currentColor" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              {links.map((link) => {
                const active = isRouteActive(pathname, link.href);
                return (
                  <DropdownMenuItem key={link.href} asChild>
                    <Link
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={
                        "min-h-11 focus-visible:ring-2 focus-visible:ring-brand-emerald-600 " +
                        (active
                          ? "bg-brand-emerald-50 font-semibold text-brand-emerald-text"
                          : "")
                      }
                    >
                      {link.label}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              {!isCN ? (
                <DropdownMenuItem
                  onClick={openGuide}
                  className="min-h-11 focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
                >
                  <CircleHelp className="mr-2 h-4 w-4" />
                  <span>{t("guide")}</span>
                  {state ? (
                    <span className="ml-auto rounded-full bg-brand-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-emerald-text">
                      {state.completedCount}/{state.totalCount}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                asChild
                className="min-h-11 focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
              >
                <div className="flex flex-col gap-1 py-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("language")}
                  </span>
                  <LocaleSwitcher size="touch" />
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                onSelect={(e) => e.preventDefault()}
                className="min-h-11 focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
              >
                <div className="flex items-center justify-between py-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("theme")}
                  </span>
                  <ThemeToggle size="touch" />
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void handleSignOut();
                }}
                disabled={signingOut}
                aria-busy={signingOut}
                className="min-h-11 text-destructive focus-visible:ring-2 focus-visible:ring-brand-emerald-600 data-[disabled]:cursor-wait"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>{tc(signingOut ? "signingOut" : "signOut")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.div>
    </nav>
  );
}
