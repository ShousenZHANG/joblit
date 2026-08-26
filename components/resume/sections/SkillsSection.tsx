"use client";

import { useTranslations } from "next-intl";
import { Wrench, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { EntryCard } from "../EntryCard";
import { GhostAddRow } from "../GhostAddRow";
import { ReorderableList } from "../ReorderableList";
import { SectionShell } from "../SectionShell";
import { CollapseAllButton } from "../CollapseAllButton";
import type { ResumeCertification, ResumeSkillGroup } from "../types";

interface SkillsSectionProps {
  skills: ResumeSkillGroup[];
  updateSkillGroup: (index: number, field: keyof ResumeSkillGroup, value: string) => void;
  addSkillGroup: () => void;
  removeSkillGroup: (index: number) => void;
  onMove: (from: number, to: number) => void;
  expandedIds: ReadonlySet<string>;
  onToggleExpanded: (rowId: string) => void;
  onCollapseAll: () => void;
  /**
   * Certifications live inside this section because both PDF templates render
   * them as a labelled line of the skills block — the editor mirrors the page.
   */
  certifications: ResumeCertification[];
  onUpdateCertification: (index: number, field: "name" | "url", value: string) => void;
  onAddCertification: () => void;
  onRemoveCertification: (index: number) => void;
}

export function SkillsSection({
  skills,
  updateSkillGroup,
  addSkillGroup,
  removeSkillGroup,
  onMove,
  expandedIds,
  onToggleExpanded,
  onCollapseAll,
  certifications,
  onUpdateCertification,
  onAddCertification,
  onRemoveCertification,
}: SkillsSectionProps) {
  const t = useTranslations("resumeForm");

  return (
    <SectionShell
      id="skills"
      icon={Wrench}
      title={t("skills")}
      description={t("skillsDesc")}
      headerAction={
        <CollapseAllButton
          open={expandedIds.size}
          onCollapseAll={onCollapseAll}
        />
      }
    >
      <div className="space-y-2">
        <ReorderableList
          items={skills}
          getId={(group) => group.rowId}
          onMove={onMove}
          renderItem={(group, index, dragHandleProps, isDragging) => (
            <EntryCard
              title={group.category}
              subtitle={group.itemsText}
              untitledLabel={t("untitledSkillGroup")}
              expanded={expandedIds.has(group.rowId)}
              onToggle={() => onToggleExpanded(group.rowId)}
              onRemove={skills.length > 1 ? () => removeSkillGroup(index) : undefined}
              removeLabel={t("remove")}
              dragHandleProps={dragHandleProps}
              dragHandleLabel={t("dragToReorder")}
              isDragging={isDragging}
              onMoveUp={index > 0 ? () => onMove(index, index - 1) : undefined}
              onMoveDown={
                index < skills.length - 1 ? () => onMove(index, index + 1) : undefined
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor={`skill-label-${index}`}>{t("category")}</Label>
                <Input
                  id={`skill-label-${index}`}
                  value={group.category}
                  onChange={(e) => updateSkillGroup(index, "category", e.target.value)}
                  placeholder={t("categoryPlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`skill-items-${index}`}>{t("itemsCommaSeparated")}</Label>
                <Input
                  id={`skill-items-${index}`}
                  value={group.itemsText}
                  onChange={(e) => updateSkillGroup(index, "itemsText", e.target.value)}
                  placeholder={t("itemsPlaceholder")}
                />
              </div>
            </EntryCard>
          )}
        />
        <GhostAddRow
          label={t("addGroup")}
          onClick={() => {
            addSkillGroup();
          }}
        />

        <div className="space-y-2 border-t border-border/70 pt-4">
          <div className="space-y-0.5">
            <Label className="text-[13px]">{t("certifications")}</Label>
            <p className="text-xs text-muted-foreground">{t("certificationsDesc")}</p>
          </div>
          <div className="space-y-1.5">
            {certifications.map((cert, index) => (
              <div key={cert.rowId} className="flex items-center gap-2">
                <Input
                  aria-label={`${t("certificationName")} ${index + 1}`}
                  value={cert.name}
                  onChange={(e) => onUpdateCertification(index, "name", e.target.value)}
                  placeholder={t("certificationNamePlaceholder")}
                  className="min-w-0 flex-1"
                />
                <Input
                  aria-label={`${t("certificationUrl")} ${index + 1}`}
                  value={cert.url}
                  inputMode="url"
                  onChange={(e) => onUpdateCertification(index, "url", e.target.value)}
                  placeholder={t("certificationUrlPlaceholder")}
                  className="w-[13rem] shrink-0"
                />
                <button
                  type="button"
                  aria-label={`${t("remove")} ${cert.name || index + 1}`}
                  title={t("remove")}
                  onClick={() => onRemoveCertification(index)}
                  className="grid h-9 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 motion-reduce:transition-none"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
          </div>
          {certifications.length < 6 ? (
            <GhostAddRow
              label={t("addCertification")}
              onClick={onAddCertification}
              className="py-2 text-xs"
            />
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}
