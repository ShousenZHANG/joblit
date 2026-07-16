import { SESSION_STORAGE_KEYS, STORAGE_KEYS } from "@ext/shared/constants";
import { DEFAULT_HERMES_BASE, DEFAULT_HERMES_PROFILE_NAME, isHermesProfileName, normalizeHermesBase } from "@ext/shared/hermesBase";
import {
  MAX_MODEL_OUTPUT_CHARS,
  MIN_MODEL_OUTPUT_CHARS,
  isRunLookupPayload,
  isStartRunPayload,
  jsonByteLength,
  validatePublicRunResult,
  type HermesSettingsInput,
  type HermesSettingsPublic,
  type PublicLocalAiStatus,
  type PublicRunResult,
  type RunLookupPayload,
  type StartRunPayload,
} from "@ext/shared/hermesTypes";
import { fetchAiPromptEnvelope } from "./api";
import { HermesApiError } from "./apiErrors";
import { getAuthStatus } from "./auth";
import { createHermesApi } from "./hermesApi";

const RUN_TTL_MS = 60 * 60 * 1000;
const MAX_REGISTRY_ENTRIES = 20;
const MAX_REGISTRY_BYTES = 512_000;
const MAX_PROMPT_META_BYTES = 24_000;
const RUN_ID_RE = /^run_[0-9a-f]{32}$/;
const startLocks = new Map<string, {
  jobId: string;
  target: StartRunPayload["target"];
  operation: Promise<PublicRunResult>;
}>();
let registryMutationQueue: Promise<void> = Promise.resolve();
let registryEpoch = 0;

interface SecretSettings {
  baseUrl: string;
  apiKey: string;
  profileName: string;
}

interface RegistryBase extends StartRunPayload {
  createdAt: number;
  updatedAt: number;
  promptMeta: Record<string, unknown>;
}

type RegistryEntry =
  | (RegistryBase & { stage: "starting" })
  | (RegistryBase & { stage: "unknown" })
  | (RegistryBase & {
      stage: "active";
      runId: string;
      lastStatus: "queued" | "running" | "stopping";
    })
  | (RegistryBase & { stage: "terminal"; terminal: PublicRunResult });

type Registry = Record<string, RegistryEntry>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validProfileName(value: unknown): value is string {
  return isHermesProfileName(value);
}

function validApiKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 20 && value.length <= 512 && !/[\s\u0000-\u001f]/.test(value);
}

async function readSecretSettings(): Promise<SecretSettings> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.HERMES_API_BASE,
    STORAGE_KEYS.HERMES_API_KEY,
    STORAGE_KEYS.HERMES_PROFILE_NAME,
  ]);
  const apiKey = stored[STORAGE_KEYS.HERMES_API_KEY];
  const profileName = stored[STORAGE_KEYS.HERMES_PROFILE_NAME];
  if (!validApiKey(apiKey) || !validProfileName(profileName)) {
    throw new HermesApiError("HERMES_SETTINGS_INVALID", "Hermes is not configured");
  }
  let baseUrl: string;
  try {
    baseUrl = normalizeHermesBase(stored[STORAGE_KEYS.HERMES_API_BASE]);
  } catch {
    throw new HermesApiError("HERMES_SETTINGS_INVALID", "Hermes endpoint is invalid");
  }
  return { baseUrl, apiKey, profileName };
}

function makeApi(settings: SecretSettings) {
  return createHermesApi(settings);
}

function validatePositionIndependentPrompt(value: unknown): {
  input: string;
  instructions: string;
  promptMeta: Record<string, unknown>;
} {
  if (!isRecord(value) || !isRecord(value.prompt) || !isRecord(value.promptMeta)) {
    throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Joblit prompt response is invalid");
  }
  const input = value.prompt.input;
  const instructions = value.prompt.instructions;
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > 160_000 ||
    typeof instructions !== "string" ||
    instructions.length === 0 ||
    instructions.length > 160_000 ||
    jsonByteLength(value.promptMeta) > MAX_PROMPT_META_BYTES
  ) {
    throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Joblit prompt response is invalid");
  }
  return { input, instructions, promptMeta: value.promptMeta };
}

