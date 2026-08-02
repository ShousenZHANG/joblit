import { z } from "zod";
import rawManifest from "./fetchPolicy.config.json";

export const AU_RECALL_SAFE_V1_POLICY_ID = "au-recall-safe-v1" as const;
export const AU_RECALL_SAFE_V2_POLICY_ID = "au-recall-safe-v2" as const;
const IMMUTABLE_POLICY_CEILINGS: Readonly<Record<string, "mid" | "senior">> = {
  [AU_RECALL_SAFE_V1_POLICY_ID]: "mid",
  [AU_RECALL_SAFE_V2_POLICY_ID]: "senior",
};

/**
 * Immutable AU fetch policies.
 *
 * A persisted policy id is an execution contract: never change the meaning of
 * an existing entry. Add a new registry entry and advance the active id when a
 * rule changes so queued runs and audit records remain reproducible.
 *
 * The literal schema is deliberately strict. It keeps the public TypeScript
 * contract narrow while the JSON manifest remains the single runtime value
 * read by both the web application and the Python worker.
 */
const AuFetchPolicySnapshotSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    seniorityCeiling: z.enum(["mid", "senior"]),
    seniorityEvidence: z.literal("visible-title-only"),
    citizenshipOrPr: z.literal("exclude-explicit-required"),
    governmentSecurityClearance: z.literal(
      "exclude-required-or-explicitly-eligible-to-obtain",
    ),
    experienceYears: z.literal("never-exclude"),
  })
  .strict()
  .superRefine((policy, context) => {
    const expectedCeiling = IMMUTABLE_POLICY_CEILINGS[policy.id];
    if (expectedCeiling && policy.seniorityCeiling !== expectedCeiling) {
      context.addIssue({
        code: "custom",
        message: `${policy.id} must retain its ${expectedCeiling}-level ceiling`,
        path: ["seniorityCeiling"],
      });
    }
  });

const AuFetchPolicyManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    activePolicyId: z.string().trim().min(1).max(80),
    policies: z.record(
      z.string().trim().min(1).max(80),
      AuFetchPolicySnapshotSchema,
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (!(value.activePolicyId in value.policies)) {
      context.addIssue({
        code: "custom",
        message: "activePolicyId must name a registered policy",
        path: ["activePolicyId"],
      });
    }
    for (const [policyId, policy] of Object.entries(value.policies)) {
      if (policy.id !== policyId) {
        context.addIssue({
          code: "custom",
          message: "policy registry key must match policy.id",
          path: ["policies", policyId, "id"],
        });
      }
    }
  });

type AuFetchPolicy = Readonly<
  z.infer<typeof AuFetchPolicySnapshotSchema>
>;
type AuFetchPolicyRegistry = Readonly<Record<string, AuFetchPolicy>>;
type AuFetchPolicyManifest = Readonly<
  Omit<z.infer<typeof AuFetchPolicyManifestSchema>, "policies"> & {
    policies: AuFetchPolicyRegistry;
  }
>;

export function parseAuFetchPolicyManifest(
  value: unknown,
): AuFetchPolicyManifest {
  return AuFetchPolicyManifestSchema.parse(value);
}

const parsedManifest = parseAuFetchPolicyManifest(rawManifest);
const frozenRegistry = Object.freeze(
  Object.fromEntries(
    Object.entries(parsedManifest.policies).map(([policyId, policy]) => [
      policyId,
      Object.freeze(policy),
    ]),
  ),
) as AuFetchPolicyRegistry;

export const AU_FETCH_POLICY_MANIFEST: AuFetchPolicyManifest = Object.freeze({
  ...parsedManifest,
  policies: frozenRegistry,
});

export const ACTIVE_AU_FETCH_POLICY_ID =
  AU_FETCH_POLICY_MANIFEST.activePolicyId;

export const AU_FETCH_POLICY_REGISTRY = AU_FETCH_POLICY_MANIFEST.policies;

const recallSafeV1Policy =
  AU_FETCH_POLICY_REGISTRY[AU_RECALL_SAFE_V1_POLICY_ID];
if (!recallSafeV1Policy) {
  throw new Error("AU recall-safe v1 policy is not registered");
}
const recallSafeV2Policy =
  AU_FETCH_POLICY_REGISTRY[AU_RECALL_SAFE_V2_POLICY_ID];
if (!recallSafeV2Policy) {
  throw new Error("AU recall-safe v2 policy is not registered");
}

const POLICY_SNAPSHOT_FIELDS = [
  "id",
  "seniorityCeiling",
  "seniorityEvidence",
  "citizenshipOrPr",
  "governmentSecurityClearance",
  "experienceYears",
] as const satisfies readonly (keyof AuFetchPolicy)[];

function snapshotMatches(
  actual: AuFetchPolicy,
  registered: AuFetchPolicy,
): boolean {
  return POLICY_SNAPSHOT_FIELDS.every(
    (field) => actual[field] === registered[field],
  );
}

/**
 * Resolve a persisted policy by its own id, never by the mutable active
 * pointer. The complete snapshot must equal the append-only registry entry so
 * a queued run cannot silently acquire newer semantics.
 */
export function parseRegisteredAuFetchPolicy(
  value: unknown,
  registry: AuFetchPolicyRegistry = AU_FETCH_POLICY_REGISTRY,
): AuFetchPolicy {
  const parsed = AuFetchPolicySnapshotSchema.parse(value);
  const registered = registry[parsed.id];
  if (!registered) {
    throw new Error(`AU fetch policy is not registered: ${parsed.id}`);
  }
  if (!snapshotMatches(parsed, registered)) {
    throw new Error(
      `AU fetch policy snapshot does not match registry: ${parsed.id}`,
    );
  }
  return parsed;
}

export const RegisteredAuFetchPolicySchema =
  AuFetchPolicySnapshotSchema.superRefine((policy, context) => {
    const registered = AU_FETCH_POLICY_REGISTRY[policy.id];
    if (!registered) {
      context.addIssue({
        code: "custom",
        message: `AU fetch policy is not registered: ${policy.id}`,
        path: ["id"],
      });
      return;
    }
    if (!snapshotMatches(policy, registered)) {
      context.addIssue({
        code: "custom",
        message: `AU fetch policy snapshot does not match registry: ${policy.id}`,
      });
    }
  });

const activePolicy = AU_FETCH_POLICY_REGISTRY[ACTIVE_AU_FETCH_POLICY_ID];
if (!activePolicy) {
  throw new Error("Active AU fetch policy is not registered");
}
export const AU_FETCH_POLICY = activePolicy;
