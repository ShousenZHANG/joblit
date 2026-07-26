import { NextResponse } from "next/server";

import { errorJson } from "@/lib/server/api/errorResponse";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";
import { reconcileApplicationArtifacts } from "@/lib/server/artifacts/artifactReconciler";
import { reportError } from "@/lib/server/observability/errorReporter";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function authorized(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  const secrets = [
    process.env.CRON_SECRET,
    process.env.ARTIFACT_RECONCILE_SECRET,
  ].filter(
    (secret): secret is string =>
      typeof secret === "string" && secret.length > 0,
  );
  return secrets.some((secret) =>
    constantTimeEqual(authorization, `Bearer ${secret}`),
  );
}

function reconciliationEnabled(): boolean {
  return (
    process.env.ARTIFACT_RECONCILE_ENABLED === "true" ||
    process.env.ARTIFACT_RECONCILE_ENABLED === "1"
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return errorJson("UNAUTHORIZED", "Unauthorized", 401, {
      headers: NO_STORE_HEADERS,
    });
  }
  if (!reconciliationEnabled()) {
    return NextResponse.json(
      { kind: "disabled" },
      { headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await reconcileApplicationArtifacts();
    if (result.kind === "port_unavailable") {
      return errorJson(
        "ARTIFACT_STORAGE_UNAVAILABLE",
        "Application artifact storage is not configured.",
        503,
        {
          details: {
            claimed: result.claimed,
            retried: result.retried,
            inventory: result.inventory,
          },
          headers: NO_STORE_HEADERS,
        },
      );
    }
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    reportError(error, { scope: "artifacts.reconcile" });
    return errorJson(
      "ARTIFACT_RECONCILE_FAILED",
      "Artifact reconciliation failed",
      500,
      { headers: NO_STORE_HEADERS },
    );
  }
}
