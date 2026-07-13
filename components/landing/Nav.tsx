"use client";

import Link from "next/link";
import { ArrowRight, Github, Menu, X } from "lucide-react";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/providers/ThemeProvider";
import { Magnetic } from "./lib/interactive";

// Glass navbar. Sticky at top 16px, gains a deeper shadow once the user
// scrolls past 20px. Smooth scroll handler hijacks clicks on `#anchor`
// links so the jumps feel native to the page.
//
// The previous "scale 0.97 on scroll" effect has been removed: it caused
// a visible "jump" at the threshold that read as glitchy rather than
// premium. The shadow change alone communicates the scroll state.

interface NavLink {
  label: string;
  href: string;
}

const GITHUB_REPO_URL = "https://github.com/ShousenZHANG/joblit";

export function Nav() {
  const { status } = useSession();
  const reduced = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const t = useTranslations("landing.nav");

  // Dropped the "Changelog" link — it pointed at a dead "#" anchor, which
  // reads as pre-launch in a primary nav. Re-add when a real page exists.
  const LINKS: NavLink[] = [
    { label: t("product"), href: "#product" },
    { label: t("howItWorks"), href: "#how" },
    { label: t("access"), href: "#access" },
    { label: t("faq"), href: "#faq" },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu on resize up to desktop so it never gets stuck open,
  // and on Escape — the dismissal keyboard users expect from any popover.
  useEffect(() => {
    if (!mobileOpen) return;
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  const handleSmoothScroll = useCallback(
    (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      setMobileOpen(false);
      if (!href.startsWith("#") || href === "#") return;
      const el = document.querySelector(href);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "start",
      });
    },
    [reduced],
  );

  // Invite-only: unauthenticated visitors go to the apply section, not straight
  // to /login (where the gate would reject an un-approved email). Approved /
  // existing users use the separate "Log in" link. Authenticated → straight in.
  const ctaHref =
    status === "authenticated"
      ? "/jobs"
      : "#access";
  const ctaLabel =
    status === "authenticated" ? t("openApp") : t("startFree");

  return (
    // Sticky (not fixed) so the nav genuinely FOLLOWS scroll within the
    // document flow — fixed was placing the nav in viewport-relative
    // space which read as "stuck at top, not following". No transform
    // on this wrapper so sticky works reliably.
    <nav
      data-testid="landing-nav"
      aria-label={t("primary")}
      className="sticky top-3 z-50 mx-auto w-full max-w-6xl px-3 sm:top-4 sm:px-6"
    >
      {/* Inner pill: backdrop-blur + thin border at rest. Scrolling deepens
          the elevation via two pre-painted shadow pseudo-layers cross-faded on
          opacity (see .landing-nav-pill) — animating box-shadow on a
          backdrop-blurred element forced a per-frame repaint and was the
          landing page's scroll-jank hotspot. */}
      <motion.div
        initial={reduced ? undefined : { opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduced ? 0 : 0.32,
          ease: [0.22, 1, 0.36, 1],
        }}
        data-scrolled={scrolled ? "true" : "false"}
        className="landing-nav-pill flex w-full min-w-0 items-center justify-between rounded-full border border-border/60 bg-[var(--landing-nav-bg,rgba(255,255,255,0.82))] px-3 py-2 backdrop-blur-xl backdrop-saturate-150 sm:px-5"
      >
        <Link
          href="/"
          className="flex min-h-11 min-w-0 shrink-0 items-center gap-2 rounded-lg text-[15px] font-semibold tracking-tight text-foreground transition-colors hover:text-brand-emerald-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:min-h-9"
          aria-label={t("home")}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
            <JoblitMark size={18} color="var(--brand-emerald-text, #047857)" ariaLabel={null} />
          </span>
          Joblit
        </Link>

        <ul className="hidden items-center gap-1 text-sm lg:flex" role="list">
          {LINKS.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                onClick={handleSmoothScroll(link.href)}
                className="rounded-full px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label={t("github")}
            title={t("github")}
            className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border/70 bg-background/75 px-2.5 text-[13px] font-semibold text-muted-foreground shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-brand-emerald-300 hover:bg-brand-emerald-50/70 hover:text-brand-emerald-800 hover:shadow-md active:translate-y-0 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-3 lg:h-9"
          >
            <Github className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden whitespace-nowrap lg:inline">GitHub</span>
          </a>
          <div className="hidden sm:inline-flex">
            <LocaleSwitcher size="touch" />
          </div>
          <div className="hidden sm:inline-flex">
            <ThemeToggle size="touch" />
          </div>
          {status === "unauthenticated" && (
            <Link
              href="/login"
              className="hidden min-h-11 items-center rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:inline-flex lg:min-h-9"
            >
              {t("logIn")}
            </Link>
          )}
          <Magnetic strength={5}>
            <Link
              href={ctaHref}
              aria-label={ctaLabel}
              className="inline-flex h-11 min-w-11 shrink-0 items-center gap-1 rounded-full bg-foreground px-3 text-[13px] font-semibold text-background shadow-sm transition-all hover:-translate-y-px hover:bg-foreground/90 hover:shadow-md active:translate-y-0 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-4 lg:h-9"
            >
              <span className="hidden whitespace-nowrap sm:inline">{ctaLabel}</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Magnetic>

          {/* Compact menu toggle — only surface under lg, where the inline
              link list is hidden. */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-panel"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/75 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
          >
            {mobileOpen ? (
              <X className="h-4 w-4" aria-hidden />
            ) : (
              <Menu className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </motion.div>

      {/* Mobile dropdown panel */}
      <AnimatePresence>
        {mobileOpen ? (
          <motion.div
            id="mobile-nav-panel"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mt-2 overflow-hidden rounded-2xl border border-border/60 bg-[var(--landing-nav-bg,rgba(255,255,255,0.92))] p-2 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.25)] backdrop-blur-xl lg:hidden"
          >
            <ul className="flex flex-col" role="list">
              {LINKS.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    onClick={handleSmoothScroll(link.href)}
                    className="inline-flex min-h-11 w-full items-center rounded-xl px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-inset"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
              {status === "unauthenticated" ? (
                <li>
                  <Link
                    href="/login"
                    onClick={() => setMobileOpen(false)}
                    className="inline-flex min-h-11 w-full items-center rounded-xl px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-inset"
                  >
                    {t("logIn")}
                  </Link>
                </li>
              ) : null}
            </ul>
            <div className="mt-1 flex items-center gap-2 border-t border-border/60 px-2 pt-2">
              <LocaleSwitcher size="touch" />
              <ThemeToggle size="touch" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </nav>
  );
}
