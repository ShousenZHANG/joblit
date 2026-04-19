"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeUp, useReveal } from "./lib/motion";
import { SectionKicker } from "./SectionKicker";

// Testimonials — infinite horizontal marquee of 9 candidate quotes.
// Two back-to-back copies of the card row translate -50% via the
// `landing-marquee` keyframe declared in globals.css, giving a
// seamless loop. Hovering the strip pauses the animation so readers
// can finish a quote (`group-hover:[animation-play-state:paused]`).
// Edge masks fade the first/last ~120px so cards don't hard-clip
// against the section gutter.

interface Quote {
  initial: string;
  text: string;
  name: string;
  role: string;
  accent: "emerald" | "teal" | "amber";
}

const ACCENT_BG: Record<Quote["accent"], string> = {
  emerald: "bg-brand-emerald-100 text-brand-emerald-700",
  teal: "bg-[theme(colors.tier-good-bg)] text-[theme(colors.tier-good-fg)]",
  amber: "bg-[theme(colors.tier-fair-bg)] text-[theme(colors.tier-fair-fg)]",
};

const ACCENT_CYCLE: Quote["accent"][] = ["emerald", "teal", "amber"];

function QuoteCard({ q }: { q: Quote }) {
  return (
    <li
      className="group/card flex h-full min-h-[220px] w-[340px] shrink-0 flex-col rounded-2xl border border-border/60 bg-background/90 p-6 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-brand-emerald-200 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_36px_-18px_rgba(5,150,105,0.28)] sm:w-[380px]"
      role="listitem"
    >
      <span
        aria-hidden
        className="mb-2 font-serif text-5xl leading-none text-brand-emerald-600/80"
      >
        &ldquo;
      </span>
      <p className="flex-1 text-[15px] leading-relaxed text-foreground/90">
        {q.text}
      </p>
      <div className="mt-6 flex items-center gap-3 border-t border-border/40 pt-4">
        <span
          className={
            "flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold " +
            ACCENT_BG[q.accent]
          }
          aria-hidden
        >
          {q.initial}
        </span>
        <div>
          <div className="text-sm font-semibold text-foreground">{q.name}</div>
          <div className="text-xs text-muted-foreground">{q.role}</div>
        </div>
      </div>
    </li>
  );
}

export function Testimonials() {
  const reveal = useReveal();
  const t = useTranslations("landing.testimonials");

  const QUOTES: Quote[] = Array.from({ length: 9 }, (_, idx) => {
    const key = `t${idx + 1}` as const;
    return {
      initial: t(`${key}.name`).charAt(0),
      text: t(`${key}.text`),
      name: t(`${key}.name`),
      role: t(`${key}.role`),
      accent: ACCENT_CYCLE[idx % ACCENT_CYCLE.length],
    };
  });

  return (
    <motion.section
      {...reveal}
      data-testid="landing-testimonials"
      className="mx-auto w-full max-w-6xl py-24"
      variants={fadeUp}
    >
      <div className="mx-auto mb-12 max-w-6xl px-6 text-center sm:px-10">
        <SectionKicker>{t("kicker")}</SectionKicker>
        <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t("titlePrefix")}{" "}
          <em className="font-serif italic text-brand-emerald-700">
            {t("titleItalic")}
          </em>
        </h2>
      </div>

      {/* Marquee strip — edge-masked so cards fade toward the gutter. */}
      <div
        className="group relative overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0, black 96px, black calc(100% - 96px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0, black 96px, black calc(100% - 96px), transparent 100%)",
        }}
      >
        <ul
          className="flex w-max flex-nowrap gap-5 px-6 group-hover:[animation-play-state:paused] sm:px-10"
          role="list"
          style={{
            animation: "landing-marquee 52s linear infinite",
            animationPlayState: "running",
          }}
        >
          {/* Two copies for the seamless -50% loop. aria-hidden on the
              second copy so screen readers don't hear the testimonials
              twice. */}
          {QUOTES.map((q) => (
            <QuoteCard key={`a-${q.name}`} q={q} />
          ))}
          <li aria-hidden className="contents">
            {QUOTES.map((q) => (
              <QuoteCard key={`b-${q.name}`} q={q} />
            ))}
          </li>
        </ul>
      </div>
    </motion.section>
  );
}