function isRegistryEntry(value: unknown, requestId: string): value is RegistryEntry {
  if (!isRecord(value) || value.requestId !== requestId || !isStartRunPayload({
    requestId: value.requestId,
    jobId: value.jobId,
    target: value.target,
  })) return false;
  if (
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt) ||
    !isRecord(value.promptMeta) ||
    jsonByteLength(value.promptMeta) > MAX_PROMPT_META_BYTES
  ) return false;

  if (value.stage === "starting" || value.stage === "unknown") return true;
  if (value.stage === "active") {
    return (
      typeof value.runId === "string" &&
      RUN_ID_RE.test(value.runId) &&
      (value.lastStatus === "queued" || value.lastStatus === "running" || value.lastStatus === "stopping")
    );
  }
  if (value.stage === "terminal" && validatePublicRunResult(value.terminal)) {
    return (
      value.terminal.requestId === value.requestId &&
      value.terminal.jobId === value.jobId &&
      value.terminal.target === value.target
    );
  }
  return false;
}

async function readRegistry(now = Date.now()): Promise<Registry> {
  const result = await chrome.storage.session.get(SESSION_STORAGE_KEYS.HERMES_RUN_REGISTRY);
  const raw = result[SESSION_STORAGE_KEYS.HERMES_RUN_REGISTRY];
  if (!isRecord(raw)) return {};
  const registry: Registry = {};
  for (const [requestId, entry] of Object.entries(raw)) {
    if (
      isRegistryEntry(entry, requestId) &&
      entry.createdAt <= now &&
      entry.updatedAt >= entry.createdAt &&
      entry.updatedAt <= now &&
      now - entry.createdAt <= RUN_TTL_MS
    ) {
      registry[requestId] = entry;
    }
  }
  return registry;
}

async function writeRegistry(registry: Registry): Promise<void> {
  const bounded = Object.fromEntries(
    Object.entries(registry)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_REGISTRY_ENTRIES),
  ) as Registry;
  if (jsonByteLength(bounded) > MAX_REGISTRY_BYTES) {
    throw new HermesApiError("HERMES_RESPONSE_TOO_LARGE", "Local run registry exceeds limit");
  }
  await chrome.storage.session.set({ [SESSION_STORAGE_KEYS.HERMES_RUN_REGISTRY]: bounded });
}

function mutateRegistry(
  mutate: (registry: Registry) => void,
  expectedEpoch = registryEpoch,
): Promise<void> {
  const operation = registryMutationQueue.then(async () => {
    if (expectedEpoch !== registryEpoch) {
      throw new HermesApiError("HERMES_RUN_NOT_FOUND", "Run mapping was cleared", { retryable: true });
    }
    const registry = await readRegistry();
    mutate(registry);
    await writeRegistry(registry);
  });
  registryMutationQueue = operation.catch(() => undefined);
  return operation;
}

function putEntry(entry: RegistryEntry, expectedEpoch = registryEpoch): Promise<void> {
  return mutateRegistry((registry) => {
    registry[entry.requestId] = entry;
  }, expectedEpoch);
}

function deleteEntry(requestId: string, expectedEpoch = registryEpoch): Promise<void> {
  return mutateRegistry((registry) => {
    delete registry[requestId];
  }, expectedEpoch);
}

function publicActive(entry: RegistryBase, status: "queued" | "running" | "stopping"): PublicRunResult {
  return { requestId: entry.requestId, jobId: entry.jobId, target: entry.target, status };
}

