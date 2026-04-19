"use client";

import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ThemeToggle } from "@/components/providers/ThemeProvider";

// Glass navbar. Sits sticky at top 16px, becomes a touch more compact
// (scale 0.98 + extra shadow) once the user scrolls past 20px. Smooth
// scroll handler hijacks clicks on `#anchor` links so the jumps feel
// native to the page.

interface NavLink {
  label: string;
  href: string;
}

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
      className="sticky top-3 z-50 mx-auto w-full max-w-6xl px-4 sm:top-4 sm:px-6"
    >
      {/* Inner pill: always on (bg + blur + border + shadow even at rest,
          matching Landing.html baseline). Scrolling tightens padding,
          shrinks scale 0.97, and swaps to an emerald-tinged elevated
          shadow so the shift is unmistakable. */}
      <motion.div
        initial={reduced ? undefined : { opacity: 0, y: -12 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: scrolled ? 0.97 : 1,
          paddingTop: scrolled ? 7 : 9,
          paddingBottom: scrolled ? 7 : 9,
          boxShadow: scrolled
            ? "0 14px 36px -16px rgba(5, 150, 105, 0.28), 0 4px 12px -4px rgba(15, 23, 42, 0.08)"
            : "0 8px 24px -12px rgba(5, 150, 105, 0.14), 0 2px 6px -2px rgba(15, 23, 42, 0.04)",
        }}
        transition={{
          duration: reduced ? 0 : 0.38,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="flex w-full items-center justify-between rounded-full border border-border/60 bg-[var(--landing-nav-bg,rgba(255,255,255,0.82))] px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-5"
        style={{ transformOrigin: "top center", willChange: "transform" }}
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground transition-colors hover:text-brand-emerald-700 focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
          aria-label="Joblit home"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
            <Search
              className="h-3.5 w-3.5 text-brand-emerald-700"
              strokeWidth={2.5}
              aria-hidden
            />
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

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
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
            aria-disabled={status === "loading"}
            tabIndex={status === "loading" ? -1 : undefined}
            className={
              "inline-flex items-center gap-1 rounded-full bg-foreground px-4 py-1.5 text-[13px] font-semibold text-background shadow-sm transition-all hover:-translate-y-px hover:bg-foreground/90 hover:shadow-md " +
              (status === "loading" ? "pointer-events-none opacity-60" : "")
            }
          >
            {ctaLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </motion.div>
    </nav>
  );
}
