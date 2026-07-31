import {
  parseAtsBoardRegistryJson,
  type AtsBoardConfig,
  type AtsBoardRegistryIssue,
} from "@/lib/server/sources/atsBoards";
import { DEFAULT_GEMINI_MODEL } from "@/lib/server/ai/providerDefaults";

export type RuntimeEnvironment = Readonly<
  Record<string, string | undefined>
>;

type BatchAutogenerationCapability =
  | { kind: "enabled"; config: Record<string, never> }
  | {
      kind: "disabled";
      reason: "BATCH_AUTOGENERATION_DISABLED";
    }
  | {
      kind: "invalid";
      reason: "BATCH_AUTOGENERATION_FLAG_INVALID";
      invalid: readonly ["ENABLE_BATCH_EXECUTE_AUTOGEN"];
    };

type ArtifactReconciliationCapability =
  | {
      kind: "enabled";
      config: Record<string, never>;
    }
  | {
      kind: "disabled";
      reason: "ARTIFACT_RECONCILE_DISABLED";
    }
  | {
      kind: "invalid";
      reason:
        | "ARTIFACT_RECONCILE_AUTH_MISSING"
        | "ARTIFACT_RECONCILE_FLAG_INVALID";
      missingAnyOf?: readonly [readonly [
        "CRON_SECRET",
        "ARTIFACT_RECONCILE_SECRET",
      ]];
      invalid?: readonly ["ARTIFACT_RECONCILE_ENABLED"];
    };

type ArtifactReconciliationAuthenticationCapability =
  | {
      kind: "enabled";
      config: { secrets: readonly string[] };
    }
  | {
      kind: "invalid";
      reason: "ARTIFACT_RECONCILE_AUTH_MISSING";
      missingAnyOf: readonly [readonly [
        "CRON_SECRET",
        "ARTIFACT_RECONCILE_SECRET",
      ]];
    };

type GithubFetchRunDispatchCapability =
  | {
      kind: "enabled";
      config: {
        owner: string;
        repo: string;
        token: string;
        workflow: string;
        ref: string;
      };
    }
  | {
      kind: "disabled";
      reason: "GITHUB_DISPATCH_NOT_CONFIGURED";
    }
  | {
      kind: "invalid";
      reason: "GITHUB_DISPATCH_CONFIG_INCOMPLETE";
      missing: readonly string[];
    };

type FetchRunAuthenticationCapability =
  | { kind: "enabled"; config: { secret: string } }
  | {
      kind: "invalid";
      reason: "FETCH_RUN_SECRET_MISSING";
      missing: readonly ["FETCH_RUN_SECRET"];
    };

type AtsBoardsCapability =
  | {
      kind: "enabled";
      boards: readonly AtsBoardConfig[];
      issues: readonly AtsBoardRegistryIssue[];
    }
  | {
      kind: "disabled";
      reason: "ATS_BOARDS_NOT_CONFIGURED";
      boards: readonly [];
      issues: readonly [];
    }
  | {
      kind: "invalid";
      reason: "ATS_BOARD_CONFIG_INVALID";
      boards: readonly [];
      issues: readonly AtsBoardRegistryIssue[];
    };

type BlobStorageCapability =
  | { kind: "enabled"; config: { token: string } }
  | { kind: "disabled"; reason: "BLOB_STORAGE_NOT_CONFIGURED" };

type LatexRendererCapability =
  | {
      kind: "enabled";
      config: {
        url: string;
        token: string;
        allowInsecureHttp: boolean;
      };
    }
  | {
      kind: "invalid";
      reason:
        | "LATEX_RENDER_CONFIG_INCOMPLETE"
        | "LATEX_RENDER_CONFIG_MISSING"
        | "LATEX_RENDER_INSECURE_HTTP_FLAG_INVALID"
        | "LATEX_RENDER_URL_INVALID";
      missing?: readonly string[];
      invalid?: readonly string[];
      details?: { reason: string };
    };

type GeminiCapability =
  | {
      kind: "enabled";
      config: { apiKey: string; model: string };
    }
  | { kind: "disabled"; reason: "GEMINI_NOT_CONFIGURED" };

type InvalidLatexRendererCapability = Extract<
  LatexRendererCapability,
  { kind: "invalid" }
>;

export type RuntimeCapabilities = {
  artifactReconciliation: ArtifactReconciliationCapability;
  artifactReconciliationAuthentication:
    ArtifactReconciliationAuthenticationCapability;
  atsBoards: AtsBoardsCapability;
  batchAutogeneration: BatchAutogenerationCapability;
  blobStorage: BlobStorageCapability;
  fetchRunAuthentication: FetchRunAuthenticationCapability;
  gemini: GeminiCapability;
  githubFetchRunDispatch: GithubFetchRunDispatchCapability;
  latexRenderer: LatexRendererCapability;
};