function publicFailure(
  entry: RegistryBase,
  code: "HERMES_RUN_FAILED" | "AI_OUTPUT_INVALID" | "UNEXPECTED_APPROVAL_REQUIRED",
): PublicRunResult {
  const message = code === "AI_OUTPUT_INVALID"
    ? "Hermes returned an invalid or oversized result."
    : code === "UNEXPECTED_APPROVAL_REQUIRED"
      ? "Hermes requested an approval that the Joblit profile must not use."
      : "Hermes could not complete this generation.";
  return {
    requestId: entry.requestId,
    jobId: entry.jobId,
    target: entry.target,
    status: "failed",
    error: { code, message, retryable: code === "HERMES_RUN_FAILED" },
  };
}

export async function getHermesSettingsPublic(): Promise<HermesSettingsPublic> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.HERMES_API_BASE,
    STORAGE_KEYS.HERMES_API_KEY,
    STORAGE_KEYS.HERMES_PROFILE_NAME,
  ]);
  let baseUrl = DEFAULT_HERMES_BASE;
  let hasValidBase = stored[STORAGE_KEYS.HERMES_API_BASE] !== undefined;
  try {
    if (stored[STORAGE_KEYS.HERMES_API_BASE] !== undefined) {
      baseUrl = normalizeHermesBase(stored[STORAGE_KEYS.HERMES_API_BASE]);
    }
  } catch {
    baseUrl = DEFAULT_HERMES_BASE;
    hasValidBase = false;
  }
  const hasValidProfile = validProfileName(stored[STORAGE_KEYS.HERMES_PROFILE_NAME]);
  const profileName = hasValidProfile
    ? stored[STORAGE_KEYS.HERMES_PROFILE_NAME]
    : DEFAULT_HERMES_PROFILE_NAME;
  const hasApiKey = validApiKey(stored[STORAGE_KEYS.HERMES_API_KEY]);
  return { baseUrl, profileName, hasApiKey, configured: hasApiKey && hasValidBase && hasValidProfile };
}

export async function testAndSaveHermesSettings(input: HermesSettingsInput): Promise<HermesSettingsPublic> {
  let baseUrl: string;
  try {
    baseUrl = normalizeHermesBase(input.baseUrl);
  } catch {
    throw new HermesApiError("HERMES_SETTINGS_INVALID", "Hermes endpoint is invalid");
  }
  if (!validProfileName(input.profileName)) {
    throw new HermesApiError("HERMES_SETTINGS_INVALID", "Hermes profile name is invalid");
  }
  const existing = await chrome.storage.local.get(STORAGE_KEYS.HERMES_API_KEY);
  const apiKey = input.apiKey ?? existing[STORAGE_KEYS.HERMES_API_KEY];
  if (!validApiKey(apiKey)) {
    throw new HermesApiError("HERMES_SETTINGS_INVALID", "Hermes API key is invalid");
  }
  await makeApi({ baseUrl, apiKey, profileName: input.profileName }).probe();
  await chrome.storage.local.set({
    [STORAGE_KEYS.HERMES_API_BASE]: baseUrl,
    [STORAGE_KEYS.HERMES_API_KEY]: apiKey,
    [STORAGE_KEYS.HERMES_PROFILE_NAME]: input.profileName,
  });
  return { baseUrl, profileName: input.profileName, hasApiKey: true, configured: true };
}

export async function checkHermesSettings(): Promise<HermesSettingsPublic> {
  const settings = await readSecretSettings();
  await makeApi(settings).probe();
  return { baseUrl: settings.baseUrl, profileName: settings.profileName, hasApiKey: true, configured: true };
}

export async function forgetHermesSettings(): Promise<void> {
  await Promise.all([
    chrome.storage.local.remove([
      STORAGE_KEYS.HERMES_API_BASE,
      STORAGE_KEYS.HERMES_API_KEY,
      STORAGE_KEYS.HERMES_PROFILE_NAME,
    ]),
    clearLocalAiRunRegistry(),
  ]);
}

