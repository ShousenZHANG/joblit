import { Buffer } from "node:buffer";
import { z } from "zod";

const MAX_FIELD_ENTRIES = 200;
const MAX_SERIALIZED_FIELDS_BYTES = 250 * 1024;

interface SensitiveFamilyRule {
  /** The first capture is the semantic suffix following the sensitive family. */
  pattern: RegExp;
  safeMetadataSuffixes?: readonly RegExp[];
}

const commonSafeMetadataSuffixes = [/status\d*$/] as const;

/**
 * High-confidence semantic families may have an arbitrary technical prefix.
 * Once present, only an explicit metadata suffix is safe; value-like or unknown
 * suffixes remain blocked. Matching the compact form makes casing and separators
 * irrelevant without relying on broad short-token substring checks.
 */
const sensitiveFamilyRules: readonly SensitiveFamilyRule[] = [
  { pattern: /(?:password|passcode)(?:confirmation|confirm)?([a-z0-9]*)$/ },
  {
    pattern:
      /verification(?:code|token|answer|passcode|pin|otp)([a-z0-9]*)$/,
  },
  { pattern: /security(?:code|answer)([a-z0-9]*)$/ },
  {
    pattern:
      /(?:(?:credit|debit|payment)card|card)(?:number|num|no)([a-z0-9]*)$/,
  },
  { pattern: /bankaccount([a-z0-9]*)$/ },
  {
    pattern: /routing([a-z0-9]*)$/,
    safeMetadataSuffixes: [/preference\d*$/],
  },
  { pattern: /socialsecurity([a-z0-9]*)$/ },
  {
    pattern:
      /(?:taxfile|tax(?:number|num|no|id|identifier))([a-z0-9]*)$/,
  },
  {
    pattern: /passport([a-z0-9]*)$/,
    safeMetadataSuffixes: [/(?:issuingcountry|numbering)\d*$/],
  },
  { pattern: /drivers?licen[cs]e([a-z0-9]*)$/ },
  {
    pattern: /(?:national|government)(?:id|identifier)([a-z0-9]*)$/,
  },
  {
    pattern: /swift([a-z0-9]*)$/,
    safeMetadataSuffixes: [/(?:employment)?experience\d*$/, /coder\d*$/],
  },
];

/**
 * Short acronyms need a recognised sensitive shape so harmless compounds such
 * as `shipping` and `cvVersion` are not rejected by substring coincidence.
 */
const structuredSensitiveSuffixes = [
  /(?:pin|otp)(?:code|token)?\d*(?:value|field|input)?\d*$/,
  /(?:cvv|cvc)(?:code|number|num|no)?\d*(?:value|field|input)?\d*$/,
  /(?:bsb|iban)(?:code|number|num|no)?\d*(?:value|field|input)?\d*$/,
  /(?:ssn|tfn)(?:number|num|no|id|identifier)?\d*(?:value|field|input)?\d*$/,
] as const;

function normalizeFieldKey(key: string): string {
  return key
    .normalize("NFKC")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/['’]s\b/gi, "s")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isSensitiveFieldKey(key: string): boolean {
  const normalized = normalizeFieldKey(key);
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

  for (const rule of sensitiveFamilyRules) {
    const match = rule.pattern.exec(compact);
    if (!match) continue;

    const semanticSuffix = match[1];
    const isSafeMetadata = [
      ...commonSafeMetadataSuffixes,
      ...(rule.safeMetadataSuffixes ?? []),
    ].some((pattern) => pattern.test(semanticSuffix));

    return !isSafeMetadata;
  }

  return structuredSensitiveSuffixes.some((pattern) =>
    pattern.test(compact),
  );
}

const fieldValuesSchema = z.record(
  z.string().max(200),
  z.string().max(10_000),
);

const fieldMappingsSchema = z.record(
  z.string().max(200),
  z.object({
    source: z.string().max(50),
    profilePath: z.string().max(200).optional(),
    confidence: z.number().min(0).max(1),
  }).strict(),
);

export const CreateSubmissionSchema = z
  .object({
    pageUrl: z.string().url().max(2_000),
    pageDomain: z.string().min(1).max(200),
    atsProvider: z.string().max(50).optional(),
    formSignature: z.string().min(1).max(128),
    fieldValues: fieldValuesSchema,
    fieldMappings: fieldMappingsSchema,
    jobId: z.string().uuid().optional(),
  })
  .superRefine((payload, ctx) => {
    if (Object.keys(payload.fieldValues).length > MAX_FIELD_ENTRIES) {
      ctx.addIssue({
        code: "custom",
        path: ["fieldValues"],
        message: `fieldValues must contain at most ${MAX_FIELD_ENTRIES} entries`,
      });
    }

    if (Object.keys(payload.fieldMappings).length > MAX_FIELD_ENTRIES) {
      ctx.addIssue({
        code: "custom",
        path: ["fieldMappings"],
        message: `fieldMappings must contain at most ${MAX_FIELD_ENTRIES} entries`,
      });
    }

    for (const key of Object.keys(payload.fieldValues)) {
      if (isSensitiveFieldKey(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["fieldValues", key],
          message: "Sensitive fields cannot be submitted",
        });
      }
    }

    for (const key of Object.keys(payload.fieldMappings)) {
      if (isSensitiveFieldKey(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["fieldMappings", key],
          message: "Sensitive fields cannot be submitted",
        });
      }
    }

    const serializedFieldsBytes =
      Buffer.byteLength(JSON.stringify(payload.fieldValues), "utf8") +
      Buffer.byteLength(JSON.stringify(payload.fieldMappings), "utf8");

    if (serializedFieldsBytes > MAX_SERIALIZED_FIELDS_BYTES) {
      ctx.addIssue({
        code: "custom",
        path: ["fieldValues"],
        message: "Serialized field data must not exceed 250 KiB",
      });
    }
  });
