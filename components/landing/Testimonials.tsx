"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeUp, stagger, useReveal } from "./lib/motion";
import { SectionKicker } from "./SectionKicker";

// Testimonials — 3 quote cards. Uses a large serif opening quote glyph
// to anchor each card visually (matches Landing.html `.quote::before`).

interface Quote {
  initial: string;
  text: string;
  name: string;
  role: string;
  accent?: "emerald" | "teal" | "amber";
}


const ACCENT_BG: Record<NonNullable<Quote["accent"]>, string> = {
  emerald: "bg-brand-emerald-100 text-brand-emerald-700",
  teal: "bg-[theme(colors.tier-good-bg)] text-[theme(colors.tier-good-fg)]",
  amber: "bg-[theme(colors.tier-fair-bg)] text-[theme(colors.tier-fair-fg)]",
};

export function Testimonials() {
  const reveal = useReveal();
  const t = useTranslations("landing.testimonials");
  const QUOTES: Quote[] = [
    {
      initial: t("t1.name").charAt(0),
      text: t("t1.text"),
      name: t("t1.name"),
      role: t("t1.role"),
      accent: "emerald",
    },
    {
      initial: t("t2.name").charAt(0),
      text: t("t2.text"),
      name: t("t2.name"),
      role: t("t2.role"),
      accent: "teal",
    },
    {
      initial: t("t3.name").charAt(0),
      text: t("t3.text"),
      name: t("t3.name"),
      role: t("t3.role"),
      accent: "amber",
    },
  ];
  return (
    <motion.section
      {...reveal}
      data-testid="landing-testimonials"
      className="mx-auto w-full max-w-6xl px-6 py-24 sm:px-10"
      variants={fadeUp}
    >
      <div className="mb-12 text-center">
        <SectionKicker>{t("kicker")}</SectionKicker>
        <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t("titlePrefix")}{" "}
          <em className="font-serif italic text-brand-emerald-700">
            {t("titleItalic")}
          </em>
        </h2>
      </div>

      <motion.ul
        variants={stagger}
        className="grid gap-6 md:grid-cols-3"
        role="list"
      >
        {QUOTES.map((q) => (
          <motion.li
            key={q.name}
            variants={fadeUp}
            className="group flex flex-col rounded-2xl border border-border/60 bg-background p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
          >
            <span
              aria-hidden
              className="mb-2 font-serif text-5xl leading-none text-brand-emerald-600/80"
            >
              &ldquo;
            </span>
            <p className="flex-1 text-base leading-relaxed text-foreground/90">
              {q.text}
            </p>
            <div className="mt-6 flex items-center gap-3 border-t border-border/40 pt-4">
              <span
                className={
                  "flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold " +
                  ACCENT_BG[q.accent ?? "emerald"]
                }
                aria-hidden
              >
                {q.initial}
              </span>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {q.name}
                </div>
                <div className="text-xs text-muted-foreground">{q.role}</div>
              </div>
            </div>
          </motion.li>
        ))}
      </motion.ul>
    </motion.section>
  );
}
