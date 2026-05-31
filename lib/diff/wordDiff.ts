/**
 * Word-level diff (LCS-based) for showing what AI changed vs the original
 * resume text — a redline/compare view like Google Docs suggest mode or a
 * GitHub PR diff. Operates on word + whitespace tokens so the rendered diff
 * reads naturally instead of character-by-character noise.
 */

export type DiffSegmentType = "equal" | "added" | "removed";

export interface DiffSegment {
  type: DiffSegmentType;
  value: string;
}

/** Split into word tokens AND the whitespace runs between them, keeping both
 *  so the reconstructed text is identical to the input. */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Diff two strings at word granularity. Returns ordered segments where each is
 * unchanged (`equal`), only in `revised` (`added`), or only in `original`
 * (`removed`). Adjacent segments of the same type are merged.
 */
export function diffWords(original: string, revised: string): DiffSegment[] {
  const a = tokenize(original);
  const b = tokenize(revised);
  const n = a.length;
  const m = b.length;

  // LCS length table computed bottom-up.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffSegment[] = [];
  const push = (type: DiffSegmentType, value: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.value += value;
    else out.push({ type, value });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("removed", a[i]);
      i++;
    } else {
      push("added", b[j]);
      j++;
    }
  }
  while (i < n) {
    push("removed", a[i]);
    i++;
  }
  while (j < m) {
    push("added", b[j]);
    j++;
  }
  return out;
}

/** Count words added / removed across a diff (whitespace-only segments ignored). */
export function countChanges(segments: DiffSegment[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const s of segments) {
    const trimmed = s.value.trim();
    const words = trimmed.length ? trimmed.split(/\s+/).length : 0;
    if (s.type === "added") added += words;
    else if (s.type === "removed") removed += words;
  }
  return { added, removed };
}
