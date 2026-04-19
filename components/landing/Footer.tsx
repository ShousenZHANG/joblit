"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeUp, useReveal } from "./lib/motion";

// Footer — 5-column grid (brand + 4 link sections) matching Landing.html
// `footer.site`. Uses lucide Search glyph for the logo mark, otherwise
// plain-text lists so translators and tools can reach every link.

export function Footer() {
  const reveal = useReveal();
  const t = useTranslations("landing.footer");
  const COLUMNS: Array<{ heading: string; links: { label: string; href: string }[] }> = [
    {
      heading: t("product.heading"),
      links: [
        { label: t("product.jobs"), href: "/jobs" },
        { label: t("product.resume"), href: "/resume" },
        { label: t("product.extension"), href: "/get-extension" },
        { label: t("product.changelog"), href: "#" },
      ],
    },
    {
      heading: t("company.heading"),
      links: [
        { label: t("company.about"), href: "#" },
        { label: t("company.careers"), href: "#" },
        { label: t("company.press"), href: "#" },
        { label: t("company.contact"), href: "#" },
      ],
    },
    {
      heading: t("resources.heading"),
      links: [
        { label: t("resources.docs"), href: "#" },
        { label: t("resources.guide"), href: "#" },
        { label: t("resources.blog"), href: "#" },
        { label: t("resources.templates"), href: "#" },
      ],
    },
    {
      heading: t("legal.heading"),
      links: [
        { label: t("legal.privacy"), href: "/privacy" },
        { label: t("legal.terms"), href: "/terms" },
        { label: t("legal.security"), href: "#" },
        { label: t("legal.dpa"), href: "#" },
      ],
    },
  ];
  return (
    <motion.footer
      {...reveal}
      data-testid="landing-footer"
      role="contentinfo"
      className="border-t border-border/60 bg-background"
      variants={fadeUp}
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-10">
        <div className="grid gap-10 md:grid-cols-[1.6fr_repeat(4,1fr)]">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-foreground"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-emerald-50 ring-1 ring-brand-emerald/20">
                <Search
                  className="h-3.5 w-3.5 text-brand-emerald-700"
                  strokeWidth={2.5}
                  aria-hidden
                />
              </span>
              Joblit
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {t("tagline")}
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h6 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {col.heading}
              </h6>
              <ul className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-2 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <span>{t("copyright")}</span>
          <span>{t("designed")}</span>
        </div>
      </div>
    </motion.footer>
  );
}
