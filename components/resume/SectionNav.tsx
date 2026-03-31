"use client";

import { User, FileText, Briefcase, FolderKanban, GraduationCap, Wrench, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useResumeContext } from "./ResumeContext";
import type { SectionId } from "./constants";
import { cn } from "@/lib/utils";

type SectionTranslationKey = "personalInfo" | "summary" | "experience" | "projects" | "education" | "skills";

const SECTION_CONFIG: Array<{ id: SectionId; tKey: SectionTranslationKey; icon: React.ElementType }> = [
  { id: "personal", tKey: "personalInfo", icon: User },
  { id: "summary", tKey: "summary", icon: FileText },
  { id: "experience", tKey: "experience", icon: Briefcase },
  { id: "projects", tKey: "projects", icon: FolderKanban },
  { id: "education", tKey: "education", icon: GraduationCap },
  { id: "skills", tKey: "skills", icon: Wrench },
];

interface SectionNavProps {
  className?: string;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function SectionNav({ className, collapsed, onToggle }: SectionNavProps) {
  const { activeSection, setActiveSection, t } = useResumeContext();

  return (
    <nav className={cn("flex", className)} aria-label="Resume sections">
      {/* Desktop: vertical list */}
      <div className="hidden lg:flex lg:w-full lg:flex-col lg:gap-1">
        {SECTION_CONFIG.map(({ id, tKey, icon: Icon }) => {
          const isActive = activeSection === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? t(tKey) : undefined}
              className={cn(
                "transition",
                collapsed
                  ? cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl border mx-auto",
                      isActive
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70",
                    )
                  : cn(
                      "flex min-h-10 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm",
                      isActive
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70",
                    ),
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {collapsed ? null : <span>{t(tKey)}</span>}
            </button>
          );
        })}

        {/* Collapse/expand toggle */}
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              "mt-auto flex items-center rounded-xl border border-transparent px-3 py-2 text-slate-400 transition hover:border-slate-200 hover:bg-white/70 hover:text-slate-600",
              collapsed ? "h-10 w-10 justify-center mx-auto" : "gap-3 text-sm",
            )}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4 shrink-0" />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </button>
        ) : null}
      </div>

      {/* Mobile: horizontal scrollable tabs */}
      <div className="scrollbar-hide flex w-full gap-2 overflow-x-auto px-4 py-2 lg:hidden">
        {SECTION_CONFIG.map(({ id, tKey, icon: Icon }) => {
          const isActive = activeSection === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition",
                isActive
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap">{t(tKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