function trimmed(
  environment: RuntimeEnvironment,
  key: string,
): string | undefined {
  const value = environment[key]?.trim();
  return value || undefined;
}

function githubFetchRunDispatch(
  environment: RuntimeEnvironment,
): GithubFetchRunDispatchCapability {
  const owner = trimmed(environment, "GITHUB_OWNER");
  const repo = trimmed(environment, "GITHUB_REPO");
  const token = trimmed(environment, "GITHUB_TOKEN");
  if (!owner && !repo && !token) {
    return {
      kind: "disabled",
      reason: "GITHUB_DISPATCH_NOT_CONFIGURED",
    };
  }

  const missing = [
    ...(owner ? [] : ["GITHUB_OWNER"]),
    ...(repo ? [] : ["GITHUB_REPO"]),
    ...(token ? [] : ["GITHUB_TOKEN"]),
  ];
  if (missing.length > 0) {
    return {
      kind: "invalid",
      reason: "GITHUB_DISPATCH_CONFIG_INCOMPLETE",
      missing,
    };
  }

  return {
    kind: "enabled",
    config: {
      owner: owner!,
      repo: repo!,
      token: token!,
      workflow:
        trimmed(environment, "GITHUB_WORKFLOW_FILE") ??
        "jobspy-fetch.yml",
      ref: trimmed(environment, "GITHUB_REF") ?? "master",
    },
  };
}

function atsBoards(environment: RuntimeEnvironment): AtsBoardsCapability {
  const parsed = parseAtsBoardRegistryJson(
    trimmed(environment, "JOBLIT_ATS_BOARDS_JSON"),
  );
  if (parsed.boards.length > 0) {
    return {
      kind: "enabled",
      boards: parsed.boards,
      issues: parsed.issues,
    };
  }
  if (parsed.issues.length > 0) {
    return {
      kind: "invalid",
      reason: "ATS_BOARD_CONFIG_INVALID",
      boards: [],
      issues: parsed.issues,
    };
  }
  return {
    kind: "disabled",
    reason: "ATS_BOARDS_NOT_CONFIGURED",
    boards: [],
    issues: [],
  };
}

function latexTransport(
  environment: RuntimeEnvironment,
):
  | { kind: "valid"; allowInsecureHttp: boolean }
  | InvalidLatexRendererCapability {
  const flag = trimmed(
    environment,
    "LATEX_RENDER_ALLOW_INSECURE_HTTP",
  )?.toLowerCase();
  if (flag === undefined || flag === "false") {
    return { kind: "valid", allowInsecureHttp: false };
  }
  if (flag === "true") {
    return { kind: "valid", allowInsecureHttp: true };
  }
  return {
    kind: "invalid",
    reason: "LATEX_RENDER_INSECURE_HTTP_FLAG_INVALID",
    invalid: ["LATEX_RENDER_ALLOW_INSECURE_HTTP"],
  };
}

function latexUrlIssue(
  url: string,
  allowInsecureHttp: boolean,
): InvalidLatexRendererCapability | null {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      return {
        kind: "invalid",
        reason: "LATEX_RENDER_URL_INVALID",
        invalid: ["LATEX_RENDER_URL"],
      };
    }
    if (
      parsed.protocol === "https:" ||
      (allowInsecureHttp && parsed.protocol === "http:")
    ) {
      return null;
    }
    return {
      kind: "invalid",
      reason: "LATEX_RENDER_URL_INVALID",
      invalid: ["LATEX_RENDER_URL"],
      details: {
        reason:
          parsed.protocol === "http:"
            ? "HTTPS_REQUIRED"
            : "PROTOCOL_NOT_ALLOWED",
      },
    };
  } catch {
    return {
      kind: "invalid",
      reason: "LATEX_RENDER_URL_INVALID",
      invalid: ["LATEX_RENDER_URL"],
    };
  }
}

function latexRenderer(
  environment: RuntimeEnvironment,
): LatexRendererCapability {
  const url = trimmed(environment, "LATEX_RENDER_URL");
  const token = trimmed(environment, "LATEX_RENDER_TOKEN");
  if (!url && !token) {
    return {
      kind: "invalid",
      reason: "LATEX_RENDER_CONFIG_MISSING",
      missing: ["LATEX_RENDER_URL", "LATEX_RENDER_TOKEN"],
    };
  }
  if (!url || !token) {
    return {
      kind: "invalid",
      reason: "LATEX_RENDER_CONFIG_INCOMPLETE",
      missing: [
        ...(url ? [] : ["LATEX_RENDER_URL"]),
        ...(token ? [] : ["LATEX_RENDER_TOKEN"]),
      ],
    };
  }
  const transport = latexTransport(environment);
  if (transport.kind === "invalid") return transport;
  const { allowInsecureHttp } = transport;
  const urlIssue = latexUrlIssue(url, allowInsecureHttp);
  if (urlIssue) return urlIssue;
  return {
    kind: "enabled",
    config: { url, token, allowInsecureHttp },
  };
}

