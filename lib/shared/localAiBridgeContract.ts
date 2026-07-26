import { z } from "zod";
import {
  LOCAL_AI_BRIDGE_ACTIONS,
  LOCAL_AI_ERROR_CODES,
  LOCAL_AI_BRIDGE_CHANNEL as SHARED_CHANNEL,
  LOCAL_AI_BRIDGE_VERSION as SHARED_VERSION,
  LOCAL_AI_BRIDGE_TTL_MS as SHARED_TTL_MS,
  LOCAL_AI_BRIDGE_CLOCK_SKEW_MS as SHARED_SKEW_MS,
  LOCAL_AI_BRIDGE_MAX_REQUEST_BYTES as SHARED_MAX_REQUEST_BYTES,
  LOCAL_AI_BRIDGE_MAX_RESPONSE_BYTES as SHARED_MAX_RESPONSE_BYTES,
  LOCAL_AI_MAX_MODEL_OUTPUT_CHARS as SHARED_MAX_MODEL_OUTPUT_CHARS,
} from "@/lib/shared/localAiBridgeWire";
import { TailoringRunHandleSchema } from "@/lib/shared/tailoringRunContract";

export const LOCAL_AI_BRIDGE_CHANNEL = SHARED_CHANNEL;
export const LOCAL_AI_BRIDGE_VERSION = SHARED_VERSION;
export const LOCAL_AI_BRIDGE_TTL_MS = SHARED_TTL_MS;
const LOCAL_AI_BRIDGE_FUTURE_SKEW_MS = SHARED_SKEW_MS;
const LOCAL_AI_BRIDGE_MAX_REQUEST_BYTES = SHARED_MAX_REQUEST_BYTES;
export const LOCAL_AI_BRIDGE_MAX_RESPONSE_BYTES = SHARED_MAX_RESPONSE_BYTES;
const LOCAL_AI_MAX_MODEL_OUTPUT_CHARS = SHARED_MAX_MODEL_OUTPUT_CHARS;

export const BridgeActionSchema = z.enum(LOCAL_AI_BRIDGE_ACTIONS);
export type BridgeAction = z.infer<typeof BridgeActionSchema>;

export const LOCAL_AI_MAX_REPAIR_FEEDBACK_CHARS = 1_200;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/;

const uuid = z.string().uuid();
const nonce = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const requestBase = {
  channel: z.literal(LOCAL_AI_BRIDGE_CHANNEL),
  direction: z.literal("web-to-extension"),
  version: z.literal(LOCAL_AI_BRIDGE_VERSION),
  messageId: uuid,
  nonce,
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
};

