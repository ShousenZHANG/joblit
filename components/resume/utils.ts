import type { ReorderSection } from "./types";

export function hasContent(value: string): boolean {
  return value.trim().length > 0;
}

export function hasBullets(items: string[]): boolean {
  return items.some((item) => hasContent(item));
}

export function normalizeBullets(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

export function normalizeCommaItems(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toSortableId(section: ReorderSection, index: number): string {
  return `${section}:${index}`;
}

export function toSortableIndex(id: string | number, section: ReorderSection): number | null {
  const [idSection, indexText] = String(id).split(":");
  if (idSection !== section) return null;
  const index = Number(indexText);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function remapFocusedIndex(currentIndex: number, from: number, to: number): number {
  if (currentIndex === from) return to;
  if (from < to && currentIndex > from && currentIndex <= to) return currentIndex - 1;
  if (to < from && currentIndex >= to && currentIndex < from) return currentIndex + 1;
  return currentIndex;
}
