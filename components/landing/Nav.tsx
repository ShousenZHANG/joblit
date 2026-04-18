"use client";

import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useSession } from "next-auth/react";
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

const LINKS: NavLink[] = [
  { label: "Product", href: "#product" },
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
  { label: "Changelog", href: "#" },
];

export function Nav() {
  const { status } = useSession();
  const reduced = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);

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
    status === "authenticated" ? "Open app" : "Start free";

  return (
    <motion.nav
      data-testid="landing-nav"
      aria-label="Primary"
      initial={reduced ? undefined : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-x-0 top-3 z-50 mx-auto flex w-full max-w-6xl items-center justify-between px-4 sm:top-4 sm:px-6"
    >
      <div
        className={
          "flex w-full items-center justify-between rounded-full px-4 py-2 transition-all duration-300 sm:px-5 " +
          (scrolled
            ? "scale-[0.97] border border-border/60 bg-background/80 shadow-md backdrop-blur-xl"
            : "bg-transparent")
        }
        style={{ transformOrigin: "top center" }}
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
              Log in
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
      </div>
    </motion.nav>
  );
}
