import { FieldCategory, LABEL_PATTERNS } from "@ext/shared/fieldTaxonomy";
import type { DetectedField } from "@ext/shared/types";

/** Signal weights for multi-signal field classification. */
const WEIGHTS = {
  nameId: 0.3,
  label: 0.35,
  placeholder: 0.15,
  aria: 0.1,
  adjacentText: 0.1,
} as const;

/** Normalize text for matching: trim, collapse whitespace, lowercase. */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Escape a string for use in a CSS selector. */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/([^\w-])/g, "\\$1");
}

/** Find the <label> text for a given input element. */
export function findLabelText(el: HTMLElement): string {
  // 1. Explicit <label for="id">
  if (el.id) {
    const label = el.ownerDocument.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (label?.textContent) return normalizeText(label.textContent);
  }

  // 2. Wrapping <label>
  const parentLabel = el.closest("label");
  if (parentLabel?.textContent) {
    return normalizeText(parentLabel.textContent);
  }

  // 3. aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return normalizeText(ariaLabel);

  // 4. aria-describedby
  const describedBy = el.getAttribute("aria-describedby");
  if (describedBy) {
    const descEl = el.ownerDocument.getElementById(describedBy);
    if (descEl?.textContent) return normalizeText(descEl.textContent);
  }

  return "";
}

/** Find adjacent text nodes (previous sibling or parent's direct text). */
export function findAdjacentText(el: HTMLElement): string {
  // Previous sibling text
  const prev = el.previousElementSibling;
  if (prev?.textContent && prev.tagName !== "INPUT") {
    return normalizeText(prev.textContent);
  }

  // Parent's direct text (excluding child element text)
  const parent = el.parentElement;
  if (parent) {
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        return normalizeText(node.textContent);
      }
    }
  }

  return "";
}

/** Score how well a text matches a FieldCategory's patterns. Returns 0-1. */
export function matchScore(text: string, category: FieldCategory): number {
  const patterns = LABEL_PATTERNS[category];
  if (!patterns.length || !text) return 0;
  return patterns.some((p) => p.test(text)) ? 1.0 : 0;
}

/** Classify a single form element into a FieldCategory with confidence. */
export function classifyField(el: HTMLElement): Pick<DetectedField, "category" | "confidence" | "labelText"> {
  const nameAttr = el.getAttribute("name") ?? "";
  const idAttr = el.id ?? "";
  const placeholder = (el as HTMLInputElement).placeholder ?? "";
  const ariaLabel = el.getAttribute("aria-label") ?? "";
  const labelText = findLabelText(el);
  const adjacentText = findAdjacentText(el);

  let bestCategory = FieldCategory.UNKNOWN;
  let bestScore = 0;

  for (const category of Object.values(FieldCategory)) {
    if (category === FieldCategory.UNKNOWN) continue;

    const nameIdScore = Math.max(matchScore(nameAttr, category), matchScore(idAttr, category));
    const labelScore = matchScore(labelText, category);
    const placeholderScore = matchScore(placeholder, category);
    const ariaScore = matchScore(ariaLabel, category);
    const adjScore = matchScore(adjacentText, category);

    const weighted =
      nameIdScore * WEIGHTS.nameId +
      labelScore * WEIGHTS.label +
      placeholderScore * WEIGHTS.placeholder +
      ariaScore * WEIGHTS.aria +
      adjScore * WEIGHTS.adjacentText;

    if (weighted > bestScore) {
      bestScore = weighted;
      bestCategory = category;
    }
  }

  return {
    category: bestCategory,
    confidence: bestScore,
    labelText: labelText || placeholder || nameAttr || idAttr,
  };
}

/** Build a unique CSS selector for an element. */
export function buildSelector(el: HTMLElement): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const name = el.getAttribute("name");
  if (name) return `[name="${cssEscape(name)}"]`;
  // Fallback: tag + nth-of-type
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    const idx = siblings.indexOf(el) + 1;
    return `${tag}:nth-of-type(${idx})`;
  }
  return tag;
}

/** Get the input type of an element. */
export function getInputType(el: HTMLElement): string {
  if (el.tagName === "SELECT") return "select";
  if (el.tagName === "TEXTAREA") return "textarea";
  if (el.getAttribute("contenteditable") === "true") return "contenteditable";
  return (el as HTMLInputElement).type ?? "text";
}
