import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/server/api/appError";
import {
  createRequestId,
  errorJson,
  unauthorizedError,
} from "@/lib/server/api/errorResponse";
import {
  ExtensionTokenError,
  requireExtensionToken,
} from "@/lib/server/auth/requireExtensionToken";
import {
  requireSession,
  UnauthorizedError,
} from "@/lib/server/auth/requireSession";
import {
  reportError,
} from "@/lib/server/observability/errorReporter";
import {
  getRuntimeCapabilities,
  RuntimeCapabilityConfigurationError,
} from "@/lib/server/runtimeCapabilities";
import {
  AbuseBudgetUnavailableError,
  type AbuseBudgetDecision,
  type AbuseBudgetPort,
} from "./abuseBudget";
import { createMemoryAbuseBudgetPort } from "./abuseBudgetMemory";
import { createUpstashAbuseBudgetPort } from "./abuseBudgetUpstash";
import {
  getExtensionRoutePolicy,
  type ExtensionRouteOperation,
  type ExtensionRoutePolicy,
} from "./extensionRoutePolicy";

const NO_STORE = "private, no-store, max-age=0";
const INTERNAL_ERROR_MESSAGE = "An unexpected error occurred.";

export type ExtensionRouteContext = {
  userId: string;
  requestId: string;
};

export type ExtensionRouteHandler = (
  context: ExtensionRouteContext,
) => Promise<NextResponse>;

type IdentityKind = "ip" | "user";
type ReportError = typeof reportError;

export type ExtensionRouteIngressDependencies = {
  createRequestId: () => string;
  requireSession: typeof requireSession;
  requireExtensionToken: typeof requireExtensionToken;
  primaryBudget: AbuseBudgetPort;
  fallbackBudget: AbuseBudgetPort;
  fingerprintIdentity: (kind: IdentityKind, value: string) => string;
  reportError: ReportError;
};

export type ExtensionRouteIngress = (
  request: Request,
  operation: ExtensionRouteOperation,
  handler: ExtensionRouteHandler,
) => Promise<NextResponse>;

type RateMetadata = {
  decision: AbuseBudgetDecision;
  limit: number;
};

type AuthenticationResult =
  | { kind: "authenticated"; userId: string }
  | { kind: "unauthorized" };

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",", 1)[0]?.trim();
  const candidate =
    firstForwarded ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  return candidate.slice(0, 256);
}

function rateHeaders(metadata: RateMetadata): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(metadata.limit),
    "X-RateLimit-Remaining": String(
      Math.max(0, metadata.decision.remaining),
    ),
    "X-RateLimit-Reset": String(
      Math.ceil(metadata.decision.resetAt / 1_000),
    ),
    ...(metadata.decision.allowed
      ? {}
      : { "Retry-After": String(Math.max(1, metadata.decision.retryAfter)) }),
  };
}

function finalizeResponse(
  response: NextResponse,
  requestId: string,
  rate?: RateMetadata,
): NextResponse {
  response.headers.set("Cache-Control", NO_STORE);
  response.headers.set("X-Request-ID", requestId);
  if (rate) {
    for (const [name, value] of Object.entries(rateHeaders(rate))) {
      response.headers.set(name, value);
    }
  }
  return response;
}

function rateLimitedResponse(
  requestId: string,
  rate: RateMetadata,
): NextResponse {
  return finalizeResponse(
    errorJson("RATE_LIMITED", "Too many requests", 429, {
      requestId,
    }),
    requestId,
    rate,
  );
}

function budgetKey(
  policy: ExtensionRoutePolicy,
  phase: "ip" | "user",
  fingerprint: string,
): string {
  return `${policy.scope}:${phase}:${fingerprint}`;
}

async function consumeBudget(
  dependencies: ExtensionRouteIngressDependencies,
  input: {
    operation: ExtensionRouteOperation;
    requestId: string;
    phase: "pre-auth" | "post-auth";
    key: string;
    limit: number;
    windowSeconds: number;
  },
): Promise<AbuseBudgetDecision> {
  const debits = [
    {
      key: input.key,
      limit: input.limit,
      windowMs: input.windowSeconds * 1_000,
    },
  ] as const;
  try {
    return await dependencies.primaryBudget.consume(debits);
  } catch (error) {
    if (!(error instanceof AbuseBudgetUnavailableError)) throw error;
    dependencies.reportError(error, {
      scope: "extension.ingress.abuse-budget",
      requestId: input.requestId,
      tags: {
        operation: input.operation,
        phase: input.phase,
      },
    });
    return dependencies.fallbackBudget.consume(debits);
  }
}

async function authenticate(
  request: Request,
  policy: ExtensionRoutePolicy,
  dependencies: ExtensionRouteIngressDependencies,
): Promise<{ userId: string }> {
  return policy.auth === "session"
    ? dependencies.requireSession()
    : dependencies.requireExtensionToken(request);
}

async function authenticateForIngress(
  request: Request,
  policy: ExtensionRoutePolicy,
  dependencies: ExtensionRouteIngressDependencies,
): Promise<AuthenticationResult> {
  try {
    const authentication = await authenticate(request, policy, dependencies);
    return { kind: "authenticated", userId: authentication.userId };
  } catch (error) {
    if (
      error instanceof UnauthorizedError ||
      error instanceof ExtensionTokenError
    ) {
      return { kind: "unauthorized" };
    }
    throw error;
  }
}

async function consumeIpBudget(
  request: Request,
  operation: ExtensionRouteOperation,
  policy: ExtensionRoutePolicy,
  requestId: string,
  dependencies: ExtensionRouteIngressDependencies,
): Promise<RateMetadata> {
  const fingerprint = dependencies.fingerprintIdentity(
    "ip",
    clientIp(request),
  );
  return {
    decision: await consumeBudget(dependencies, {
      operation,
      requestId,
      phase: "pre-auth",
      key: budgetKey(policy, "ip", fingerprint),
      ...policy.preAuthIpBudget,
    }),
    limit: policy.preAuthIpBudget.limit,
  };
}

