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

export function remapFocusedIndex(currentIndex: number, from: number, to: number): number {
  if (currentIndex === from) return to;
  if (from < to && currentIndex > from && currentIndex <= to) return currentIndex - 1;
  if (to < from && currentIndex >= to && currentIndex < from) return currentIndex + 1;
  return currentIndex;
}
