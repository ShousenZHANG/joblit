"use client";

import { Sparkles } from "lucide-react";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { cn } from "@/lib/utils";

interface SkillsSectionProps {
  skillsAdditions: AiContent["cv"]["skillsAdditions"];
  onChange: (next: AiContent["cv"]["skillsAdditions"]) => void;
}

export function SkillsSection({ skillsAdditions, onChange }: SkillsSectionProps) {
  if (skillsAdditions.length === 0) {
    return null;
  }
  const totalAccepted = skillsAdditions.filter((s) => s.accepted).length;

  function toggle(index: number, accepted: boolean) {
    onChange(skillsAdditions.map((s, i) => (i === index ? { ...s, accepted } : s)));
  }

  return (
    <section className="space-y-3 rounded-[1.35rem] border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_46px_-36px_rgba(15,23,42,0.45),0_1px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-white/80">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-brand-emerald-50 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-brand-emerald-700 ring-1 ring-brand-emerald-100">
            <Sparkles className="h-3 w-3" aria-hidden />
            AI proposed
          </span>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Skills additions
          </h2>
        </div>
        <span className="text-[11px] font-medium text-muted-foreground">
          {totalAccepted} of {skillsAdditions.length} accepted
        </span>
      </header>

      <ul className="flex flex-col gap-2">
        {skillsAdditions.map((group, i) => (
          <li
            key={`${group.label}-${i}`}
            className={cn(
              "flex items-start gap-3 rounded-2xl border px-3 py-2.5 transition-all",
              group.accepted
                ? "border-brand-emerald-200 bg-brand-emerald-50/60 shadow-[0_14px_34px_-30px_rgba(16,185,129,0.65)]"
                : "border-slate-200/80 bg-slate-50/70 hover:bg-white",
            )}
          >
            <input
              type="checkbox"
              checked={group.accepted}
              onChange={(e) => toggle(i, e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-border/80 text-brand-emerald-600 focus:ring-brand-emerald-400/40"
              aria-label={`Accept skill addition for ${group.label}`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {group.label}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {group.items.map((item) => (
                  <span
                    key={item}
                    className="inline-flex h-5 items-center rounded-full bg-white px-2 text-[11px] font-medium text-muted-foreground ring-1 ring-slate-200/80"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
