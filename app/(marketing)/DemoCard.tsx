"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";

type ActiveField = "title" | "location" | "level" | "results" | null;

interface DemoSequence {
  title: string;
  location: string;
  level: string;
  results: string;
}

const sequences: DemoSequence[] = [
  {
    title: "Frontend Engineer",
    location: "Remote",
    level: "Mid-level",
    results: "128 roles available",
  },
  {
    title: "Product Designer",
    location: "Sydney",
    level: "Junior",
    results: "64 roles available",
  },
  {
    title: "Data Analyst",
    location: "Hybrid",
    level: "Entry-level",
    results: "92 roles available",
  },
];

export function DemoCard() {
  const reduceMotion = useReducedMotion();
  const [title, setTitle] = useState(sequences[0].title);
  const [location, setLocation] = useState(sequences[0].location);
  const [level, setLevel] = useState(sequences[0].level);
  const [results, setResults] = useState(sequences[0].results);
  const [activeField, setActiveField] = useState<ActiveField>(null);

  useEffect(() => {
    if (reduceMotion) return;
    let cancelled = false;
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    async function typeField(
      field: ActiveField,
      setter: (v: string) => void,
      value: string,
    ) {
      setActiveField(field);
      setter("");
      for (let i = 1; i <= value.length; i += 1) {
        if (cancelled) return;
        setter(value.slice(0, i));
        await sleep(40);
      }
    }

    async function run() {
      await sleep(2000);
      let index = 1;
      while (!cancelled) {
        const current = sequences[index];
        await typeField("title", setTitle, current.title);
        await sleep(200);
        await typeField("location", setLocation, current.location);
        await sleep(200);
        await typeField("level", setLevel, current.level);
        await sleep(200);
        await typeField("results", setResults, current.results);
        setActiveField(null);
        await sleep(2000);
        index = (index + 1) % sequences.length;
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [reduceMotion]);

  const cardContent = (
    <>
      <div className="flex items-center gap-2">
        <span
          className="edu-pill-pro inline-flex items-center gap-1.5 text-xs font-semibold"
          aria-hidden="true"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#0a66c2]" />
          Live demo
        </span>
      </div>
      <h3 className="mt-3 font-semibold text-slate-900">
        Role search
      </h3>
      <p className="mt-0.5 text-sm text-slate-600">
        Refine your search to see better matches.
      </p>
      <div className="mt-4 grid gap-3" aria-live="polite" aria-atomic="false">
        <div className="edu-input">
          <span className="text-xs font-medium text-slate-500">Title</span>
          <div className="min-h-[1.25rem] truncate text-sm font-medium text-slate-900">
            {title}
            {activeField === "title" && <span className="edu-caret" />}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="edu-input">
            <span className="text-xs font-medium text-slate-500">Location</span>
            <div className="min-h-[1.25rem] truncate text-sm font-medium text-slate-900">
              {location}
              {activeField === "location" && <span className="edu-caret" />}
            </div>
          </div>
          <div className="edu-input">
            <span className="text-xs font-medium text-slate-500">Level</span>
            <div className="min-h-[1.25rem] truncate text-sm font-medium text-slate-900">
              {level}
              {activeField === "level" && <span className="edu-caret" />}
            </div>
          </div>
        </div>
        <div className="edu-input">
          <span className="text-xs font-medium text-slate-500">Results</span>
          <div className="min-h-[1.25rem] truncate text-sm font-medium text-slate-900">
            {results}
            {activeField === "results" && <span className="edu-caret" />}
          </div>
        </div>
      </div>
      <Button asChild className="edu-cta-pro mt-5 w-full">
        <Link href="/jobs">View matches</Link>
      </Button>
    </>
  );

  if (reduceMotion) {
    return (
      <div
        className="edu-demo-card w-full max-w-md text-left"
        role="region"
        aria-label="Job search demo"
      >
        {cardContent}
      </div>
    );
  }

  return (
    <motion.div
      className="edu-demo-card w-full max-w-md text-left"
      role="region"
      aria-label="Job search demo"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.25, 0.4, 0.25, 1] as const }}
    >
      {cardContent}
    </motion.div>
  );
}
