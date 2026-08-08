"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { GraduationCap } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { EntryCard } from "../EntryCard";
import { GhostAddRow } from "../GhostAddRow";
import { ReorderableList } from "../ReorderableList";
import { SectionShell } from "../SectionShell";
import { summaryLine } from "../entrySummary";
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
  // Only one entry is open at a time: an accordion keeps the list scannable
  // and the live preview's relationship to "the thing I am editing" obvious.
  const [expandedIndex, setExpandedIndex] = useState(0);

  return (
    <SectionShell
      id="education"
      icon={GraduationCap}
      title={t("education")}
      description={t("educationDesc")}
    >
      <div className="space-y-2">
        <ReorderableList
          items={education}
          getId={(entry) => entry.rowId}
          onMove={onMove}
          renderItem={(entry, index, dragHandleProps, isDragging) => (
            <EntryCard
              title={entry.school || entry.degree}
              subtitle={summaryLine([entry.degree || null, entry.dates])}
              untitledLabel={t("untitledEducation")}
              expanded={expandedIndex === index}
              onToggle={() => setExpandedIndex(expandedIndex === index ? -1 : index)}
              onRemove={education.length > 1 ? () => removeEducation(index) : undefined}
              removeLabel={t("remove")}
              dragHandleProps={dragHandleProps}
              dragHandleLabel={t("dragToReorder")}
              isDragging={isDragging}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`education-school-${index}`}>{t("school")}</Label>
                  <Input
                    id={`education-school-${index}`}
                    value={entry.school}
                    onChange={(e) => updateEducation(index, "school", e.target.value)}
                    placeholder={t("schoolPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`education-degree-${index}`}>{t("degree")}</Label>
                  <Input
                    id={`education-degree-${index}`}
                    value={entry.degree}
                    onChange={(e) => updateEducation(index, "degree", e.target.value)}
                    placeholder={t("degreePlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`education-location-${index}`}>
                    {t("educationLocation")}
                  </Label>
                  <Input
                    id={`education-location-${index}`}
                    value={entry.location}
                    onChange={(e) => updateEducation(index, "location", e.target.value)}
                    placeholder={t("educationLocationPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`education-dates-${index}`}>{t("educationDates")}</Label>
                  <Input
                    id={`education-dates-${index}`}
                    value={entry.dates}
                    onChange={(e) => updateEducation(index, "dates", e.target.value)}
                    placeholder={t("educationDatesPlaceholder")}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`education-details-${index}`}>{t("detailsOptional")}</Label>
                <Input
                  id={`education-details-${index}`}
                  value={entry.details ?? ""}
                  onChange={(e) => updateEducation(index, "details", e.target.value)}
                  placeholder={t("detailsPlaceholder")}
                />
              </div>
            </EntryCard>
          )}
        />
        <GhostAddRow
          label={t("addEducation")}
          onClick={() => {
            addEducation();
            setExpandedIndex(education.length);
          }}
        />
      </div>
    </SectionShell>
  );
}
