"use client";

import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, GripVertical, MoveDown, MoveUp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ReorderableList } from "../ReorderableList";
import { SectionShell } from "../SectionShell";
import type { ResumeProject, ResumeLink } from "../types";

interface ProjectsSectionProps {
  projects: ResumeProject[];
  locale: string;
  expandedIndex: number;
  setExpandedIndex: (index: number) => void;
  updateProject: (index: number, field: keyof ResumeProject, value: string) => void;
  addProject: () => void;
  removeProject: (index: number) => void;
  updateProjectBullet: (projIndex: number, bulletIndex: number, value: string) => void;
  addProjectBullet: (projIndex: number) => void;
  removeProjectBullet: (projIndex: number, bulletIndex: number) => void;
  updateProjectLink: (
    projectIndex: number,
    linkIndex: number,
    field: keyof ResumeLink,
    value: string,
  ) => void;
  addProjectLink: (projectIndex: number) => void;
  removeProjectLink: (projectIndex: number, linkIndex: number) => void;
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

export function ProjectsSection({
  projects,
  expandedIndex,
  setExpandedIndex,
  updateProject,
  addProject,
  removeProject,
  updateProjectBullet,
  addProjectBullet,
  removeProjectBullet,
  updateProjectLink,
  addProjectLink,
  removeProjectLink,
  onMove,
  applyBoldMarkdown,
  registerMarkdownRef,
}: ProjectsSectionProps) {
  const t = useTranslations("resumeForm");

  return (
    <SectionShell
      title={t("projects")}
      description={t("projectsDesc")}
      action={
        <Button type="button" variant="secondary" onClick={addProject}>
          {t("addProject")}
        </Button>
      }
    >
      <ReorderableList
        items={projects}
        section="project"
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
                  {t("projectN", { n: index + 1 })}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {entry.name
                    ? `${entry.name}${entry.stack ? ` · ${entry.stack}` : ""}`
                    : t("draft")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move project up"
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
                  aria-label="Move project down"
                  disabled={index === projects.length - 1}
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
                  aria-label="Drag to reorder project"
                  className="cursor-grab active:cursor-grabbing"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  {...dragHandleProps}
                >
                  <GripVertical className="h-4 w-4" />
                </Button>
                {projects.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-xs text-red-600 hover:text-red-600"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeProject(index);
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
                  <Label htmlFor={`project-name-${index}`}>{t("projectName")}</Label>
                  <Input
                    id={`project-name-${index}`}
                    value={entry.name}
                    onChange={(e) => updateProject(index, "name", e.target.value)}
                    placeholder={t("projectNamePlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`project-location-${index}`}>{t("projectLocation")}</Label>
                  <Input
                    id={`project-location-${index}`}
                    value={entry.location}
                    onChange={(e) => updateProject(index, "location", e.target.value)}
                    placeholder={t("projectLocationPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`project-dates-${index}`}>{t("projectDates")}</Label>
                  <Input
                    id={`project-dates-${index}`}
                    value={entry.dates}
                    onChange={(e) => updateProject(index, "dates", e.target.value)}
                    placeholder={t("projectDatesPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`project-stack-${index}`}>{t("techStack")}</Label>
                  <Input
                    id={`project-stack-${index}`}
                    value={entry.stack}
                    onChange={(e) => updateProject(index, "stack", e.target.value)}
                    placeholder={t("techStackPlaceholder")}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("projectLinksOptional")}</Label>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => addProjectLink(index)}
                  >
                    {t("addLink")}
                  </Button>
                </div>
                <div className="space-y-2">
                  {entry.links.map((link, linkIndex) => (
                    <div
                      key={`project-${index}-link-${linkIndex}`}
                      className="grid gap-2 md:grid-cols-[1fr_2fr_auto]"
                    >
                      <Input
                        value={link.label}
                        onChange={(e) =>
                          updateProjectLink(index, linkIndex, "label", e.target.value)
                        }
                        placeholder={t("projectLinkLabelPlaceholder")}
                      />
                      <Input
                        value={link.url}
                        onChange={(e) =>
                          updateProjectLink(index, linkIndex, "url", e.target.value)
                        }
                        placeholder={t("linkUrlPlaceholder")}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => removeProjectLink(index, linkIndex)}
                      >
                        {t("remove")}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("projectBullets")}</Label>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => addProjectBullet(index)}
                  >
                    {t("addBullet")}
                  </Button>
                </div>
                <div className="space-y-2">
                  {entry.bullets.map((bullet, bulletIndex) => (
                    <div key={`project-${index}-bullet-${bulletIndex}`} className="flex gap-2">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor={`project-bullet-${index}-${bulletIndex}`}>
                            {t("projectBullet")}
                          </Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              applyBoldMarkdown(
                                `project-bullet-${index}-${bulletIndex}`,
                                bullet,
                                (next) => updateProjectBullet(index, bulletIndex, next),
                              )
                            }
                          >
                            {t("boldSelected")}
                          </Button>
                        </div>
                        <Input
                          id={`project-bullet-${index}-${bulletIndex}`}
                          ref={registerMarkdownRef(`project-bullet-${index}-${bulletIndex}`)}
                          value={bullet}
                          onChange={(e) =>
                            updateProjectBullet(index, bulletIndex, e.target.value)
                          }
                          placeholder={t("projectBulletPlaceholder")}
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => removeProjectBullet(index, bulletIndex)}
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
