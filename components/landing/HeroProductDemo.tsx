"use client";

import {
  BarChart3,
  Briefcase,
  Building2,
  ExternalLink,
  FileText,
  MapPin,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { fadeUp, stagger } from "./lib/motion";

interface JobRow {
  title: string;
  company: string;
  location: string;
  status: "NEW" | "APPLIED";
  timeAgo: string;
}

const JOB_ROWS: JobRow[] = [
  {
    title: "Sr. Frontend Engineer",
    company: "Stripe",
    location: "San Francisco",
    status: "NEW",
    timeAgo: "3h",
  },
  {
    title: "Staff Product Designer",
    company: "Linear",
    location: "Remote",
    status: "NEW",
    timeAgo: "5h",
  },
  {
    title: "Design Engineer",
    company: "Figma",
    location: "New York",
    status: "APPLIED",
    timeAgo: "1d",
  },
  {
    title: "Platform Engineer",
    company: "PlanetScale",
    location: "Remote",
    status: "NEW",
    timeAgo: "2d",
  },
];

const STATUS_BG: Record<JobRow["status"], string> = {
  NEW: "bg-brand-emerald-100 text-brand-emerald-text",
  APPLIED: "bg-[theme(colors.tier-good-bg)] text-[theme(colors.tier-good-fg)]",
};

const META_CHIPS = [
  { icon: Building2, label: "Stripe" },
  { icon: MapPin, label: "San Francisco" },
  { icon: Briefcase, label: "Full-time" },
  { icon: BarChart3, label: "Senior" },
];

interface HeroProductDemoProps {
  mounted: boolean;
  reduced: boolean | null;
}

export function HeroProductDemo({
  mounted,
  reduced,
}: HeroProductDemoProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, {
    amount: 0.15,
    margin: "120px 0px",
  });
  const [documentVisible, setDocumentVisible] = useState(
    () =>
      typeof document === "undefined" ||
      document.visibilityState === "visible",
  );
  const [activeRow, setActiveRow] = useState(0);

  useEffect(() => {
    const syncVisibility = () => {
      setDocumentVisible(document.visibilityState === "visible");
    };

    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () =>
      document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  useEffect(() => {
    if (reduced || !inView || !documentVisible) return;

    const id = window.setInterval(() => {
      setActiveRow((index) => (index + 1) % JOB_ROWS.length);
    }, 2600);

    return () => window.clearInterval(id);
  }, [documentVisible, inView, reduced]);

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[0_30px_80px_-30px_rgba(15,23,42,0.18)]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-px bg-gradient-to-r from-transparent via-brand-emerald-400/60 to-transparent"
      />
      {/* App mock: phones get a single stacked column; ≥sm gets
          list + detail (sidebar hidden); ≥md gets the full 3-col.
          Columns mount with a 90/130/170 ms cascade after the
          canvas frame lifts in, so the product mock reads as
          "assembling itself" rather than snapping into place. */}
      <motion.div
        variants={stagger}
        initial={reduced ? undefined : "hidden"}
        animate={mounted ? "show" : reduced ? undefined : "hidden"}
        transition={{ delayChildren: 0.55, staggerChildren: 0.09 }}
        className="grid min-h-[360px] grid-cols-1 sm:grid-cols-[260px_1fr] md:grid-cols-[180px_260px_1fr]"
      >
        {/* Sidebar */}
        <motion.div
          variants={fadeUp}
          className="hidden border-r border-border/50 bg-muted/30 p-4 text-sm md:block"
        >
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
              <Search className="h-3.5 w-3.5 text-brand-emerald-text" aria-hidden />
            </span>
            Joblit
          </div>
          <ul className="flex flex-col gap-1 text-xs">
            <li className="flex items-center justify-between rounded-md bg-brand-emerald-50 px-2 py-1.5 font-semibold text-brand-emerald-text">
              <span className="inline-flex items-center gap-2">
                <Briefcase className="h-3.5 w-3.5" aria-hidden />
                Jobs
              </span>
              <span className="rounded bg-brand-emerald-100 px-1.5 text-[10px]">
                47
              </span>
            </li>
            {[
              { label: "Fetch", badge: 3 },
              { label: "Resume", badge: 2 },
            ].map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <span>{item.label}</span>
                {item.badge !== null && (
                  <span className="rounded bg-muted px-1.5 text-[10px]">
                    {item.badge}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Job list — rows stagger in after the column fade, so
            the results feel like they're loading, not popping. Rows
            show STATUS (matching the real product), not a match score. */}
        <motion.div
          variants={fadeUp}
          className="border-r border-border/50 bg-background/40 p-3"
        >
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Results
          </div>
          <motion.ul
            variants={stagger}
            transition={{ delayChildren: 0.15, staggerChildren: 0.07 }}
            className="flex flex-col gap-1.5"
          >
            {JOB_ROWS.map((row, i) => (
              <motion.li
                key={row.title}
                data-testid={`hero-demo-row-${i}`}
                data-active={i === activeRow}
                variants={fadeUp}
                className={
                  "rounded-lg border border-l-4 px-3 py-2 transition-colors " +
                  (i === activeRow
                    ? "border-l-brand-emerald-500 bg-brand-emerald-50/40 shadow-[0_12px_30px_-24px_rgba(5,150,105,0.55)]"
                    : "border-l-transparent bg-background/60")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1">
                    {i === activeRow && (
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full bg-brand-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]"
                      />
                    )}
                    <span
                      className={
                        "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider " +
                        STATUS_BG[row.status]
                      }
                    >
                      {row.status}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {row.timeAgo}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs font-semibold text-foreground">
                  {row.title}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {row.company} · {row.location}
                </div>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Detail — mirrors the real JobDetailPanel: title + status,
            meta chips, the Open/Generate action row, a Job Description
            header, an experience-gate insight, and JD text. No score. */}
        <motion.div variants={fadeUp} className="p-5">
          <div className="flex items-center gap-2">
            <div className="text-base font-semibold text-foreground">
              Sr. Frontend Engineer
            </div>
            <span className="rounded-full bg-brand-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-emerald-text">
              New
            </span>
          </div>

          {/* Meta chips — icon + label, matching the real header. */}
          <div className="mt-2 flex flex-wrap gap-1">
            {META_CHIPS.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                <Icon className="h-3 w-3 text-brand-emerald-600" aria-hidden />
                {label}
              </span>
            ))}
          </div>

          {/* Action row — Open job plus the one batch AI Generate with its
              live count, matching the real toolbar since generation went
              batch-only. The Sparkles pulse signals the AI action. */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-lg bg-brand-emerald-500 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm">
              <ExternalLink className="h-3 w-3" aria-hidden />
              Open job
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm">
              <Sparkles
                className="h-3 w-3 animate-[landing-pulse_2.4s_ease-in-out_infinite] motion-reduce:animate-none"
                aria-hidden
              />
              AI Generate
            </span>
            <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
              2 of 5 done
            </span>
          </div>

          {/* Job description header — icon medallion + hairline. */}
          <div className="mt-4 flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-emerald-50 text-brand-emerald-text ring-1 ring-brand-emerald-100">
              <FileText className="h-3 w-3" aria-hidden />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Job description
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" aria-hidden />
          </div>

          {/* Experience-gate insight chip — a real product feature. */}
          <div className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[theme(colors.tier-fair-ring)] bg-[theme(colors.tier-fair-bg)] px-2 py-1 text-[10px] font-medium text-[theme(colors.tier-fair-fg)]">
            <ShieldAlert className="h-3 w-3" aria-hidden />
            5+ years preferred
          </div>

          <div className="mt-2 space-y-1 text-[10px] leading-relaxed text-muted-foreground">
            <p>Ship accessible, high-performance UI across the platform.</p>
            <p>Partner with design-systems and product teams end to end.</p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
