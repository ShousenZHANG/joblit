"use client";

import { Sparkles, RotateCcw, AlertTriangle } from "lucide-react";
import type {
  AiAddedBullet,
  AiContent,
} from "@/lib/shared/schemas/aiContent";
import { cn } from "@/lib/utils";

interface BulletsSectionProps {
  latestExperience: AiContent["cv"]["latestExperience"];
  onChange: (next: AiContent["cv"]["latestExperience"]) => void;
}

export function BulletsSection({
  latestExperience,
  onChange,
}: BulletsSectionProps) {
  const { addedBullets } = latestExperience;
  const acceptedCount = addedBullets.filter((b) => b.accepted).length;

  function updateBullet(index: number, next: AiAddedBullet) {
    onChange({
      ...latestExperience,
      addedBullets: addedBullets.map((b, i) => (i === index ? next : b)),
    });
  }

  return (
    <section className="space-y-3 rounded-[1.35rem] border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_46px_-36px_rgba(15,23,42,0.45),0_1px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-white/80">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-brand-emerald-50 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-brand-emerald-700 ring-1 ring-brand-emerald-100">
            <Sparkles className="h-3 w-3" aria-hidden />
            AI added
          </span>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Latest experience bullets
          </h2>
        </div>
        <span className="text-[11px] font-medium text-muted-foreground">
          {acceptedCount} of {addedBullets.length} accepted
        </span>
      </header>

      {addedBullets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300/80 bg-slate-50/80 px-3 py-3 text-xs text-muted-foreground">
          No AI-proposed additions for this experience.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {addedBullets.map((bullet, i) => (
            <BulletRow
              key={`${i}-${bullet.text.slice(0, 24)}`}
              bullet={bullet}
              onChange={(next) => updateBullet(i, next)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface BulletRowProps {
  bullet: AiAddedBullet;
  onChange: (next: AiAddedBullet) => void;
}

function BulletRow({ bullet, onChange }: BulletRowProps) {
  const text = bullet.userEdit ?? bullet.text;
  const isUserEdited =
    bullet.userEdit !== undefined && bullet.userEdit !== bullet.text;
  const gateFailed = bullet.qualityGate?.passed === false;
  const reason = bullet.qualityGate?.reason;

  return (
    <li
      className={cn(
        "rounded-2xl border px-3 py-3 transition-all",
        bullet.accepted
          ? "border-brand-emerald-200 bg-brand-emerald-50/60 shadow-[0_14px_34px_-30px_rgba(16,185,129,0.65)]"
          : "border-slate-200/80 bg-slate-50/70 hover:bg-white",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={bullet.accepted}
          onChange={(e) => onChange({ ...bullet, accepted: e.target.checked })}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-border/80 text-brand-emerald-600 focus:ring-brand-emerald-400/40"
          aria-label="Accept bullet"
        />
        <div className="min-w-0 flex-1">
          <textarea
            value={text}
            onChange={(e) =>
              onChange({
                ...bullet,
                userEdit:
                  e.target.value === bullet.text ? undefined : e.target.value,
                // Editing a quality-gated bullet auto-enables it.
                accepted: gateFailed ? true : bullet.accepted,
              })
            }
            rows={2}
            className="w-full resize-y rounded-xl border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:border-brand-emerald-300 focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-400/30"
            aria-label="Bullet text"
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]">
            {gateFailed && reason ? (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {reason}
              </span>
            ) : null}
            {isUserEdited ? (
              <button
                type="button"
                onClick={() => onChange({ ...bullet, userEdit: undefined })}
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                Reset to AI
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