function batchAutogeneration(
  environment: RuntimeEnvironment,
): BatchAutogenerationCapability {
  const flag = trimmed(
    environment,
    "ENABLE_BATCH_EXECUTE_AUTOGEN",
  )?.toLowerCase();
  if (flag === "1" || flag === "true") {
    return { kind: "enabled", config: {} };
  }
  if (!flag || flag === "0" || flag === "false") {
    return {
      kind: "disabled",
      reason: "BATCH_AUTOGENERATION_DISABLED",
    };
  }
  return {
    kind: "invalid",
    reason: "BATCH_AUTOGENERATION_FLAG_INVALID",
    invalid: ["ENABLE_BATCH_EXECUTE_AUTOGEN"],
  };
}

function artifactAuthSecrets(
  environment: RuntimeEnvironment,
): readonly string[] {
  const secrets = [
    trimmed(environment, "CRON_SECRET"),
    trimmed(environment, "ARTIFACT_RECONCILE_SECRET"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(secrets)];
}

function artifactReconciliationAuthentication(
  environment: RuntimeEnvironment,
): ArtifactReconciliationAuthenticationCapability {
  const secrets = artifactAuthSecrets(environment);
  return secrets.length > 0
    ? { kind: "enabled", config: { secrets } }
    : {
        kind: "invalid",
        reason: "ARTIFACT_RECONCILE_AUTH_MISSING",
        missingAnyOf: [["CRON_SECRET", "ARTIFACT_RECONCILE_SECRET"]],
      };
}

function artifactReconciliation(
  environment: RuntimeEnvironment,
  authentication: ArtifactReconciliationAuthenticationCapability,
): ArtifactReconciliationCapability {
  const flag = trimmed(
    environment,
    "ARTIFACT_RECONCILE_ENABLED",
  )?.toLowerCase();
  if (!flag || flag === "0" || flag === "false") {
    return {
      kind: "disabled",
      reason: "ARTIFACT_RECONCILE_DISABLED",
    };
  }
  if (flag !== "1" && flag !== "true") {
    return {
      kind: "invalid",
      reason: "ARTIFACT_RECONCILE_FLAG_INVALID",
      invalid: ["ARTIFACT_RECONCILE_ENABLED"],
    };
  }
  if (authentication.kind === "invalid") {
    return {
      kind: "invalid",
      reason: "ARTIFACT_RECONCILE_AUTH_MISSING",
      missingAnyOf: [["CRON_SECRET", "ARTIFACT_RECONCILE_SECRET"]],
    };
  }
  return { kind: "enabled", config: {} };
}

function blobStorage(environment: RuntimeEnvironment): BlobStorageCapability {
  const token = trimmed(environment, "BLOB_READ_WRITE_TOKEN");
  return token
    ? { kind: "enabled", config: { token } }
    : { kind: "disabled", reason: "BLOB_STORAGE_NOT_CONFIGURED" };
}

function fetchRunAuthentication(
  environment: RuntimeEnvironment,
): FetchRunAuthenticationCapability {
  const secret = trimmed(environment, "FETCH_RUN_SECRET");
  return secret
    ? { kind: "enabled", config: { secret } }
    : {
        kind: "invalid",
        reason: "FETCH_RUN_SECRET_MISSING",
        missing: ["FETCH_RUN_SECRET"],
      };
}

function gemini(environment: RuntimeEnvironment): GeminiCapability {
  const apiKey = trimmed(environment, "GEMINI_API_KEY");
  return apiKey
    ? {
        kind: "enabled",
        config: {
          apiKey,
          model:
            trimmed(environment, "GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL,
        },
      }
    : { kind: "disabled", reason: "GEMINI_NOT_CONFIGURED" };
}

export function resolveRuntimeCapabilities(
  environment: RuntimeEnvironment,
): RuntimeCapabilities {
  const reconciliationAuthentication =
    artifactReconciliationAuthentication(environment);
  return {
    artifactReconciliation: artifactReconciliation(
      environment,
      reconciliationAuthentication,
    ),
    artifactReconciliationAuthentication: reconciliationAuthentication,
    atsBoards: atsBoards(environment),
    batchAutogeneration: batchAutogeneration(environment),
    blobStorage: blobStorage(environment),
    fetchRunAuthentication: fetchRunAuthentication(environment),
    gemini: gemini(environment),
    githubFetchRunDispatch: githubFetchRunDispatch(environment),
    latexRenderer: latexRenderer(environment),
  };
}

/** Production adapter. Tests should prefer `resolveRuntimeCapabilities(env)`. */
export function getRuntimeCapabilities(): RuntimeCapabilities {
  return resolveRuntimeCapabilities(process.env);
}
