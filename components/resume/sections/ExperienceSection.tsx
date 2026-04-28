"use client";

import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, GripVertical, MoveDown, MoveUp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ReorderableList } from "../ReorderableList";
import { SectionShell } from "../SectionShell";
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
      title={t("experience")}
      description={t("experienceDesc")}
      action={
        <Button type="button" variant="secondary" onClick={addExperience}>
          {t("addExperience")}
        </Button>
      }
    >
      <ReorderableList
        items={experiences}
        section="experience"
        onMove={onMove}
        renderItem={(entry, index, dragHandleProps) => (
          <details
            open={expandedIndex === index}
            onToggle={(e) => {
              if ((e.currentTarget as HTMLDetailsElement).open) {
                setExpandedIndex(index);
              }
            }}
            className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.08)]"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-1 py-1">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {t("experienceN", { n: index + 1 })}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {entry.title || entry.company
                    ? `${entry.title || t("untitled")} · ${entry.company || t("company")}`
                    : t("draft")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move experience up"
                  disabled={index === 0}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onMove(index, index - 1);
                  }}
                >
                  <MoveUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move experience down"
                  disabled={index === experiences.length - 1}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onMove(index, index + 1);
                  }}
                >
                  <MoveDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Drag to reorder experience"
                  className="cursor-grab active:cursor-grabbing"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  {...dragHandleProps}
                >
                  <GripVertical className="h-4 w-4" />
                </Button>
                {experiences.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-xs text-red-600 hover:text-red-600"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeExperience(index);
                    }}
                  >
                    {t("remove")}
                  </Button>
                ) : null}
                {expandedIndex === index ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </summary>

            <div className="space-y-3 pt-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`experience-title-${index}`}>{t("experienceTitle")}</Label>
                  <Input
                    id={`experience-title-${index}`}
                    value={entry.title}
                    onChange={(e) => updateExperience(index, "title", e.target.value)}
                    placeholder={t("experienceTitlePlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`experience-company-${index}`}>{t("experienceCompany")}</Label>
                  <Input
                    id={`experience-company-${index}`}
                    value={entry.company}
                    onChange={(e) => updateExperience(index, "company", e.target.value)}
                    placeholder={t("experienceCompanyPlaceholder")}
                  />
                </div>
                {locale !== "zh-CN" && (
                  <div className="space-y-2">
                    <Label htmlFor={`experience-location-${index}`}>
                      {t("experienceLocation")}
                    </Label>
                    <Input
                      id={`experience-location-${index}`}
                      value={entry.location}
                      onChange={(e) => updateExperience(index, "location", e.target.value)}
                      placeholder={t("experienceLocationPlaceholder")}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor={`experience-dates-${index}`}>{t("experienceDates")}</Label>
                  <Input
                    id={`experience-dates-${index}`}
                    value={entry.dates}
                    onChange={(e) => updateExperience(index, "dates", e.target.value)}
                    placeholder={t("experienceDatesPlaceholder")}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("experienceLinks")}</Label>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => addExperienceLink(index)}
                    disabled={entry.links.length >= 2}
                  >
                    {t("addLink")}
                  </Button>
                </div>
                <div className="space-y-2">
                  {entry.links.map((link, linkIndex) => (
                    <div
                      key={`experience-${index}-link-${linkIndex}`}
                      className="grid gap-2 md:grid-cols-[1fr_2fr_auto]"
                    >
                      <Input
                        value={link.label}
                        onChange={(e) =>
                          updateExperienceLink(index, linkIndex, "label", e.target.value)
                        }
                        placeholder={t("expLinkLabelPlaceholder")}
                      />
                      <Input
                        value={link.url}
                        onChange={(e) =>
                          updateExperienceLink(index, linkIndex, "url", e.target.value)
                        }
                        placeholder={t("linkUrlPlaceholder")}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => removeExperienceLink(index, linkIndex)}
                      >
                        {t("remove")}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("experienceBullets")}</Label>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => addExperienceBullet(index)}
                  >
                    {t("addBullet")}
                  </Button>
                </div>
                <div className="space-y-2">
                  {entry.bullets.map((bullet, bulletIndex) => (
                    <div key={`exp-${index}-bullet-${bulletIndex}`} className="flex gap-2">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor={`experience-bullet-${index}-${bulletIndex}`}>
                            {t("experienceBullet")}
                          </Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              applyBoldMarkdown(
                                `exp-bullet-${index}-${bulletIndex}`,
                                bullet,
                                (next) => updateExperienceBullet(index, bulletIndex, next),
                              )
                            }
                          >
                            {t("boldSelected")}
                          </Button>
                        </div>
                        <Input
                          id={`experience-bullet-${index}-${bulletIndex}`}
                          ref={registerMarkdownRef(`exp-bullet-${index}-${bulletIndex}`)}
                          value={bullet}
                          onChange={(e) =>
                            updateExperienceBullet(index, bulletIndex, e.target.value)
                          }
                          placeholder={t("experienceBulletPlaceholder")}
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => removeExperienceBullet(index, bulletIndex)}
                        >
                          {t("remove")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        )}
      />
    </SectionShell>
  );
}