async function consumeUserBudget(
  userId: string,
  operation: ExtensionRouteOperation,
  policy: ExtensionRoutePolicy,
  requestId: string,
  dependencies: ExtensionRouteIngressDependencies,
): Promise<RateMetadata> {
  const fingerprint = dependencies.fingerprintIdentity("user", userId);
  return {
    decision: await consumeBudget(dependencies, {
      operation,
      requestId,
      phase: "post-auth",
      key: budgetKey(policy, "user", fingerprint),
      ...policy.postAuthUserBudget,
    }),
    limit: policy.postAuthUserBudget.limit,
  };
}

function ingressErrorResponse(
  error: unknown,
  input: {
    dependencies: ExtensionRouteIngressDependencies;
    policy: ExtensionRoutePolicy;
    requestId: string;
    userId?: string;
    rate?: RateMetadata;
  },
): NextResponse {
  const typed = toErrorResponse(error, input.requestId);
  if (typed) return finalizeResponse(typed, input.requestId, input.rate);
  input.dependencies.reportError(error, {
    scope: input.policy.scope,
    ...(input.userId ? { userId: input.userId } : {}),
    requestId: input.requestId,
  });
  return finalizeResponse(
    errorJson("INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE, 500, {
      requestId: input.requestId,
    }),
    input.requestId,
    input.rate,
  );
}

async function executeAuthenticatedRoute(
  dependencies: ExtensionRouteIngressDependencies,
  input: {
    operation: ExtensionRouteOperation;
    policy: ExtensionRoutePolicy;
    requestId: string;
    userId: string;
    preAuthRate: RateMetadata;
    handler: ExtensionRouteHandler;
  },
): Promise<NextResponse> {
  let rate = input.preAuthRate;
  try {
    rate = await consumeUserBudget(
      input.userId,
      input.operation,
      input.policy,
      input.requestId,
      dependencies,
    );
    if (!rate.decision.allowed) {
      return rateLimitedResponse(input.requestId, rate);
    }
    return finalizeResponse(
      await input.handler({
        userId: input.userId,
        requestId: input.requestId,
      }),
      input.requestId,
      rate,
    );
  } catch (error) {
    return ingressErrorResponse(error, {
      dependencies,
      policy: input.policy,
      requestId: input.requestId,
      userId: input.userId,
      rate,
    });
  }
}

async function executeExtensionRoute(
  dependencies: ExtensionRouteIngressDependencies,
  request: Request,
  operation: ExtensionRouteOperation,
  handler: ExtensionRouteHandler,
): Promise<NextResponse> {
  const policy = getExtensionRoutePolicy(operation);
  const requestId = dependencies.createRequestId();
  let currentRate: RateMetadata | undefined;
  try {
    currentRate = await consumeIpBudget(
      request,
      operation,
      policy,
      requestId,
      dependencies,
    );
    if (!currentRate.decision.allowed) {
      return rateLimitedResponse(requestId, currentRate);
    }
    const authentication = await authenticateForIngress(
      request,
      policy,
      dependencies,
    );
    if (authentication.kind === "unauthorized") {
      return finalizeResponse(
        unauthorizedError(requestId),
        requestId,
        currentRate,
      );
    }
    return executeAuthenticatedRoute(dependencies, {
      operation,
      policy,
      requestId,
      userId: authentication.userId,
      preAuthRate: currentRate,
      handler,
    });
  } catch (error) {
    return ingressErrorResponse(error, {
      dependencies,
      policy,
      requestId,
      ...(currentRate ? { rate: currentRate } : {}),
    });
  }
}

export function createExtensionRouteIngress(
  dependencies: ExtensionRouteIngressDependencies,
): ExtensionRouteIngress {
  return (request, operation, handler) =>
    executeExtensionRoute(dependencies, request, operation, handler);
}

const fallbackBudget = createMemoryAbuseBudgetPort();
let primaryBudget: AbuseBudgetPort | null = null;

function unavailableBudget(message: string): AbuseBudgetPort {
  return {
    async consume() {
      throw new AbuseBudgetUnavailableError(message);
    },
  };
}

function productionPrimaryBudget(): AbuseBudgetPort {
  if (primaryBudget) return primaryBudget;

  const capability =
    getRuntimeCapabilities().extensionIngress.distributedAbuseBudget;
  if (capability.kind === "disabled") {
    primaryBudget = fallbackBudget;
  } else if (capability.kind === "invalid") {
    primaryBudget = unavailableBudget(capability.reason);
  } else {
    primaryBudget = createUpstashAbuseBudgetPort({
      url: capability.config.url,
      token: capability.config.token,
      keyPrefix: "joblit:extension:v1:",
    });
  }
  return primaryBudget;
}

function productionFingerprint(kind: IdentityKind, value: string): string {
  const capability =
    getRuntimeCapabilities().extensionIngress.identityFingerprint;
  if (capability.kind === "invalid") {
    throw new RuntimeCapabilityConfigurationError(
      "extensionIngress.identityFingerprint",
      capability.reason,
    );
  }
  return createHmac("sha256", capability.config.secret)
    .update(`${kind}\0${value}`)
    .digest("hex");
}

const productionDependencies: ExtensionRouteIngressDependencies = {
  createRequestId,
  requireSession,
  requireExtensionToken,
  get primaryBudget() {
    return productionPrimaryBudget();
  },
  fallbackBudget,
  fingerprintIdentity: productionFingerprint,
  reportError,
};

export const withExtensionRoute = createExtensionRouteIngress(
  productionDependencies,
);
