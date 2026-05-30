"use client";

import { useTranslations } from "next-intl";
import { GripVertical, MoveDown, MoveUp, Plus, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ReorderableList } from "../ReorderableList";
import { SectionShell } from "../SectionShell";
import type { ResumeEducation } from "../types";

interface EducationSectionProps {
  education: ResumeEducation[];
  updateEducation: (index: number, field: keyof ResumeEducation, value: string) => void;
  addEducation: () => void;
  removeEducation: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

export function EducationSection({
  education,
  updateEducation,
  addEducation,
  removeEducation,
  onMove,
}: EducationSectionProps) {
  const t = useTranslations("resumeForm");

  return (
    <SectionShell
      title={t("education")}
      description={t("educationDesc")}
      action={
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={addEducation}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t("addEducation")}
        </Button>
      }
    >
      <ReorderableList
        items={education}
        section="education"
        onMove={onMove}
        renderItem={(entry, index, dragHandleProps) => (
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.08)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                {t("educationN", { n: index + 1 })}
              </p>
              <div className="flex items-center gap-0.5 text-muted-foreground">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move education up"
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
                  aria-label="Move education down"
                  disabled={index === education.length - 1}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onMove(index, index + 1)}
                >
                  <MoveDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Drag to reorder education"
                  className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                  {...dragHandleProps}
                >
                  <GripVertical className="h-4 w-4" />
                </Button>
                {education.length > 1 ? (
                  <>
                    <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("remove")}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeEducation(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`education-school-${index}`}>{t("school")}</Label>
                <Input
                  id={`education-school-${index}`}
                  value={entry.school}
                  onChange={(e) => updateEducation(index, "school", e.target.value)}
                  placeholder={t("schoolPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`education-degree-${index}`}>{t("degree")}</Label>
                <Input
                  id={`education-degree-${index}`}
                  value={entry.degree}
                  onChange={(e) => updateEducation(index, "degree", e.target.value)}
                  placeholder={t("degreePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`education-location-${index}`}>{t("educationLocation")}</Label>
                <Input
                  id={`education-location-${index}`}
                  value={entry.location}
                  onChange={(e) => updateEducation(index, "location", e.target.value)}
                  placeholder={t("educationLocationPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`education-dates-${index}`}>{t("educationDates")}</Label>
                <Input
                  id={`education-dates-${index}`}
                  value={entry.dates}
                  onChange={(e) => updateEducation(index, "dates", e.target.value)}
                  placeholder={t("educationDatesPlaceholder")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`education-details-${index}`}>{t("detailsOptional")}</Label>
              <Input
                id={`education-details-${index}`}
                value={entry.details ?? ""}
                onChange={(e) => updateEducation(index, "details", e.target.value)}
                placeholder={t("detailsPlaceholder")}
              />
            </div>
          </div>
        )}
      />
    </SectionShell>
  );
}
