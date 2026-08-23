"use client";

import { useTranslations } from "next-intl";
import { FolderKanban } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { EntryCard } from "../EntryCard";
import { GhostAddRow } from "../GhostAddRow";
import { ReorderableList } from "../ReorderableList";
import { SectionShell } from "../SectionShell";
import { CollapseAllButton } from "../CollapseAllButton";
import { BulletList } from "../BulletList";
import { EntryLinkRows } from "../EntryLinkRows";
import { summaryLine } from "../entrySummary";
import type { ResumeLink, ResumeProject } from "../types";

interface ProjectsSectionProps {
  projects: ResumeProject[];
  locale: string;
  expandedIds: ReadonlySet<string>;
  onToggleExpanded: (rowId: string) => void;
  onCollapseAll: () => void;
  updateProject: (index: number, field: keyof ResumeProject, value: string) => void;
  addProject: () => void;
  removeProject: (index: number) => void;
  updateProjectBullet: (projectIndex: number, bulletIndex: number, value: string) => void;
  addProjectBullet: (projectIndex: number) => void;
  removeProjectBullet: (projectIndex: number, bulletIndex: number) => void;
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
  locale,
  expandedIds,
  onToggleExpanded,
  onCollapseAll,
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
      id="projects"
      icon={FolderKanban}
      title={t("projects")}
      description={t("projectsDesc")}
      headerAction={
        <CollapseAllButton
          open={expandedIds.size}
          onCollapseAll={onCollapseAll}
        />
      }
    >
      <div className="space-y-2">
        <ReorderableList
          items={projects}
          getId={(entry) => entry.rowId}
          onMove={onMove}
          renderItem={(entry, index, dragHandleProps, isDragging) => (
            <EntryCard
              title={entry.name}
              subtitle={summaryLine([entry.stack, entry.dates])}
              untitledLabel={t("untitledProject")}
              expanded={expandedIds.has(entry.rowId)}
              onToggle={() => onToggleExpanded(entry.rowId)}
              onRemove={projects.length > 1 ? () => removeProject(index) : undefined}
              removeLabel={t("remove")}
              dragHandleProps={dragHandleProps}
              dragHandleLabel={t("dragToReorder")}
              isDragging={isDragging}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`project-name-${index}`}>{t("projectName")}</Label>
                  <Input
                    id={`project-name-${index}`}
                    value={entry.name}
                    onChange={(e) => updateProject(index, "name", e.target.value)}
                    placeholder={t("projectNamePlaceholder")}
                  />
                </div>
                {locale !== "zh-CN" && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`project-location-${index}`}>
                      {t("projectLocation")}
                    </Label>
                    <Input
                      id={`project-location-${index}`}
                      value={entry.location}
                      onChange={(e) => updateProject(index, "location", e.target.value)}
                      placeholder={t("projectLocationPlaceholder")}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor={`project-dates-${index}`}>{t("projectDates")}</Label>
                  <Input
                    id={`project-dates-${index}`}
                    value={entry.dates}
                    onChange={(e) => updateProject(index, "dates", e.target.value)}
                    placeholder={t("projectDatesPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`project-stack-${index}`}>{t("techStack")}</Label>
                  <Input
                    id={`project-stack-${index}`}
                    value={entry.stack}
                    onChange={(e) => updateProject(index, "stack", e.target.value)}
                    placeholder={t("techStackPlaceholder")}
                  />
                </div>
              </div>

              <EntryLinkRows
                links={entry.links}
                label={t("projectLinksOptional")}
                labelPlaceholder={t("projectLinkLabelPlaceholder")}
                idPrefix={`project-${index}`}
                maxLinks={2}
                onUpdate={(linkIndex, field, value) =>
                  updateProjectLink(index, linkIndex, field, value)
                }
                onAdd={() => addProjectLink(index)}
                onRemove={(linkIndex) => removeProjectLink(index, linkIndex)}
              />

              <BulletList
                bullets={entry.bullets}
                label={t("projectBullets")}
                placeholder={t("projectBulletPlaceholder")}
                idPrefix={`project-bullet-${index}`}
                markdownKeyPrefix={`project-bullet-${index}`}
                onUpdate={(bulletIndex, value) =>
                  updateProjectBullet(index, bulletIndex, value)
                }
                onAdd={() => addProjectBullet(index)}
                onRemove={(bulletIndex) => removeProjectBullet(index, bulletIndex)}
                applyBoldMarkdown={applyBoldMarkdown}
                registerMarkdownRef={registerMarkdownRef}
              />
            </EntryCard>
          )}
        />
        <GhostAddRow
          label={t("addProject")}
          onClick={() => {
            addProject();
          }}
        />
      </div>
    </SectionShell>
  );
}
