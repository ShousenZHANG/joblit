import type { DetectedField } from "./types";

const SENSITIVE_AUTOCOMPLETE_TOKENS = new Set([
  "current-password",
  "new-password",
  "one-time-code",
]);

const SENSITIVE_TEXT_PATTERNS = [
  /\b(?:password|passcode|passphrase|pin|otp|2fa|mfa)\b/,
  /\bone\s+time\s+(?:code|password)\b/,
  /\bverification\b/,
  /\bsecurity\s+(?:code|answer)\b/,
  /\b(?:cvv|cvc)\b/,
  /\bcc\s+(?:number|code)\b/,
  /\bcard\s+number\b/,
  /\b(?:credit|debit)\s+card\b/,
  /\bbank\s+account\b/,
  /\brouting\s+number\b/,
  /\b(?:bsb|iban|swift)\b/,
  /\b(?:ssn|tfn)\b/,
  /\bsocial\s+security\b/,
  /\btax\s+(?:file\s+number|id|identifier)\b/,
  /\bpassport\s+(?:number|no|id|identifier)\b/,
  /\bdriver(?:s|\s+s)?\s+(?:licence|license)\b/,
  /\bnational\s+(?:id|identifier|identification)\b/,
  /\bgovernment\s+(?:id|identifier|identification)\b/,
] as const;

function normalizeText(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasSensitiveText(value: string): boolean {
  const normalized = normalizeText(value);
  return SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function getLabelText(element: HTMLElement): string[] {
  const text: string[] = [];
  const labels = (element as HTMLInputElement).labels;
  if (labels) {
    text.push(...Array.from(labels, (label) => label.textContent ?? ""));
  } else {
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) text.push(wrappingLabel.textContent ?? "");
  }
  return text;
}

function getDescriptionText(element: HTMLElement): string[] {
  const ownerDocument = element.ownerDocument;
  const ids = (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return ids.map((id) => ownerDocument.getElementById(id)?.textContent ?? "");
}

export function isSensitiveField(element: HTMLElement): boolean {
  if (
    element instanceof HTMLInputElement &&
    element.type.toLowerCase() === "password"
  ) {
    return true;
  }

  const autocompleteTokens = (element.getAttribute("autocomplete") ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (
    autocompleteTokens.some(
      (token) =>
        SENSITIVE_AUTOCOMPLETE_TOKENS.has(token) ||
        token.startsWith("cc-") ||
        token.startsWith("transaction-"),
    )
  ) {
    return true;
  }

  const metadata = [
    element.getAttribute("name") ?? "",
    element.id,
    element.getAttribute("placeholder") ?? "",
    element.getAttribute("aria-label") ?? "",
    ...getLabelText(element),
    ...getDescriptionText(element),
  ];
  return metadata.some(hasSensitiveText);
}

export function filterSafeFields(fields: DetectedField[]): DetectedField[] {
  return fields.filter(
    (field) =>
      !isSensitiveField(field.element) && !hasSensitiveText(field.labelText),
  );
}
