import { z } from "zod";

import {
  type AbuseBudgetDecision,
  type AbuseBudgetPort,
  type NormalizedAbuseBudgetDebit,
  AbuseBudgetUnavailableError,
  normalizeAbuseBudgetDebits,
} from "./abuseBudget";

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface UpstashAbuseBudgetOptions {
  readonly url: string;
  readonly token: string;
  readonly keyPrefix?: string;
  readonly fetchImpl?: FetchImplementation;
}

interface ResolvedUpstashAbuseBudgetOptions {
  readonly url: string;
  readonly token: string;
  readonly keyPrefix: string;
  readonly fetchImpl: FetchImplementation;
}

/*
 * This script has two explicit phases inside one Redis EVAL:
 *   1. read and decide every debit;
 *   2. mutate every debit only when the whole operation is allowed.
 *
 * Redis serializes EVAL, which gives all-or-nothing quota semantics across
 * concurrent serverless isolates without a client-side transaction race.
 */
const ATOMIC_CONSUME_SCRIPT = `
local budgetCount = #KEYS
local redisTime = redis.call("TIME")
local now = (tonumber(redisTime[1]) * 1000) + math.floor(tonumber(redisTime[2]) / 1000)
local counts = {}
local ttls = {}
local nextCounts = {}
local remainings = {}
local resetTimes = {}
local denied = false
local deniedResetAt = 0
local selectedRemaining = nil
local selectedResetAt = 0

for index = 1, budgetCount do
  local argumentOffset = ((index - 1) * 3)
  local budgetLimit = tonumber(ARGV[argumentOffset + 1])
  local windowMs = tonumber(ARGV[argumentOffset + 2])
  local cost = tonumber(ARGV[argumentOffset + 3])
  local rawCount = redis.call("GET", KEYS[index])
  local ttl = redis.call("PTTL", KEYS[index])
  local count = tonumber(rawCount) or 0
  local resetAt

  if ttl < 1 then
    count = 0
    ttl = windowMs
    resetAt = now + windowMs
  else
    resetAt = now + ttl
  end

  local nextCount = count + cost
  local remaining = budgetLimit - nextCount
  counts[index] = count
  ttls[index] = ttl
  nextCounts[index] = nextCount
  remainings[index] = remaining
  resetTimes[index] = resetAt

  if nextCount > budgetLimit then
    denied = true
    if resetAt > deniedResetAt then
      deniedResetAt = resetAt
    end
  end

  if selectedRemaining == nil or remaining < selectedRemaining or
      (remaining == selectedRemaining and resetAt > selectedResetAt) then
    selectedRemaining = remaining
    selectedResetAt = resetAt
  end
end

if denied then
  local retryAfter = math.max(1, math.ceil((deniedResetAt - now) / 1000))
  return {0, 0, deniedResetAt, retryAfter}
end

for index = 1, budgetCount do
  local argumentOffset = ((index - 1) * 3)
  local windowMs = tonumber(ARGV[argumentOffset + 2])
  local cost = tonumber(ARGV[argumentOffset + 3])

  if counts[index] == 0 and redis.call("EXISTS", KEYS[index]) == 0 then
    redis.call("SET", KEYS[index], nextCounts[index], "PX", windowMs)
  elseif redis.call("PTTL", KEYS[index]) < 1 then
    redis.call("SET", KEYS[index], nextCounts[index], "PX", windowMs)
  else
    redis.call("INCRBY", KEYS[index], cost)
  end
end

return {1, selectedRemaining, selectedResetAt, 0}
`.trim();

const RedisIntegerSchema = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value) => Number(value))
  .refine((value) => Number.isSafeInteger(value));

const RedisRestEnvelopeSchema = z
  .object({
    result: z.unknown(),
    error: z.string().optional(),
  })
  .passthrough();

const AbuseBudgetDecisionTupleSchema = z.tuple([
  RedisIntegerSchema,
  RedisIntegerSchema,
  RedisIntegerSchema,
  RedisIntegerSchema,
]);

function unavailable(
  message: string,
  cause?: unknown,
): AbuseBudgetUnavailableError {
  return new AbuseBudgetUnavailableError(message, { cause });
}

function parseDecision(payload: unknown): AbuseBudgetDecision {
  const envelope = RedisRestEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw unavailable("The abuse-budget store returned an invalid response.");
  }
  if (envelope.data.error !== undefined) {
    throw unavailable("The abuse-budget store rejected the atomic operation.");
  }

  const parsedTuple = AbuseBudgetDecisionTupleSchema.safeParse(
    envelope.data.result,
  );
  if (!parsedTuple.success) {
    throw unavailable("The abuse-budget store returned an invalid result.");
  }
  const [allowed, remaining, resetAt, retryAfter] = parsedTuple.data;

  if (
    (allowed !== 0 && allowed !== 1) ||
    remaining < 0 ||
    resetAt < 0 ||
    retryAfter < 0 ||
    (allowed === 1 && retryAfter !== 0) ||
    (allowed === 0 && remaining !== 0)
  ) {
    throw unavailable("The abuse-budget store returned an invalid result.");
  }

  return {
    allowed: allowed === 1,
    remaining,
    resetAt,
    retryAfter,
  };
}

function resolveOptions(
  options: UpstashAbuseBudgetOptions,
): ResolvedUpstashAbuseBudgetOptions {
  const url = options.url.replace(/\/+$/, "");
  const token = options.token.trim();
  if (url.length === 0) {
    throw new RangeError("An abuse-budget REST URL is required.");
  }
  if (token.length === 0) {
    throw new RangeError("An abuse-budget REST token is required.");
  }
  return {
    url,
    token,
    keyPrefix: options.keyPrefix ?? "joblit:abuse:v1:",
    fetchImpl: options.fetchImpl ?? fetch,
  };
}

function buildAtomicCommand(
  debits: readonly NormalizedAbuseBudgetDebit[],
  keyPrefix: string,
): readonly string[] {
  return [
    "EVAL",
    ATOMIC_CONSUME_SCRIPT,
    String(debits.length),
    ...debits.map((debit) => `${keyPrefix}${debit.key}`),
    ...debits.flatMap((debit) => [
      String(debit.limit),
      String(debit.windowMs),
      String(debit.cost),
    ]),
  ];
}

async function sendAtomicCommand(
  options: ResolvedUpstashAbuseBudgetOptions,
  command: readonly string[],
): Promise<unknown> {
  let response: Response;
  try {
    response = await options.fetchImpl(options.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
    });
  } catch (error) {
    throw unavailable("The abuse-budget store is unreachable.", error);
  }
  if (!response.ok) {
    throw unavailable(
      `The abuse-budget store returned HTTP ${response.status}.`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw unavailable(
      "The abuse-budget store returned unreadable JSON.",
      error,
    );
  }
}

async function consumeUpstashBudget(
  options: ResolvedUpstashAbuseBudgetOptions,
  debits: Parameters<AbuseBudgetPort["consume"]>[0],
): Promise<AbuseBudgetDecision> {
  const normalized = normalizeAbuseBudgetDebits(debits);
  const command = buildAtomicCommand(normalized, options.keyPrefix);
  return parseDecision(await sendAtomicCommand(options, command));
}

/**
 * Upstash-compatible Redis REST adapter with no runtime package dependency.
 */
export function createUpstashAbuseBudgetPort(
  options: UpstashAbuseBudgetOptions,
): AbuseBudgetPort {
  const resolved = resolveOptions(options);
  return {
    consume: (debits) => consumeUpstashBudget(resolved, debits),
  };
}
