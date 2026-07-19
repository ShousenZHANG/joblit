"use client";

import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HeroProductDemo } from "./HeroProductDemo";
import { Magnetic, TiltCard, useSpotlight } from "./lib/interactive";
import { useCtaHref } from "./lib/useCtaHref";

// Run a layout effect on the client, noop on the server, so we can
// flip the mount flag before first paint (React would log a warning
// if we used useLayoutEffect unconditionally during SSR).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Hero — Linear/Vercel pattern: centered headline, dual CTA, full-width
// product mock as the visual anchor. The mock mirrors the REAL Jobs surface
// (list of fetched roles + a detail panel with status, meta chips, the
// Open/Generate actions, an experience-gate insight, and the JD) — it does
// NOT show a fabricated match score or skill-fit, because the product has no
// scoring feature. The only steady-state motion is the active-row rotation
// and a gentle Sparkles pulse on the Generate action; everything else is the
// one-shot intro choreography.

export function Hero() {
  const reduced = useReducedMotion();
  const t = useTranslations("landing.hero");
  const cta = useCtaHref();
  // Pointer spotlight on the product-mock frame (border glow + inner wash).
  const frameSpot = useSpotlight<HTMLDivElement>();
  // Scroll parallax for the decorative canvas grid — drifts down slightly
  // slower than the page so the hero gains depth as it scrolls away. Tracks
  // the hero's own scroll range; reduced-motion pins it (y = 0).
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const gridY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  // Two-phase mount: SSR paints the hidden state (opacity 0 / y 40),
  // then the layout effect flips `mounted` true on the first client
  // frame so framer-motion runs a real transition from hidden → show.
  // Without this, framer-motion sees `animate="show"` during hydration
  // and skips the tween — the user sees the final state instantly on
  // fast connections, which reads as "no animation".
  const [mounted, setMounted] = useState(false);
  useIsomorphicLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Orchestrated intro: one stagger parent drives all headline elements
  // so delays stay in lockstep and motion reads as a single choreographed
  // reveal instead of five independent fades.
  const introStagger = {
    hidden: {},
    show: {
      transition: {
        staggerChildren: 0.09,
        delayChildren: 0.05,
      },
    },
  };
  const introItem = reduced
    ? {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0.3 } },
      }
    : {
        hidden: { opacity: 0, y: 24 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
        },
      };

  return (
    <section
      ref={heroRef}
      id="main-content"
      tabIndex={-1}
      data-testid="landing-hero"
      className="relative isolate mx-auto w-full max-w-6xl overflow-hidden px-6 pb-24 pt-16 sm:pt-24 lg:px-10"
    >
      <motion.div
        aria-hidden
        style={{ y: reduced ? 0 : gridY }}
        className="landing-canvas-grid pointer-events-none absolute inset-x-0 top-10 -z-10 h-[620px] opacity-80"
      />
      {/* Prismatic hairline — dawn refracting into its spectrum. The landing's
          signature stroke, sitting where the sky meets the page. */}
      <div aria-hidden className="prism-line absolute inset-x-10 top-0 lg:inset-x-24" />
      {/* LCP-safe: the headline block renders VISIBLE at SSR (initial=false →
          framer paints the `show` state immediately, no opacity:0 gate waiting
          on hydration). The decorative product mock below keeps its JS-driven
          reveal. Gating the largest contentful element behind a rAF mount flag
          previously delayed LCP until the bundle hydrated. */}
      <motion.div variants={introStagger} initial={false} animate="show">
      {/* Eyebrow — first thing to appear on page load, bolder
          20px rise so the motion reads even on fast connections. */}
      <motion.div
        variants={introItem}
        className="flex items-center justify-center"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-emerald-200 bg-brand-emerald-50 px-3 py-1 text-xs font-semibold text-brand-emerald-text">
          <span
            aria-hidden
            className="relative flex h-1.5 w-1.5 items-center justify-center"
          >
            <span className="absolute inline-flex h-full w-full animate-[landing-pulse_2s_ease-in-out_infinite] rounded-full bg-brand-emerald-500 motion-reduce:animate-none" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-brand-emerald-600" />
          </span>
          <span className="rounded-full bg-brand-emerald-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {t("eyebrowNew")}
          </span>
          {t("eyebrowTagline")}
        </span>
      </motion.div>

      {/* Title — Linear-style oversized headline. lg:text-[88px] is the
          Vercel/Linear visual baseline; tracking-tight + leading-[0.95]
          collapses the line gap so the two lines feel like one display
          block. */}
      <motion.h1
        variants={introItem}
        className="mx-auto mt-6 max-w-[21rem] text-balance text-center text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:max-w-3xl sm:text-6xl sm:leading-[1] lg:max-w-4xl lg:text-[88px] lg:leading-[0.95]"
      >
        {t("titleLine1")}
        <br />
        <span className="relative inline-block">
          {/* Dawn-spectrum emphasis: a slow gradient shimmer sweeps the serif
              word (emerald → teal → sky), echoing the aurora behind it. */}
          <em className="hero-gradient-text font-serif italic">
            {t("titleItalic")}
          </em>
          {/* Hand-drawn emerald underline — draws itself once after the intro
              settles (see .hero-underline in globals.css). Decorative only. */}
          <svg
            aria-hidden
            viewBox="0 0 220 14"
            preserveAspectRatio="none"
            className="hero-underline absolute -bottom-2 left-0 h-[0.14em] w-full text-brand-emerald-500 sm:-bottom-3"
          >
            <path
              d="M4 10 C 60 2, 150 2, 216 8"
              pathLength="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        variants={introItem}
        className="mx-auto mt-6 max-w-[21rem] text-balance text-center text-base leading-relaxed text-muted-foreground sm:max-w-2xl sm:text-lg"
      >
        {t("subtitle")}
      </motion.p>

      {/* CTA */}
      <motion.div
        variants={introItem}
        className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
      >
        <Magnetic strength={7}>
          <Link
            href={cta.href}
            prefetch={cta.prefetch}
            aria-disabled={cta.disabled}
            tabIndex={cta.disabled ? -1 : undefined}
            className={
              "group inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background shadow-[0_10px_36px_-10px_rgba(16,185,129,0.45)] transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-px hover:bg-foreground/90 hover:shadow-[0_14px_44px_-10px_rgba(16,185,129,0.6)] active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
              (cta.disabled ? "pointer-events-none opacity-70" : "")
            }
          >
            {cta.label}
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </Magnetic>
        <Link
          href="#how"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-background/70 px-6 text-sm font-semibold text-foreground transition-[background-color,transform] duration-200 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Play className="h-4 w-4" aria-hidden />
          {t("watchDemo")}
        </Link>
      </motion.div>

      {/* Meta — single honest line, no fabricated counters. */}
      <motion.div
        variants={introItem}
        className="mt-6 flex items-center justify-center text-xs text-muted-foreground"
      >
        <span>{t("metaFree")}</span>
      </motion.div>

      {/* Canvas — frame lifts in with a single rise + scale settle, no
          infinite floating animation behind it. */}
      <motion.div
        initial="hidden"
        animate={mounted ? "show" : "hidden"}
        variants={{
          hidden: reduced
            ? { opacity: 0 }
            : { opacity: 0, y: 48, scale: 0.985 },
          show: {
            opacity: 1,
            y: 0,
            scale: 1,
            transition: {
              duration: 0.7,
              ease: [0.16, 1, 0.3, 1] as const,
            },
          },
        }}
        className="relative mx-auto mt-16 max-w-5xl"
      >
        {/* Static emerald glow behind the canvas — gives lift without an
            animated shadow. Pointer-events-none + -z-10 so it never
            interferes with mock interactions. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-6 -bottom-8 -z-10 h-72 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(16,185,129,0.12),transparent_70%)]"
        />
        <TiltCard max={3}>
          <div
            ref={frameSpot}
            className="spotlight-card spotlight-wide rounded-3xl"
          >
            <HeroProductDemo mounted={mounted} reduced={reduced} />
          </div>
        </TiltCard>
      </motion.div>
      </motion.div>
    </section>
  );
}
