export const EXTENSION_ROUTE_OPERATIONS = Object.freeze([
  "tokens.list",
  "tokens.create",
  "tokens.revoke",
  "profile.read",
  "profile.flat.read",
  "fieldMappings.list",
  "fieldMappings.upsert",
  "jobs.match",
  "jobs.markApplied",
  "jobs.import",
  "submissions.list",
  "submissions.create",
  "applications.prompt",
  "jobs.triagePrompt",
  "localAiSettings.read",
  "localAiSettings.write",
] as const);

export type ExtensionRouteOperation =
  (typeof EXTENSION_ROUTE_OPERATIONS)[number];

export type ExtensionRouteAuth = "session" | "bearer";

export type ExtensionAbuseBudget = Readonly<{
  limit: number;
  windowSeconds: number;
}>;

export type ExtensionRoutePolicy = Readonly<{
  auth: ExtensionRouteAuth;
  /**
   * Stable namespace for both abuse-budget keys and route observability.
   * The ingress adapter adds the IP or user identity to this namespace.
   */
  scope: string;
  /**
   * Cheap anonymous protection. This must run before session or bearer-token
   * lookup so invalid credentials cannot amplify auth-store work.
   */
  preAuthIpBudget: ExtensionAbuseBudget;
  /** Account-level protection applied only after authentication succeeds. */
  postAuthUserBudget: ExtensionAbuseBudget;
}>;

const WINDOW_SECONDS = 60;

function budget(limit: number): ExtensionAbuseBudget {
  return Object.freeze({ limit, windowSeconds: WINDOW_SECONDS });
}

function policy(
  auth: ExtensionRouteAuth,
  scope: string,
  preAuthIpLimit: number,
  postAuthUserLimit = preAuthIpLimit,
): ExtensionRoutePolicy {
  return Object.freeze({
    auth,
    scope,
    preAuthIpBudget: budget(preAuthIpLimit),
    postAuthUserBudget: budget(postAuthUserLimit),
  });
}

/**
 * The single source of truth for extension-route ingress policy.
 *
 * Route modules select an operation; they do not supply authentication modes
 * or numeric budgets. `satisfies` makes additions to ExtensionRouteOperation a
 * compile-time error until a policy is deliberately assigned.
 */
const EXTENSION_ROUTE_POLICY_REGISTRY = Object.freeze({
  "tokens.list": policy("session", "ext:token:list", 30),
  "tokens.create": policy("session", "ext:token:create", 10),
  "tokens.revoke": policy("session", "ext:token:revoke", 20),
  "profile.read": policy("bearer", "ext:profile", 30),
  "profile.flat.read": policy("bearer", "ext:profile:flat", 60),
  "fieldMappings.list": policy("bearer", "ext:map:get", 60),
  "fieldMappings.upsert": policy("bearer", "ext:map:put", 30),
  "jobs.match": policy("bearer", "ext:jobs:match", 60),
  "jobs.markApplied": policy("bearer", "ext:jobs:applied", 20),
  "jobs.import": policy("bearer", "ext:jobs:import", 30),
  "submissions.list": policy("bearer", "ext:sub:get", 60),
  "submissions.create": policy("bearer", "ext:sub:post", 30),
  "applications.prompt": policy(
    "bearer",
    "ext:applications:prompt",
    80,
    20,
  ),
  "jobs.triagePrompt": policy(
    "bearer",
    "ext:jobs:triage-prompt",
    80,
    20,
  ),
  "localAiSettings.read": policy(
    "bearer",
    "ext:local-ai:settings:get",
    120,
    60,
  ),
  "localAiSettings.write": policy(
    "bearer",
    "ext:local-ai:settings:put",
    120,
    30,
  ),
}) satisfies Readonly<
  Record<ExtensionRouteOperation, ExtensionRoutePolicy>
>;

export function getExtensionRoutePolicy(
  operation: ExtensionRouteOperation,
): ExtensionRoutePolicy {
  return EXTENSION_ROUTE_POLICY_REGISTRY[operation];
}
