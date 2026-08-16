"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Plus, RotateCcw, X } from "lucide-react";
import type { MasterSkillGroup } from "@/lib/shared/tailorReviewSnapshot";
import type { AiSkillsSelection } from "@/lib/shared/schemas/aiContent";
import { effectiveSkillsSelection } from "@/lib/shared/aiContentText";
import { cn } from "@/lib/utils";

type SelectionGroup = { group: number; items: number[] };

interface SkillsSelectionPanelProps {
  masterSkills: MasterSkillGroup[];
  selection: AiSkillsSelection | undefined;
  onChange: (next: AiSkillsSelection) => void;
}

interface RenderedGroup {
  groupIndex: number;
  category: string;
  selected: { item: number; label: string }[];
  available: { item: number; label: string }[];
}

/**
 * Project the stored selection onto the candidate's own bank, selection order
 * first, then whatever of that group is left over.
 *
 * Index references that no longer resolve are dropped rather than rendered as
 * blanks: the profile can be edited between generation and publish, and the
 * renderer already skips them for the same reason.
 */
function renderGroups(
  masterSkills: MasterSkillGroup[],
  selection: readonly SelectionGroup[],
): RenderedGroup[] {
  const order = selection.filter((entry) => masterSkills[entry.group]);
  const trailing = masterSkills
    .map((_, index) => index)
    .filter((index) => !order.some((entry) => entry.group === index))
    .map((index) => ({ group: index, items: [] as number[] }));

  return [...order, ...trailing].map((entry) => {
    const group = masterSkills[entry.group];
    const selected = entry.items
      .filter((item) => typeof group.items[item] === "string")
      .map((item) => ({ item, label: group.items[item] }));
    const available = group.items
      .map((label, item) => ({ item, label }))
      .filter(({ item }) => !entry.items.includes(item));
    return {
      groupIndex: entry.group,
      category: group.category,
      selected,
      available,
    };
  });
}

function toggleItem(
  selection: readonly SelectionGroup[],
  groupIndex: number,
  item: number,
  add: boolean,
): SelectionGroup[] {
  if (add) {
    const existing = selection.find((entry) => entry.group === groupIndex);
    if (!existing) {
      return [...selection, { group: groupIndex, items: [item] }];
    }
    return selection.map((entry) =>
      entry.group === groupIndex
        ? { ...entry, items: [...entry.items, item] }
        : { ...entry },
    );
  }
  return selection
    .map((entry) =>
      entry.group === groupIndex
        ? { ...entry, items: entry.items.filter((value) => value !== item) }
        : { ...entry },
    )
    .filter((entry) => entry.items.length > 0);
}

export function SkillsSelectionPanel({
  masterSkills,
  selection,
  onChange,
}: SkillsSelectionPanelProps) {
  const t = useTranslations("tailor.skills");
  const effective = useMemo<SelectionGroup[]>(
    () =>
      selection
        ? effectiveSkillsSelection(selection).map((entry) => ({
            group: entry.group,
            items: [...entry.items],
          }))
        : [],
    [selection],
  );
  const groups = useMemo(
    () => renderGroups(masterSkills, effective),
    [effective, masterSkills],
  );
  const selectedCount = groups.reduce(
    (total, group) => total + group.selected.length,
    0,
  );
  const editable = Boolean(selection);
  const edited = Boolean(selection?.userSelection);

  function apply(next: SelectionGroup[]) {
    if (!selection) return;
    onChange({ ...selection, userSelection: next });
  }

  if (!masterSkills.length) {
    return (
      <p className="text-xs text-muted-foreground">{t("emptyProfile")}</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {editable ? t("description", { count: selectedCount }) : t("unselected")}
        </p>
        {edited ? (
          <button
            type="button"
            onClick={() => selection && onChange({ ...selection, userSelection: undefined })}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {t("resetSelection")}
          </button>
        ) : null}
      </div>
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.groupIndex} className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group.category}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {group.selected.map(({ item, label }) => (
                <SkillChip
                  key={`on-${item}`}
                  label={label}
                  selected
                  disabled={!editable || selectedCount <= 1}
                  ariaLabel={t("removeSkill", { skill: label })}
                  onClick={() =>
                    apply(toggleItem(effective, group.groupIndex, item, false))
                  }
                />
              ))}
              {group.available.map(({ item, label }) => (
                <SkillChip
                  key={`off-${item}`}
                  label={label}
                  selected={false}
                  disabled={!editable}
                  ariaLabel={t("addSkill", { skill: label })}
                  onClick={() =>
                    apply(toggleItem(effective, group.groupIndex, item, true))
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SkillChipProps {
  label: string;
  selected: boolean;
  disabled: boolean;
  ariaLabel: string;
  onClick: () => void;
}

function SkillChip({
  label,
  selected,
  disabled,
  ariaLabel,
  onClick,
}: SkillChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        selected
          ? "bg-brand-emerald-50 font-medium text-brand-emerald-text ring-1 ring-brand-emerald-200 hover:bg-brand-emerald-100 dark:bg-brand-emerald-500/10"
          : "border border-dashed border-border text-muted-foreground/70 hover:border-solid hover:text-foreground",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {label}
      {selected ? (
        <X className="h-3 w-3 opacity-60" aria-hidden />
      ) : (
        <Plus className="h-3 w-3 opacity-60" aria-hidden />
      )}
    </button>
  );
}