export async function getPublicLocalAiStatus(): Promise<PublicLocalAiStatus> {
  const auth = await getAuthStatus();
  if (!auth.authenticated) return { state: "joblit_disconnected", joblitConnected: false };
  let settings: SecretSettings;
  try {
    settings = await readSecretSettings();
  } catch {
    return { state: "not_configured", joblitConnected: true };
  }
  try {
    await makeApi(settings).probe();
    return { state: "ready", joblitConnected: true, profileName: settings.profileName };
  } catch (error) {
    const code = error instanceof HermesApiError ? error.code : "HERMES_PROTOCOL_ERROR";
    if (code === "HERMES_AUTH_FAILED") return { state: "auth_failed", joblitConnected: true, profileName: settings.profileName };
    if (code === "HERMES_INCOMPATIBLE" || code === "HERMES_PROTOCOL_ERROR") {
      return { state: "incompatible", joblitConnected: true, profileName: settings.profileName };
    }
    return { state: "unreachable", joblitConnected: true, profileName: settings.profileName };
  }
}

async function startOnce(payload: StartRunPayload): Promise<PublicRunResult> {
  const expectedEpoch = registryEpoch;
  const registry = await readRegistry();
  const existing = registry[payload.requestId];
  if (existing) {
    if (existing.jobId !== payload.jobId || existing.target !== payload.target) {
      throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Request id is already bound to another job");
    }
    if (existing.stage === "terminal") return existing.terminal;
    if (existing.stage === "active") return publicActive(existing, existing.lastStatus);
    throw new HermesApiError("RUN_START_UNKNOWN", "Hermes start state is ambiguous", { retryable: false });
  }

  const settings = await readSecretSettings();
  const prompt = validatePositionIndependentPrompt(await fetchAiPromptEnvelope({
    jobId: payload.jobId,
    target: payload.target,
  }));
  const now = Date.now();
  const base: RegistryBase = { ...payload, createdAt: now, updatedAt: now, promptMeta: prompt.promptMeta };
  await putEntry({ ...base, stage: "starting" }, expectedEpoch);

  let runId: string;
  try {
    ({ runId } = await makeApi(settings).startRun({
      input: prompt.input,
      instructions: prompt.instructions,
      session_id: `joblit:${settings.profileName}:${payload.requestId}`,
    }));
  } catch (error) {
    if (error instanceof HermesApiError && error.ambiguousStart) {
      await putEntry({ ...base, stage: "unknown", updatedAt: Date.now() }, expectedEpoch);
      throw new HermesApiError("RUN_START_UNKNOWN", "Hermes start state is ambiguous", { retryable: false });
    }
    await deleteEntry(payload.requestId, expectedEpoch);
    throw error;
  }

  try {
    await putEntry({ ...base, stage: "active", runId, lastStatus: "queued", updatedAt: Date.now() }, expectedEpoch);
  } catch {
    await putEntry({ ...base, stage: "unknown", updatedAt: Date.now() }, expectedEpoch).catch(() => undefined);
    throw new HermesApiError("RUN_START_UNKNOWN", "Hermes start could not be recorded", { retryable: false });
  }
  return publicActive(base, "queued");
}

export function startLocalAiRun(payload: StartRunPayload): Promise<PublicRunResult> {
  if (!isStartRunPayload(payload)) {
    return Promise.reject(new HermesApiError("HERMES_PROTOCOL_ERROR", "Invalid start payload"));
  }
  const existing = startLocks.get(payload.requestId);
  if (existing) {
    if (existing.jobId !== payload.jobId || existing.target !== payload.target) {
      return Promise.reject(new HermesApiError("HERMES_PROTOCOL_ERROR", "Request id is already bound to another job"));
    }
    return existing.operation;
  }
  const operation = startOnce(payload).finally(() => startLocks.delete(payload.requestId));
  startLocks.set(payload.requestId, { jobId: payload.jobId, target: payload.target, operation });
  return operation;
}

