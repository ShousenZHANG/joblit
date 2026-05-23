"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { CircleHelp, LogOut } from "lucide-react";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { LocaleSwitcher } from "@/components/LocaleSwitcher";
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

/** Scroll app scroll container + window to top on route change, matching
 *  the legacy TopNav behavior so in-view state doesn't carry over. */
function useResetScrollOnNavigate() {
  return () => {
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (appShell) appShell.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };
}

export function AppNav() {
  const { data } = useSession();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const { openGuide, state } = useGuide();
  const resetScroll = useResetScrollOnNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links: NavLink[] = [
    { href: "/jobs", label: t("jobs") },
    { href: "/fetch", label: t("fetch") },
    { href: "/resume", label: t("resume") },
    { href: "/discover", label: t("discover") },
    { href: "/extension", label: "Extension" },
  ];
  const email = data?.user?.email ?? "";

  return (
    <nav
      data-testid="app-nav"
      aria-label="Primary"
      className="sticky top-3 z-50 mx-auto w-full max-w-[1360px] px-4 sm:top-4 sm:px-6"
    >
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: scrolled ? 0.97 : 1,
          paddingTop: scrolled ? 7 : 9,
          paddingBottom: scrolled ? 7 : 9,
          boxShadow: scrolled
            ? "0 14px 36px -16px rgba(5, 150, 105, 0.26), 0 4px 12px -4px rgba(15, 23, 42, 0.08)"
            : "0 8px 24px -12px rgba(5, 150, 105, 0.14), 0 2px 6px -2px rgba(15, 23, 42, 0.04)",
        }}
        transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        className="flex w-full items-center justify-between gap-3 rounded-full border border-border/60 bg-[var(--landing-nav-bg,rgba(255,255,255,0.82))] px-3 backdrop-blur-xl backdrop-saturate-150 sm:px-4"
        style={{ transformOrigin: "top center", willChange: "transform" }}
      >
        {/* Left: logo + primary links */}
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground transition-colors hover:text-brand-emerald-700 focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
            aria-label="Joblit home"
            onClick={resetScroll}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
              <JoblitMark size={18} color="var(--brand-emerald-700, #047857)" ariaLabel={null} />
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
              const active = pathname.startsWith(link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={resetScroll}
                    aria-current={active ? "page" : undefined}
                    className={
                      "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors " +
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
              className="hidden text-[12px] text-brand-emerald-700 transition-colors hover:text-brand-emerald-800 hover:underline xl:inline-block"
              title={email}
            >
              {email}
            </a>
          ) : null}
          <button
            type="button"
            onClick={openGuide}
            className="hidden items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
          >
            <CircleHelp className="h-3.5 w-3.5" aria-hidden />
            <span>{t("guide")}</span>
            {state ? (
              <span className="rounded-full bg-brand-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-emerald-700">
                {state.completedCount}/{state.totalCount}
              </span>
            ) : null}
          </button>

          <div className="hidden lg:inline-flex">
            <LocaleSwitcher />
          </div>
          <ThemeToggle className="hidden sm:inline-flex" />

          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="hidden items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background transition-colors hover:bg-foreground/90 md:inline-flex"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            {tc("signOut")}
          </button>

          {/* Mobile overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More options"
                data-testid="app-nav-mobile-menu"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-muted md:hidden"
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
              {links.map((link) => (
                <DropdownMenuItem key={link.href} asChild>
                  <Link href={link.href} onClick={resetScroll}>
                    {link.label}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openGuide}>
                <CircleHelp className="mr-2 h-4 w-4" />
                <span>{t("guide")}</span>
                {state ? (
                  <span className="ml-auto rounded-full bg-brand-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-emerald-700">
                    {state.completedCount}/{state.totalCount}
                  </span>
                ) : null}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <div className="flex flex-col gap-1 py-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Language
                  </span>
                  <LocaleSwitcher />
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                {tc("signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.div>
    </nav>
  );
}
