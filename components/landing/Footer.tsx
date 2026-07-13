"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { revealUp, useReveal } from "./lib/motion";

// Footer — brand + 3 link columns. Only real, live destinations are
// listed; placeholder ("#") links were removed because a footer full of
// dead links reads as pre-launch and tanks credibility. The JoblitMark
// logo mirrors the Nav for brand consistency.

const REPO_URL = "https://github.com/ShousenZHANG/joblit";

type FooterLink = { label: string; href: string; external?: boolean };

export function Footer() {
  const reveal = useReveal();
  const t = useTranslations("landing.footer");
  const tNav = useTranslations("landing.nav");
  const COLUMNS: Array<{ heading: string; links: FooterLink[] }> = [
    {
      heading: t("product.heading"),
      links: [
        { label: t("product.jobs"), href: "/jobs" },
        { label: t("product.resume"), href: "/resume" },
        { label: t("product.extension"), href: "/get-extension" },
      ],
    },
    {
      heading: t("resources.heading"),
      links: [
        { label: "GitHub", href: REPO_URL, external: true },
        { label: t("resources.reportIssue"), href: `${REPO_URL}/issues`, external: true },
      ],
    },
    {
      heading: t("legal.heading"),
      links: [
        { label: t("legal.privacy"), href: "/privacy" },
        { label: t("legal.terms"), href: "/terms" },
      ],
    },
  ];
  return (
    <motion.footer
      {...reveal}
      data-testid="landing-footer"
      role="contentinfo"
      className="border-t border-border/60 bg-background"
      variants={revealUp}
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-10">
        <div className="grid gap-10 md:grid-cols-[1.8fr_repeat(3,1fr)]">
          <div>
            <Link
              href="/"
              aria-label={tNav("home")}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg text-base font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-0"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
                <JoblitMark size={18} color="var(--brand-emerald-text, #047857)" ariaLabel={null} />
              </span>
              Joblit
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {t("tagline")}
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {col.heading}
              </h3>
              <ul className="flex flex-col gap-2">
                {col.links.map((link) =>
                  link.external ? (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-0"
                      >
                        {link.label}
                      </a>
                    </li>
                  ) : (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="inline-flex min-h-11 items-center rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-0"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ),
                )}
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
