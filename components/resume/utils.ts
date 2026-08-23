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

