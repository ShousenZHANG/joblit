import { Buffer } from "node:buffer";
import { z } from "zod";

const MAX_FIELD_ENTRIES = 200;
const MAX_SERIALIZED_FIELDS_BYTES = 250 * 1024;

const directSensitiveTokens = new Set([
  "password",
  "passcode",
  "pin",
  "otp",
  "verification",
  "cvv",
  "cvc",
  "routing",
  "bsb",
  "iban",
  "swift",
  "ssn",
  "tfn",
  "passport",
]);

const sensitivePhrases = [
  "pass code",
  "security code",
  "card number",
  "bank account",
  "social security",
  "tax file",
  "driver licence",
  "drivers licence",
  "driver license",
  "drivers license",
  "national id",
  "national identifier",
];

const compactSensitiveKeys = [
  /^(?:password|passcode)\d*$/,
  /^(?:pin|otp)(?:code|token)?\d*$/,
  /^verification(?:code|token|answer|passcode|pin|otp)?\d*$/,
  /^securitycode\d*$/,
  /^(?:cvv|cvc)\d*$/,
  /^(?:(?:credit|debit|payment)card|card)(?:number|num|no)\d*$/,
  /^bankaccount(?:number|num|no)?\d*$/,
  /^routing(?:number|num|no)?\d*$/,
  /^(?:bsb|iban|swift)(?:code|number|num|no)?\d*$/,
  /^(?:ssn|socialsecurity(?:number|num|no)?)\d*$/,
  /^(?:tfn|taxfile(?:number|num|no)?)\d*$/,
  /^passport(?:number|num|no)?\d*$/,
  /^drivers?licen[cs]e(?:number|num|no)?\d*$/,
  /^national(?:id|identifier)(?:number|num|no)?\d*$/,
];

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

  const tokens = normalized.split(" ");
  if (tokens.some((token) => directSensitiveTokens.has(token))) return true;

  const padded = ` ${normalized} `;
  if (sensitivePhrases.some((phrase) => padded.includes(` ${phrase} `))) {
    return true;
  }

  const compactCandidates = [...tokens, tokens.join("")];
  return compactCandidates.some((candidate) =>
    compactSensitiveKeys.some((pattern) => pattern.test(candidate)),
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
