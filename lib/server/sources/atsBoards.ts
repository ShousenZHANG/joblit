export const ATS_PROVIDERS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
] as const;

export type AtsProvider = (typeof ATS_PROVIDERS)[number];
export type LeverRegion = "global" | "eu";

/**
 * One company-owned ATS board.
 *
 * `boardToken` is the public tenant/site name from the hosted careers URL.
 * Hosts and API paths are deliberately not configurable: callers can add
 * tenants, but cannot turn the source registry into an arbitrary URL fetcher.
 */
export interface AtsBoardConfig {
  /** Stable Job.source value. Generated when omitted. */
  id: string;
  provider: AtsProvider;
  boardToken: string;
  company: string;
  /** Lever has separate global and EU public posting hosts. */
  region?: LeverRegion;
  /** Optional first-party company careers page used by a rediscovery worker. */
  careersUrl?: string;
}

export interface AtsBoardRegistryIssue {
  index: number | null;
  code:
    | "invalid_json"
    | "not_array"
    | "too_many_boards"
    | "invalid_entry"
    | "invalid_provider"
    | "invalid_board_token"
    | "invalid_company"
    | "invalid_id"
    | "invalid_region"
    | "invalid_careers_url"
    | "duplicate_id";
  message: string;
}

export interface AtsBoardRegistryResult {
  boards: AtsBoardConfig[];
  issues: AtsBoardRegistryIssue[];
}

const MAX_BOARDS = 250;
const BOARD_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SOURCE_ID_RE = /^[a-z0-9][a-z0-9:_-]{0,59}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isProvider(value: unknown): value is AtsProvider {
  return (
    typeof value === "string" &&
    (ATS_PROVIDERS as readonly string[]).includes(value)
  );
}

function normalizedSourceId(provider: AtsProvider, boardToken: string): string {
  const prefix = `ats:${provider}:`;
  const token = boardToken.toLowerCase();
  const plain = `${prefix}${token}`;
  if (plain.length <= 60) return plain;

  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const suffix = hash.toString(16).padStart(8, "0");
  return `${prefix}${token.slice(0, 60 - prefix.length - suffix.length - 1)}-${suffix}`;
}

function readCareersUrl(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Parse deployment-owned board configuration without throwing. Invalid rows
 * are rejected independently, allowing one typo to be visible without taking
 * healthy boards offline.
 */
export function parseAtsBoardRegistry(input: unknown): AtsBoardRegistryResult {
  if (!Array.isArray(input)) {
    return {
      boards: [],
      issues: [
        {
          index: null,
          code: "not_array",
          message: "ATS board registry must be a JSON array",
        },
      ],
    };
  }

  const boards: AtsBoardConfig[] = [];
  const issues: AtsBoardRegistryIssue[] =
    input.length > MAX_BOARDS
      ? [
          {
            index: null,
            code: "too_many_boards",
            message:
              `ATS board registry is limited to ${MAX_BOARDS} entries; excess entries were ignored`,
          },
        ]
      : [];
  const ids = new Set<string>();

  input.slice(0, MAX_BOARDS).forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push({
        index,
        code: "invalid_entry",
        message: "ATS board entry must be an object",
      });
      return;
    }
    if (entry.enabled === false) return;

    if (!isProvider(entry.provider)) {
      issues.push({
        index,
        code: "invalid_provider",
        message: "provider must be greenhouse, lever, ashby, or workable",
      });
      return;
    }
    const provider = entry.provider;

    const boardToken =
      typeof entry.boardToken === "string" ? entry.boardToken.trim() : "";
    if (!BOARD_TOKEN_RE.test(boardToken)) {
      issues.push({
        index,
        code: "invalid_board_token",
        message: "boardToken must be a safe public ATS tenant name",
      });
      return;
    }

    const company =
      typeof entry.company === "string" ? entry.company.trim() : "";
    if (!company || company.length > 200) {
      issues.push({
        index,
        code: "invalid_company",
        message: "company must contain 1-200 characters",
      });
      return;
    }

    const configuredId = entry.sourceId ?? entry.id;
    const id =
      configuredId === undefined
        ? normalizedSourceId(provider, boardToken)
        : typeof configuredId === "string"
          ? configuredId.trim().toLowerCase()
          : "";
    if (
      !SOURCE_ID_RE.test(id) ||
      !id.startsWith(`ats:${provider}:`)
    ) {
      issues.push({
        index,
        code: "invalid_id",
        message:
          `id must use the ats:${provider}: prefix and contain 1-60 lowercase source-safe characters`,
      });
      return;
    }
    if (ids.has(id)) {
      issues.push({
        index,
        code: "duplicate_id",
        message: `duplicate ATS source id "${id}"`,
      });
      return;
    }

    const region = entry.region === null ? undefined : entry.region;
    if (
      region !== undefined &&
      (provider !== "lever" || (region !== "global" && region !== "eu"))
    ) {
      issues.push({
        index,
        code: "invalid_region",
        message: "region is only supported for Lever and must be global or eu",
      });
      return;
    }

    const careersUrl = readCareersUrl(entry.careersUrl);
    if (careersUrl === null) {
      issues.push({
        index,
        code: "invalid_careers_url",
        message: "careersUrl must be an absolute credential-free HTTPS URL",
      });
      return;
    }

    ids.add(id);
    boards.push({
      id,
      provider,
      boardToken,
      company,
      ...(provider === "lever"
        ? { region: (region as LeverRegion | undefined) ?? "global" }
        : {}),
      ...(careersUrl ? { careersUrl } : {}),
    });
  });

  return { boards, issues };
}

export function parseAtsBoardRegistryJson(
  value: string | undefined,
): AtsBoardRegistryResult {
  if (!value?.trim()) return { boards: [], issues: [] };
  try {
    return parseAtsBoardRegistry(JSON.parse(value) as unknown);
  } catch {
    return {
      boards: [],
      issues: [
        {
          index: null,
          code: "invalid_json",
          message: "JOBLIT_ATS_BOARDS_JSON is not valid JSON",
        },
      ],
    };
  }
}
