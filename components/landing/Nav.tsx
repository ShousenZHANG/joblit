"use client";

import Link from "next/link";
import { ArrowRight, Github } from "lucide-react";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { motion, useReducedMotion } from "framer-motion";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/providers/ThemeProvider";

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
  const t = useTranslations("landing.nav");

  const LINKS: NavLink[] = [
    { label: t("product"), href: "#product" },
    { label: t("howItWorks"), href: "#how" },
    { label: t("pricing"), href: "#pricing" },
    { label: t("faq"), href: "#faq" },
    { label: t("changelog"), href: "#" },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleSmoothScroll = useCallback(
    (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
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

  const ctaHref =
    status === "authenticated"
      ? "/jobs"
      : status === "unauthenticated"
        ? "/login"
        : "#";
  const ctaLabel =
    status === "authenticated" ? t("openApp") : t("startFree");

  return (
    // Sticky (not fixed) so the nav genuinely FOLLOWS scroll within the
    // document flow — fixed was placing the nav in viewport-relative
    // space which read as "stuck at top, not following". No transform
    // on this wrapper so sticky works reliably.
    <nav
      data-testid="landing-nav"
      aria-label="Primary"
      className="sticky top-3 z-50 mx-auto w-full max-w-6xl overflow-hidden px-3 sm:top-4 sm:px-6"
    >
      {/* Inner pill: backdrop-blur + thin border at rest. Scrolling deepens
          the shadow only — no scale/padding change, no infinite sheen. */}
      <motion.div
        initial={reduced ? undefined : { opacity: 0, y: -12 }}
        animate={{
          opacity: 1,
          y: 0,
          boxShadow: scrolled
            ? "0 12px 32px -16px rgba(15, 23, 42, 0.18), 0 2px 6px -2px rgba(15, 23, 42, 0.06)"
            : "0 6px 18px -12px rgba(15, 23, 42, 0.10), 0 1px 3px -1px rgba(15, 23, 42, 0.04)",
        }}
        transition={{
          duration: reduced ? 0 : 0.32,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="flex w-full min-w-0 items-center justify-between rounded-full border border-border/60 bg-[var(--landing-nav-bg,rgba(255,255,255,0.82))] px-3 py-2 backdrop-blur-xl backdrop-saturate-150 sm:px-5"
      >
        <Link
          href="/"
          className="flex min-w-0 shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground transition-colors hover:text-brand-emerald-700 focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
          aria-label="Joblit home"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
            <JoblitMark size={18} color="var(--brand-emerald-700, #047857)" ariaLabel={null} />
          </span>
          Joblit
        </Link>

        <ul className="hidden items-center gap-1 text-sm md:flex" role="list">
          {LINKS.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                onClick={handleSmoothScroll(link.href)}
                className="rounded-full px-3 py-1.5 text-[13px] font-medium text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
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
            aria-label="Star Joblit on GitHub"
            title="Star Joblit on GitHub"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border/70 bg-background/75 px-2.5 text-[13px] font-semibold text-foreground/75 shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-brand-emerald-300 hover:bg-brand-emerald-50/70 hover:text-brand-emerald-800 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 sm:px-3"
          >
            <Github className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden whitespace-nowrap lg:inline">GitHub</span>
          </a>
          <div className="hidden sm:inline-flex">
            <LocaleSwitcher />
          </div>
          <div className="hidden sm:inline-flex">
            <ThemeToggle />
          </div>
          {status === "unauthenticated" && (
            <Link
              href="/login"
              className="hidden rounded-full px-3 py-1.5 text-[13px] font-medium text-foreground/70 transition-colors hover:text-foreground sm:inline-block"
            >
              {t("logIn")}
            </Link>
          )}
          <Link
            href={ctaHref}
            aria-label={ctaLabel}
            aria-disabled={status === "loading"}
            tabIndex={status === "loading" ? -1 : undefined}
            className={
              "inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-[13px] font-semibold text-background shadow-sm transition-all hover:-translate-y-px hover:bg-foreground/90 hover:shadow-md sm:px-4 " +
              (status === "loading" ? "pointer-events-none opacity-60" : "")
            }
          >
            <span className="hidden whitespace-nowrap sm:inline">{ctaLabel}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </motion.div>
    </nav>
  );
}
