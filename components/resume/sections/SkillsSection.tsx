"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Wrench } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { EntryCard } from "../EntryCard";
import { GhostAddRow } from "../GhostAddRow";
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
  const [expandedIndex, setExpandedIndex] = useState(0);

  return (
    <SectionShell
      id="skills"
      icon={Wrench}
      title={t("skills")}
      description={t("skillsDesc")}
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
              expanded={expandedIndex === index}
              onToggle={() => setExpandedIndex(expandedIndex === index ? -1 : index)}
              onRemove={skills.length > 1 ? () => removeSkillGroup(index) : undefined}
              removeLabel={t("remove")}
              dragHandleProps={dragHandleProps}
              dragHandleLabel={t("dragToReorder")}
              isDragging={isDragging}
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
            setExpandedIndex(skills.length);
          }}
        />
      </div>
    </SectionShell>
  );
}
