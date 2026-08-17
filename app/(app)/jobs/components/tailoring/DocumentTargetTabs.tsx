"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { TailorTarget } from "./tailorActions";

const TARGETS = ["resume", "cover"] as const;

/** Per-tab status dot plus the text that keeps it legible without colour. */
export type DocumentTargetIndicator = {
  kind: "draft" | "published";
  label: string;
};

type DocumentTargetTabsProps = {
  target: TailorTarget;
  onSelect: (target: TailorTarget) => void;
  label: string;
  labels: Record<TailorTarget, string>;
  indicators?: Record<TailorTarget, DocumentTargetIndicator | null>;
  disabled?: boolean;
  children: ReactNode;
};

type TargetTabProps = {
  item: TailorTarget;
  target: TailorTarget;
  baseId: string;
  label: string;
  indicator: DocumentTargetIndicator | null;
  disabled: boolean;
  setRef: (node: HTMLButtonElement | null) => void;
  onSelect: (target: TailorTarget) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

type TargetTabListProps = Pick<
  DocumentTargetTabsProps,
  "target" | "onSelect" | "label" | "labels" | "indicators"
> & {
  baseId: string;
  disabled: boolean;
  setRef: (target: TailorTarget, node: HTMLButtonElement | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

function targetForKey(key: string, current: TailorTarget): TailorTarget | null {
  if (key === "Home") return TARGETS[0];
  if (key === "End") return TARGETS.at(-1) ?? TARGETS[0];
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;

  const direction = key === "ArrowRight" ? 1 : -1;
  const currentIndex = TARGETS.indexOf(current);
  return TARGETS[(currentIndex + direction + TARGETS.length) % TARGETS.length];
}

function TargetTab({
  item,
  target,
  baseId,
  label,
  indicator,
  disabled,
  setRef,
  onSelect,
  onKeyDown,
}: TargetTabProps) {
  const active = item === target;
  return (
    <button
      ref={setRef}
      id={`${baseId}-${item}-tab`}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`${baseId}-panel`}
      aria-label={indicator ? `${label}, ${indicator.label}` : undefined}
      tabIndex={active ? 0 : -1}
      disabled={disabled}
      onClick={() => onSelect(item)}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex min-h-11 min-w-11 touch-manipulation items-center rounded-full px-4 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {indicator ? (
        <span
          aria-hidden
          data-indicator={indicator.kind}
          className={cn(
            "ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
            indicator.kind === "published"
              ? "bg-brand-emerald-500"
              : "bg-muted-foreground/50",
          )}
        />
      ) : null}
    </button>
  );
}

function TargetTabList({
  target,
  onSelect,
  label,
  labels,
  indicators,
  baseId,
  disabled,
  setRef,
  onKeyDown,
}: TargetTabListProps) {
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background p-1"
    >
      {TARGETS.map((item) => (
        <TargetTab
          key={item}
          item={item}
          target={target}
          baseId={baseId}
          label={labels[item]}
          indicator={indicators?.[item] ?? null}
          disabled={disabled}
          setRef={(node) => setRef(item, node)}
          onSelect={onSelect}
          onKeyDown={onKeyDown}
        />
      ))}
    </div>
  );
}

/**
 * One panel, not one per tab.
 *
 * Both documents are edited by the same autosaving session, and a panel per
 * target would place that session at a different position in the tree for each
 * one — so switching tabs unmounted it and threw away every unsaved edit and
 * the pending autosave with it. A single panel keeps the subtree mounted and
 * lets the tabs change nothing but which document it is pointed at.
 */
function TargetPanel({
  target,
  baseId,
  children,
}: {
  target: TailorTarget;
  baseId: string;
  children: ReactNode;
}) {
  return (
    <div
      id={`${baseId}-panel`}
      role="tabpanel"
      aria-labelledby={`${baseId}-${target}-tab`}
      tabIndex={0}
      className="flex min-w-0 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {children}
    </div>
  );
}

export function DocumentTargetTabs({
  target,
  onSelect,
  label,
  labels,
  indicators,
  disabled = false,
  children,
}: DocumentTargetTabsProps) {
  const baseId = useId();
  const tabRefs = useRef<Record<TailorTarget, HTMLButtonElement | null>>({
    resume: null,
    cover: null,
  });

  function selectAndFocus(nextTarget: TailorTarget) {
    onSelect(nextTarget);
    tabRefs.current[nextTarget]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const nextTarget = targetForKey(event.key, target);
    if (!nextTarget) return;
    event.preventDefault();
    selectAndFocus(nextTarget);
  }

  return (
    <>
      <TargetTabList
        target={target}
        onSelect={onSelect}
        label={label}
        labels={labels}
        indicators={indicators}
        baseId={baseId}
        disabled={disabled}
        setRef={(item, node) => {
          tabRefs.current[item] = node;
        }}
        onKeyDown={handleKeyDown}
      />
      <TargetPanel target={target} baseId={baseId}>
        {children}
      </TargetPanel>
    </>
  );
}