export const BridgeRequestSchema = z.discriminatedUnion("action", [
  z.object({
    ...requestBase,
    action: z.literal("PING"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...requestBase,
    action: z.literal("GET_STATUS"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...requestBase,
    action: z.literal("START_RUN"),
    payload: z.union([
      z
        .object({
          requestId: uuid,
          jobId: uuid,
          target: z.enum(["resume", "cover", "match"]),
        })
        .strict(),
      z
        .object({
          requestId: uuid,
          jobId: uuid,
          target: z.literal("triage"),
          jobIds: z.array(uuid).min(1).max(15),
        })
        .strict()
        .refine(
          (payload) =>
            payload.jobIds[0] === payload.jobId &&
            new Set(payload.jobIds).size === payload.jobIds.length,
          "jobIds must be unique and start with jobId",
        ),
    ]),
  }).strict(),
  z.object({
    ...requestBase,
    action: z.literal("GET_RUN"),
    payload: z.object({ requestId: uuid }).strict(),
  }).strict(),
  z.object({
    ...requestBase,
    action: z.literal("STOP_RUN"),
    payload: z.object({ requestId: uuid }).strict(),
  }).strict(),
  z.object({
    ...requestBase,
    action: z.literal("REPAIR_RUN"),
    payload: z
      .object({
        requestId: uuid,
        feedback: z
          .string()
          .min(1)
          .max(LOCAL_AI_MAX_REPAIR_FEEDBACK_CHARS)
          .refine((value) => !CONTROL_CHARS_RE.test(value), "control characters are not allowed"),
      })
      .strict(),
  }).strict(),
]);

export type BridgeRequest = z.infer<typeof BridgeRequestSchema>;
export type StartPayload = Extract<BridgeRequest, { action: "START_RUN" }>["payload"];
export type RepairPayload = Extract<BridgeRequest, { action: "REPAIR_RUN" }>["payload"];

export const LocalAiPresenceSchema = z.object({ present: z.literal(true) }).strict();
export type LocalAiPresenceResult = z.infer<typeof LocalAiPresenceSchema>;

export const LocalAiAvailabilitySchema = z
  .object({
    state: z.enum([
      "not_configured",
      "joblit_disconnected",
      "unreachable",
      "auth_failed",
      "incompatible",
      "ready",
    ]),
    joblitConnected: z.boolean(),
    profileName: z.string().min(1).max(64).optional(),
  })
  .strict();
export type LocalAiAvailabilityResult = z.infer<typeof LocalAiAvailabilitySchema>;

const LocalAiPromptMetaSchema = z.record(z.string(), z.unknown());

const LocalAiErrorCodeSchema = z.enum(LOCAL_AI_ERROR_CODES);

export const LocalAiBridgeErrorSchema = z
  .object({
    code: LocalAiErrorCodeSchema,
    message: z.string().min(1).max(240),
    retryable: z.boolean(),
  })
  .strict();
export type LocalAiBridgeErrorPayload = z.infer<typeof LocalAiBridgeErrorSchema>;

const runBase = {
  requestId: uuid,
  jobId: uuid,
  target: z.enum(["resume", "cover", "match", "triage"]),
  tailoringRun: TailoringRunHandleSchema.optional(),
};

export const LocalAiPublicRunSchema = z.discriminatedUnion("status", [
  z.object({ ...runBase, status: z.literal("queued") }).strict(),
  z
    .object({
      ...runBase,
      status: z.literal("running"),
      progressChars: z.number().int().nonnegative().max(LOCAL_AI_MAX_MODEL_OUTPUT_CHARS).optional(),
    })
    .strict(),
  z.object({ ...runBase, status: z.literal("stopping") }).strict(),
  z
    .object({
      ...runBase,
      status: z.literal("succeeded"),
      modelOutput: z.string().min(20).max(LOCAL_AI_MAX_MODEL_OUTPUT_CHARS),
      promptMeta: LocalAiPromptMetaSchema,
    })
    .strict(),
  z
    .object({
      ...runBase,
      status: z.literal("failed"),
      error: LocalAiBridgeErrorSchema,
    })
    .strict(),
  z.object({ ...runBase, status: z.literal("cancelled") }).strict(),
]);
export type LocalAiPublicRun = z.infer<typeof LocalAiPublicRunSchema>;
export type LocalAiSucceededRun = Extract<LocalAiPublicRun, { status: "succeeded" }>;

const responseBase = {
  channel: z.literal(LOCAL_AI_BRIDGE_CHANNEL),
  direction: z.literal("extension-to-web"),
  version: z.literal(LOCAL_AI_BRIDGE_VERSION),
  messageId: uuid,
  nonce,
};

export const BridgeResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ...responseBase,
      ok: z.literal(true),
      data: z.union([
        LocalAiPresenceSchema,
        LocalAiAvailabilitySchema,
        LocalAiPublicRunSchema,
      ]),
    })
    .strict(),
  z
    .object({
      ...responseBase,
      ok: z.literal(false),
      error: LocalAiBridgeErrorSchema,
    })
    .strict(),
]);
export type BridgeResponse = z.infer<typeof BridgeResponseSchema>;

function serializedByteLength(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return null;
  }
}

function hasValidLifetime(
  value: { issuedAt: number; expiresAt: number },
  now: number,
): boolean {
  const ttl = value.expiresAt - value.issuedAt;
  return (
    ttl > 0 &&
    ttl <= LOCAL_AI_BRIDGE_TTL_MS &&
    value.issuedAt >= now - LOCAL_AI_BRIDGE_TTL_MS &&
    value.issuedAt <= now + LOCAL_AI_BRIDGE_FUTURE_SKEW_MS &&
    value.expiresAt > now
  );
}

export function parseBridgeRequest(value: unknown, now = Date.now()): BridgeRequest | null {
  const bytes = serializedByteLength(value);
  if (bytes === null || bytes > LOCAL_AI_BRIDGE_MAX_REQUEST_BYTES) return null;
  const parsed = BridgeRequestSchema.safeParse(value);
  if (!parsed.success || !hasValidLifetime(parsed.data, now)) return null;
  return parsed.data;
}

export function parseBridgeResponse(value: unknown): BridgeResponse | null {
  const bytes = serializedByteLength(value);
  if (bytes === null || bytes > LOCAL_AI_BRIDGE_MAX_RESPONSE_BYTES) return null;
  const parsed = BridgeResponseSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}
