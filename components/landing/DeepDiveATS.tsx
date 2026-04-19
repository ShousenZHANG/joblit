"use client";

import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeUp, stagger, useReveal } from "./lib/motion";

// Deep-dive #2 — Chrome extension autofills ATS forms. Reverse layout
// (media-left, copy-right on desktop) to break visual monotony between
// the three dive sections. The ATS window is a stylized browser chrome
// with 5 mocked form fields; the 4th is in "typing" state with a blinking
// caret driven by the `landing-caret` keyframe in globals.css.

interface Field {
  label: string;
  value: string;
  state: "filled" | "typing" | "file";
}

export function DeepDiveATS() {
  const reveal = useReveal();
  const t = useTranslations("landing.deepDive.ats");
  const BULLETS = [t("b1"), t("b2"), t("b3"), t("b4")];
  const FIELDS: Field[] = [
    { label: t("fullName"), value: "Alex Chen", state: "filled" },
    { label: t("email"), value: "alex.chen@mail.com", state: "filled" },
    {
      label: t("linkedin"),
      value: "linkedin.com/in/alexchen",
      state: "filled",
    },
    { label: t("yoe"), value: "5", state: "typing" },
    {
      label: t("uploadLabel"),
      value: t("uploadValue"),
      state: "file",
    },
  ];
  return (
    <motion.section
      {...reveal}
      data-testid="landing-deepdive-ats"
      className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10"
      variants={fadeUp}
    >
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <motion.div
          variants={fadeUp}
          className="relative order-last overflow-hidden rounded-3xl border border-border/60 bg-background shadow-[var(--shadow-card-emerald)] lg:order-first"
        >
          {/* Browser chrome */}
          <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-2.5">
            <span className="flex gap-1.5" aria-hidden>
              <i className="block h-2.5 w-2.5 rounded-full bg-[#ff605c]" />
              <i className="block h-2.5 w-2.5 rounded-full bg-[#ffbd44]" />
              <i className="block h-2.5 w-2.5 rounded-full bg-[#00ca4e]" />
            </span>
            <div className="ml-3 flex-1 rounded-md bg-background px-3 py-1 text-xs text-muted-foreground">
              {t("url")}
            </div>
          </div>

          {/* Form */}
          <ul className="flex flex-col gap-4 p-6" role="list">
            {FIELDS.map((field) => (
              <li key={field.label} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {field.label}
                </span>
                <div
                  className={
                    "flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm " +
                    (field.state === "filled" || field.state === "file"
                      ? "border-brand-emerald-200 bg-brand-emerald-50 text-brand-emerald-700"
                      : "border-border bg-background text-foreground")
                  }
                >
                  <span className="flex items-center gap-2 truncate">
                    {field.value}
                    {field.state === "typing" && (
                      <i
                        aria-hidden
                        className="inline-block h-4 w-[2px] bg-foreground align-middle animate-[landing-caret_1s_steps(2,start)_infinite]"
                      />
                    )}
                  </span>
                  {(field.state === "filled" || field.state === "file") && (
                    <Check
                      className="h-4 w-4 shrink-0"
                      strokeWidth={3}
                      aria-hidden
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div variants={stagger}>
          <motion.div
            variants={fadeUp}
            className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-emerald-700"
          >
            <span aria-hidden className="inline-block h-px w-4 bg-brand-emerald-600" />
            {t("kicker")}
          </motion.div>
          <motion.h3
            variants={fadeUp}
            className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            {t("titlePrefix")}{" "}
            <em className="font-serif italic text-brand-emerald-700">
              {t("titleItalic")}
            </em>
          </motion.h3>
          <motion.p
            variants={fadeUp}
            className="mt-4 text-base leading-relaxed text-muted-foreground"
          >
            {t("lede")}
          </motion.p>
          <motion.ul variants={stagger} className="mt-6 flex flex-col gap-3">
            {BULLETS.map((b) => (
              <motion.li
                key={b}
                variants={fadeUp}
                className="flex items-start gap-2 text-sm text-foreground/90"
              >
                <Check
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-emerald-600"
                  strokeWidth={3}
                  aria-hidden
                />
                {b}
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>
      </div>
    </motion.section>
  );
}
