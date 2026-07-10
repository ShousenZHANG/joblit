import type { DetectedField } from "./types";

const SENSITIVE_AUTOCOMPLETE_TOKENS = new Set([
  "current-password",
  "new-password",
  "one-time-code",
]);

const SENSITIVE_COMPACT_PATTERNS = [
  // Credentials and verification
  /^(?:current|new|confirm)password$/,
  /^onetime(?:code|password)$/,
  /^security(?:code|answer)$/,
  /^verification(?:code|token|answer|passcode|pin|otp)$/,
  /^(?:2fa|mfa|otp)(?:code|token|2)?$/,
  // Payment cards
  /^(?:(?:credit|debit)?card|cc)(?:number|num|no)$/,
  /^(?:credit|debit)card$/,
  /^(?:credit|debit)?card(?:security|verification)(?:code|number|num|no|2)$/,
  /^(?:cvv|cvc)(?:code|number|num|no|2)?$/,
  // Banking
  /^bankaccount(?:number|num|no)?$/,
  /^(?:bank)?routing(?:number|num|no|code)$/,
  /^(?:bsb|iban|swift)(?:number|num|no|code)?$/,
  // Government identifiers
  /^passport(?:number|num|no|id|identifier|code)$/,
  /^tax(?:file)?(?:number|num|no|id|identifier)$/,
  /^(?:national|government)(?:id|identifier|identification)(?:number|num|no)?$/,
  /^socialsecurity(?:number|num|no|id|identifier)$/,
  /^(?:ssn|tfn)(?:number|num|no)?$/,
  /^(?:driver|drivers|driving)(?:licence|license)(?:number|num|no|id|identifier)?$/,
] as const;

const SENSITIVE_TEXT_PATTERNS = [
  /\b(?:password|passcode|passphrase|pin|otp|2fa|mfa)\b/,
  /\bone\s+time\s+(?:code|password)\b/,
  /^verification$/,
  /\bverification\s+(?:security\s+)?(?:code|token|answer|passcode|pin|otp)\b/,
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
  if (!normalized) return false;

  const tokens = normalized.split(/\s+/);
  const compactCandidates = [...tokens, tokens.join("")];
  if (
    compactCandidates.some((candidate) =>
      SENSITIVE_COMPACT_PATTERNS.some((pattern) => pattern.test(candidate)),
    )
  ) {
    return true;
  }

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
  const root = element.getRootNode() as Node & {
    getElementById?: (id: string) => Element | null;
  };
  const ids = (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return ids.map((id) => {
    const rootMatch = root.getElementById?.(id) ?? null;
    return (rootMatch ?? ownerDocument.getElementById(id))?.textContent ?? "";
  });
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
      !isSensitiveField(field.element) &&
      ![
        field.inputType,
        field.name,
        field.id,
        field.placeholder,
        field.labelText,
      ].some(hasSensitiveText),
  );
}
