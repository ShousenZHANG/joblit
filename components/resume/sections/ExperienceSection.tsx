"use client";

import { useTranslations } from "next-intl";
import { Briefcase } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { EntryCard } from "../EntryCard";
import { GhostAddRow } from "../GhostAddRow";
import { ReorderableList } from "../ReorderableList";
import { SectionShell } from "../SectionShell";
import { BulletList } from "../BulletList";
import { EntryLinkRows } from "../EntryLinkRows";
import { summaryLine } from "../entrySummary";
import type { ResumeExperience, ResumeLink } from "../types";

interface ExperienceSectionProps {
  experiences: ResumeExperience[];
  locale: string;
  expandedIndex: number;
  setExpandedIndex: (index: number) => void;
  updateExperience: (index: number, field: keyof ResumeExperience, value: string) => void;
  addExperience: () => void;
  removeExperience: (index: number) => void;
  updateExperienceBullet: (expIndex: number, bulletIndex: number, value: string) => void;
  addExperienceBullet: (expIndex: number) => void;
  removeExperienceBullet: (expIndex: number, bulletIndex: number) => void;
  updateExperienceLink: (
    expIndex: number,
    linkIndex: number,
    field: keyof ResumeLink,
    value: string,
  ) => void;
  addExperienceLink: (expIndex: number) => void;
  removeExperienceLink: (expIndex: number, linkIndex: number) => void;
  onMove: (from: number, to: number) => void;
  applyBoldMarkdown: (
    key: string,
    currentValue: string,
    onChange: (nextValue: string) => void,
  ) => void;
  registerMarkdownRef: (
    key: string,
  ) => (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
}

export function ExperienceSection({
  experiences,
  locale,
  expandedIndex,
  setExpandedIndex,
  updateExperience,
  addExperience,
  removeExperience,
  updateExperienceBullet,
  addExperienceBullet,
  removeExperienceBullet,
  updateExperienceLink,
  addExperienceLink,
  removeExperienceLink,
  onMove,
  applyBoldMarkdown,
  registerMarkdownRef,
}: ExperienceSectionProps) {
  const t = useTranslations("resumeForm");

  return (
    <SectionShell
      id="experience"
      icon={Briefcase}
      title={t("experience")}
      description={t("experienceDesc")}
    >
      <div className="space-y-2">
        <ReorderableList
          items={experiences}
          getId={(entry) => entry.rowId}
          onMove={onMove}
          renderItem={(entry, index, dragHandleProps, isDragging) => (
            <EntryCard
              title={entry.title}
              subtitle={summaryLine([entry.company, entry.dates])}
              untitledLabel={t("untitledExperience")}
              expanded={expandedIndex === index}
              onToggle={() => setExpandedIndex(expandedIndex === index ? -1 : index)}
              onRemove={
                experiences.length > 1 ? () => removeExperience(index) : undefined
              }
              removeLabel={t("remove")}
              dragHandleProps={dragHandleProps}
              dragHandleLabel={t("dragToReorder")}
              isDragging={isDragging}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`experience-title-${index}`}>
                    {t("experienceTitle")}
                  </Label>
                  <Input
                    id={`experience-title-${index}`}
                    value={entry.title}
                    onChange={(e) => updateExperience(index, "title", e.target.value)}
                    placeholder={t("experienceTitlePlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`experience-company-${index}`}>
                    {t("experienceCompany")}
                  </Label>
                  <Input
                    id={`experience-company-${index}`}
                    value={entry.company}
                    onChange={(e) => updateExperience(index, "company", e.target.value)}
                    placeholder={t("experienceCompanyPlaceholder")}
                  />
                </div>
                {locale !== "zh-CN" && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`experience-location-${index}`}>
                      {t("experienceLocation")}
                    </Label>
                    <Input
                      id={`experience-location-${index}`}
                      value={entry.location}
                      onChange={(e) =>
                        updateExperience(index, "location", e.target.value)
                      }
                      placeholder={t("experienceLocationPlaceholder")}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor={`experience-dates-${index}`}>
                    {t("experienceDates")}
                  </Label>
                  <Input
                    id={`experience-dates-${index}`}
                    value={entry.dates}
                    onChange={(e) => updateExperience(index, "dates", e.target.value)}
                    placeholder={t("experienceDatesPlaceholder")}
                  />
                </div>
              </div>

              <EntryLinkRows
                links={entry.links}
                label={t("experienceLinks")}
                labelPlaceholder={t("expLinkLabelPlaceholder")}
                idPrefix={`experience-${index}`}
                maxLinks={2}
                onUpdate={(linkIndex, field, value) =>
                  updateExperienceLink(index, linkIndex, field, value)
                }
                onAdd={() => addExperienceLink(index)}
                onRemove={(linkIndex) => removeExperienceLink(index, linkIndex)}
              />

              <BulletList
                bullets={entry.bullets}
                label={t("experienceBullets")}
                placeholder={t("experienceBulletPlaceholder")}
                idPrefix={`experience-bullet-${index}`}
                markdownKeyPrefix={`exp-bullet-${index}`}
                onUpdate={(bulletIndex, value) =>
                  updateExperienceBullet(index, bulletIndex, value)
                }
                onAdd={() => addExperienceBullet(index)}
                onRemove={(bulletIndex) => removeExperienceBullet(index, bulletIndex)}
                applyBoldMarkdown={applyBoldMarkdown}
                registerMarkdownRef={registerMarkdownRef}
              />
            </EntryCard>
          )}
        />
        <GhostAddRow
          label={t("addExperience")}
          onClick={() => {
            addExperience();
            setExpandedIndex(experiences.length);
          }}
        />
      </div>
    </SectionShell>
  );
}
