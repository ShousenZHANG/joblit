import type { DetectedField } from "./types";

const SENSITIVE_AUTOCOMPLETE_TOKENS = new Set([
  "current-password",
  "new-password",
  "one-time-code",
]);

interface SensitiveFamilyRule {
  /** The first capture is the semantic suffix following the sensitive family. */
  pattern: RegExp;
  safeMetadataSuffixes?: readonly RegExp[];
}

const COMMON_SAFE_METADATA_SUFFIXES = [/^status\d*$/] as const;
const SWIFT_PROGRAMMING_SUFFIXES = [
  /^(?:employment|coding)?experience\d*$/,
  /^coder\d*$/,
  /^skills?\d*$/,
  /^(?:developer|development|programming|language|ui)\d*$/,
] as const;

/**
 * Keep this semantic denylist aligned with the server-side submission schema.
 * High-confidence families may have an arbitrary technical prefix; only an
 * explicitly recognised metadata suffix is safe.
 */
const SENSITIVE_FAMILY_RULES: readonly SensitiveFamilyRule[] = [
  { pattern: /(?:password|passcode)(?:confirmation|confirm)?([a-z0-9]*)$/ },
  { pattern: /onetime(?:code|password)([a-z0-9]*)$/ },
  {
    pattern:
      /verification(?:code|token|answer|passcode|pin|otp)([a-z0-9]*)$/,
  },
  { pattern: /security(?:code|answer)([a-z0-9]*)$/ },
  {
    pattern:
      /(?:(?:credit|debit|payment)card(?:number|num|no)?|card(?:number|num|no)|cc(?:number|num|no))([a-z0-9]*)$/,
  },
  { pattern: /bankaccount([a-z0-9]*)$/ },
  {
    pattern: /routing(?:number|num|no|code)?([a-z0-9]*)$/,
    safeMetadataSuffixes: [/^preference\d*$/],
  },
  { pattern: /socialsecurity([a-z0-9]*)$/ },
  {
    pattern:
      /(?:taxfile|tax(?:number|num|no|id|identifier))([a-z0-9]*)$/,
  },
  {
    pattern: /passport([a-z0-9]*)$/,
    safeMetadataSuffixes: [/^(?:issuingcountry|numbering)\d*$/],
  },
  { pattern: /drivers?licen[cs]e([a-z0-9]*)$/ },
  {
    pattern:
      /(?:national|government)(?:id|identifier|identification)([a-z0-9]*)$/,
  },
  {
    pattern: /swift([a-z0-9]*)$/,
    safeMetadataSuffixes: SWIFT_PROGRAMMING_SUFFIXES,
  },
];

const STRUCTURED_SENSITIVE_SUFFIXES = [
  /(?:pin|2fa|mfa|otp)(?:code|token|2)?\d*(?:value|field|input)?\d*$/,
  /(?:cvv|cvc)(?:code|number|num|no|2)?\d*(?:value|field|input)?\d*$/,
  /(?:bsb|iban)(?:code|number|num|no)?\d*(?:value|field|input)?\d*$/,
  /(?:ssn|tfn)(?:number|num|no|id|identifier)?\d*(?:value|field|input)?\d*$/,
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

const SENSITIVE_LOCALIZED_PATTERNS = [
  /(?:密码|密碼|口令|通行码|通行碼)/,
  /(?:验证码|驗證碼|动态码|動態碼|安全码|安全碼)/,
  /(?:信用卡|借记卡|借記卡|银行卡|銀行卡|支付卡|卡号|卡號)/,
  /(?:银行|銀行)(?:账户|帳戶|账号|賬號)/,
  /(?:身份证|身份證|护照|護照|税号|稅號|社保号|社保號|驾驶证|駕駛證)/,
] as const;

function normalizeText(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasSensitiveText(value: string): boolean {
  const unicodeNormalized = value.normalize("NFKC").toLowerCase();
  if (
    SENSITIVE_LOCALIZED_PATTERNS.some((pattern) =>
      pattern.test(unicodeNormalized),
    )
  ) {
    return true;
  }

  const normalized = normalizeText(unicodeNormalized);
  if (!normalized) return false;

  const compact = normalized.replaceAll(" ", "");
  const postalCandidate = compact
    .replace(/\d+$/, "")
    .replace(/(?:value|field|input)$/, "")
    .replace(/\d+$/, "");
  const isPostalPinCode =
    /(?:postal|address)pincode$/.test(postalCandidate) &&
    !/(?:verification|security|password|passcode|otp|2fa|mfa)/.test(compact);
  if (isPostalPinCode) return false;

  for (const rule of SENSITIVE_FAMILY_RULES) {
    const match = rule.pattern.exec(compact);
    if (!match) continue;

    const semanticSuffix = match[1];
    const isSafeMetadata = [
      ...COMMON_SAFE_METADATA_SUFFIXES,
      ...(rule.safeMetadataSuffixes ?? []),
    ].some((pattern) => pattern.test(semanticSuffix));

    return !isSafeMetadata;
  }

  if (STRUCTURED_SENSITIVE_SUFFIXES.some((pattern) => pattern.test(compact))) {
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

function getReferencedText(
  element: HTMLElement,
  attribute: "aria-describedby" | "aria-labelledby",
): string[] {
  const ownerDocument = element.ownerDocument;
  const root = element.getRootNode() as Node & {
    getElementById?: (id: string) => Element | null;
  };
  const ids = (element.getAttribute(attribute) ?? "")
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
    ...getReferencedText(element, "aria-labelledby"),
    ...getReferencedText(element, "aria-describedby"),
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