export async function getLocalAiRun(payload: RunLookupPayload): Promise<PublicRunResult> {
  if (!isRunLookupPayload(payload)) throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Invalid run lookup");
  const expectedEpoch = registryEpoch;
  const registry = await readRegistry();
  const entry = registry[payload.requestId];
  if (!entry) throw new HermesApiError("HERMES_RUN_NOT_FOUND", "Run mapping is missing", { retryable: true });
  if (entry.stage === "unknown" || entry.stage === "starting") {
    throw new HermesApiError("RUN_START_UNKNOWN", "Hermes start state is ambiguous");
  }
  if (entry.stage === "terminal") return entry.terminal;

  const settings = await readSecretSettings();
  let run;
  try {
    run = await makeApi(settings).getRun(entry.runId);
  } catch (error) {
    if (error instanceof HermesApiError && error.code === "HERMES_RUN_NOT_FOUND") {
      await deleteEntry(entry.requestId, expectedEpoch);
    }
    throw error;
  }
  if (run.status === "waiting_for_approval") {
    try {
      await makeApi(settings).stopRun(entry.runId);
    } catch {
      // Approval is forbidden for the Joblit profile. Preserve the original
      // fail-closed result even when the best-effort stop cannot be confirmed.
    }
    const terminal = publicFailure(entry, "UNEXPECTED_APPROVAL_REQUIRED");
    await putEntry({ ...entry, stage: "terminal", terminal, updatedAt: Date.now() }, expectedEpoch);
    return terminal;
  }
  if (run.status === "queued" || run.status === "running" || run.status === "stopping") {
    const active: RegistryEntry = { ...entry, stage: "active", lastStatus: run.status, updatedAt: Date.now() };
    await putEntry(active, expectedEpoch);
    return publicActive(active, run.status);
  }

  let terminal: PublicRunResult;
  if (run.status === "completed") {
    if (
      typeof run.output !== "string" ||
      run.output.length < MIN_MODEL_OUTPUT_CHARS ||
      run.output.length > MAX_MODEL_OUTPUT_CHARS
    ) {
      terminal = publicFailure(entry, "AI_OUTPUT_INVALID");
    } else {
      const success: PublicRunResult = {
        requestId: entry.requestId,
        jobId: entry.jobId,
        target: entry.target,
        status: "succeeded",
        modelOutput: run.output,
        promptMeta: entry.promptMeta,
      };
      terminal = validatePublicRunResult(success)
        ? success
        : publicFailure(entry, "AI_OUTPUT_INVALID");
    }
  } else if (run.status === "cancelled") {
    terminal = { requestId: entry.requestId, jobId: entry.jobId, target: entry.target, status: "cancelled" };
  } else {
    terminal = publicFailure(entry, "HERMES_RUN_FAILED");
  }
  await putEntry({ ...entry, stage: "terminal", terminal, updatedAt: Date.now() }, expectedEpoch);
  return terminal;
}

export async function stopLocalAiRun(payload: RunLookupPayload): Promise<PublicRunResult> {
  if (!isRunLookupPayload(payload)) throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Invalid stop payload");
  const expectedEpoch = registryEpoch;
  const registry = await readRegistry();
  const entry = registry[payload.requestId];
  if (!entry) throw new HermesApiError("HERMES_RUN_NOT_FOUND", "Run mapping is missing", { retryable: true });
  if (entry.stage === "terminal") return entry.terminal;
  if (entry.stage !== "active") throw new HermesApiError("RUN_START_UNKNOWN", "Hermes start state is ambiguous");
  const settings = await readSecretSettings();
  await makeApi(settings).stopRun(entry.runId);
  const stopping: RegistryEntry = { ...entry, lastStatus: "stopping", updatedAt: Date.now() };
  await putEntry(stopping, expectedEpoch);
  return publicActive(stopping, "stopping");
}

async function clearLocalAiRunRegistry(): Promise<void> {
  registryEpoch += 1;
  const operation = registryMutationQueue.then(() =>
    chrome.storage.session.remove(SESSION_STORAGE_KEYS.HERMES_RUN_REGISTRY)
  );
  registryMutationQueue = operation.catch(() => undefined);
  await operation;
}
