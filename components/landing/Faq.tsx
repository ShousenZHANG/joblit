"use client";

import { Plus } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { fadeUp, useReveal } from "./lib/motion";
import { SectionKicker } from "./SectionKicker";

// FAQ accordion. Controlled (single-open) because Landing.html only
// highlights one item at a time and leaves the rest closed. The plus icon
// rotates 45° to become an X when the item is open — a 120ms transform
// that reads as "close affordance" without being fussy.

interface QA {
  q: string;
  a: string;
}

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const reduced = useReducedMotion();
  const reveal = useReveal();
  const t = useTranslations("landing.faq");
  const QAS = t.raw("items") as QA[];

  return (
    <motion.section
      {...reveal}
      data-testid="landing-faq"
      id="faq"
      className="mx-auto w-full max-w-3xl px-6 py-24 sm:px-10"
      variants={fadeUp}
    >
      <div className="mb-12 text-center">
        <SectionKicker>{t("kicker")}</SectionKicker>
        <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t("titlePrefix")}{" "}
          <em className="font-serif italic text-brand-emerald-700">
            {t("titleItalic")}
          </em>{" "}
          {t("titleSuffix")}
        </h2>
      </div>

      <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-background">
        {QAS.map((qa, i) => {
          const open = openIndex === i;
          return (
            <li key={qa.q}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenIndex(open ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-muted/50"
              >
                <span className="text-base font-semibold text-foreground">
                  {qa.q}
                </span>
                <span
                  className={
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-transform duration-200 " +
                    (open ? "rotate-45" : "")
                  }
                  aria-hidden
                >
                  <Plus className="h-4 w-4" />
                </span>
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    key="answer"
                    initial={reduced ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.25, 0.4, 0.25, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="px-6 pb-6 text-sm leading-relaxed text-muted-foreground">
                      {qa.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
