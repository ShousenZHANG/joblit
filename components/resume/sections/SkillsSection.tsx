"use client";

import { useTranslations } from "next-intl";
import { GripVertical, MoveDown, MoveUp, Plus, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ReorderableList } from "../ReorderableList";
import { SectionShell } from "../SectionShell";
import type { ResumeSkillGroup } from "../types";

interface SkillsSectionProps {
  skills: ResumeSkillGroup[];
  updateSkillGroup: (index: number, field: keyof ResumeSkillGroup, value: string) => void;
  addSkillGroup: () => void;
  removeSkillGroup: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

export function SkillsSection({
  skills,
  updateSkillGroup,
  addSkillGroup,
  removeSkillGroup,
  onMove,
}: SkillsSectionProps) {
  const t = useTranslations("resumeForm");

  return (
    <SectionShell
      title={t("skills")}
      description={t("skillsDesc")}
      action={
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={addSkillGroup}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t("addGroup")}
        </Button>
      }
    >
      <ReorderableList
        items={skills}
        getId={(group) => group.rowId}
        onMove={onMove}
        renderItem={(group, index, dragHandleProps) => (
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.08)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                {t("groupN", { n: index + 1 })}
              </p>
              <div className="flex items-center gap-0.5 text-muted-foreground">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move skill group up"
                  disabled={index === 0}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onMove(index, index - 1)}
                >
                  <MoveUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move skill group down"
                  disabled={index === skills.length - 1}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onMove(index, index + 1)}
                >
                  <MoveDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Drag to reorder skill group"
                  className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                  {...dragHandleProps}
                >
                  <GripVertical className="h-4 w-4" />
                </Button>
                {skills.length > 1 ? (
                  <>
                    <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("remove")}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeSkillGroup(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`skill-label-${index}`}>{t("category")}</Label>
              <Input
                id={`skill-label-${index}`}
                value={group.category}
                onChange={(e) => updateSkillGroup(index, "category", e.target.value)}
                placeholder={t("categoryPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`skill-items-${index}`}>{t("itemsCommaSeparated")}</Label>
              <Input
                id={`skill-items-${index}`}
                value={group.itemsText}
                onChange={(e) => updateSkillGroup(index, "itemsText", e.target.value)}
                placeholder={t("itemsPlaceholder")}
              />
            </div>
          </div>
        )}
      />
    </SectionShell>
  );
}
