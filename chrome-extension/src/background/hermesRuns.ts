import { SESSION_STORAGE_KEYS, STORAGE_KEYS } from "@ext/shared/constants";
import { DEFAULT_HERMES_BASE, DEFAULT_HERMES_PROFILE_NAME, isHermesProfileName, normalizeHermesBase } from "@ext/shared/hermesBase";
import {
  MAX_MODEL_OUTPUT_CHARS,
  MIN_MODEL_OUTPUT_CHARS,
  isRepairRunPayload,
  isRunLookupPayload,
  isStartRunPayload,
  jsonByteLength,
  validatePublicRunResult,
  type HermesSettingsInput,
  type HermesSettingsPublic,
  type PublicLocalAiStatus,
  type PublicRunResult,
  type RepairRunPayload,
  type RunLookupPayload,
  type StartRunPayload,
} from "@ext/shared/hermesTypes";
import {
  fetchAiPromptEnvelope,
  fetchAiTriagePromptEnvelope,
  fetchLocalAiDefaults,
  pushLocalAiDefaults,
} from "./api";
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
// One bounded repair per run (spec: at most one AI repair). The in-flight map
// lives in worker memory: if the service worker restarts mid-repair the chat
// result is unrecoverable, so the poller fails the repair fast instead of
// leaving the page spinning.
const REPAIR_TIMEOUT_MS = 90_000;
const repairInFlight = new Map<string, Promise<void>>();
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
  | (RegistryBase & { stage: "terminal"; terminal: PublicRunResult; repaired?: true })
  | (RegistryBase & { stage: "repairing"; repairStartedAt: number });

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
  if (!isRecord(value) || value.requestId !== requestId) return false;
  // Rebuild the exact payload shape for validation: triage entries carry
  // jobIds and MUST include them here, or the reader discards a valid entry.
  const payloadShape =
    value.target === "triage"
      ? { requestId: value.requestId, jobId: value.jobId, target: value.target, jobIds: value.jobIds }
      : { requestId: value.requestId, jobId: value.jobId, target: value.target };
  if (!isStartRunPayload(payloadShape)) return false;
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
  if (value.stage === "repairing") {
    return typeof value.repairStartedAt === "number" && Number.isFinite(value.repairStartedAt);
  }
  if (value.stage === "terminal" && validatePublicRunResult(value.terminal)) {
    return (
      value.terminal.requestId === value.requestId &&
      value.terminal.jobId === value.jobId &&
      value.terminal.target === value.target &&
      (value.repaired === undefined || value.repaired === true)
    );
  }
  return false;
}

async function readRegistry(now = Date.now()): Promise<Registry> {
  const [localResult, legacyResult] = await Promise.all([
    chrome.storage.local.get(STORAGE_KEYS.HERMES_RUN_REGISTRY),
    chrome.storage.session.get(SESSION_STORAGE_KEYS.HERMES_RUN_REGISTRY),
  ]);
  const localRaw = localResult[STORAGE_KEYS.HERMES_RUN_REGISTRY];
  const legacyRaw = legacyResult[SESSION_STORAGE_KEYS.HERMES_RUN_REGISTRY];
  const raw = isRecord(localRaw) ? localRaw : legacyRaw;
  if (!isRecord(raw)) {
    if (localRaw !== undefined || legacyRaw !== undefined) {
      await writeRegistry({});
    }
    return {};
  }
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
  const requiresCleanup = Object.keys(registry).length !== Object.keys(raw).length;
  if (isRecord(legacyRaw) || requiresCleanup) {
    await writeRegistry(registry);
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
  await chrome.storage.local.set({ [STORAGE_KEYS.HERMES_RUN_REGISTRY]: bounded });
  await chrome.storage.session.remove(SESSION_STORAGE_KEYS.HERMES_RUN_REGISTRY);
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

function publicActive(
  entry: RegistryBase,
  status: "queued" | "running" | "stopping",
): Extract<PublicRunResult, { status: "queued" | "running" | "stopping" | "cancelled" }> {
  return { requestId: entry.requestId, jobId: entry.jobId, target: entry.target, status };
}

function publicFailure(
  entry: RegistryBase,
  code: "HERMES_RUN_FAILED" | "AI_OUTPUT_INVALID" | "UNEXPECTED_APPROVAL_REQUIRED" | "RUN_LOST",
): PublicRunResult {
  const message = code === "AI_OUTPUT_INVALID"
    ? "Hermes returned an invalid or oversized result."
    : code === "UNEXPECTED_APPROVAL_REQUIRED"
      ? "Hermes requested an approval that the Joblit profile must not use."
      : code === "RUN_LOST"
        ? "The local run can no longer be found on Hermes."
        : "Hermes could not complete this generation.";
  return {
    requestId: entry.requestId,
    jobId: entry.jobId,
    target: entry.target,
    status: "failed",
    error: { code, message, retryable: code === "HERMES_RUN_FAILED" },
  };
}

/** Best-effort prefill from Joblit for a fresh install (non-secret values only). */
async function fetchRemoteDefaults(): Promise<{ baseUrl: string; profileName: string } | null> {
  try {
    const auth = await getAuthStatus();
    if (!auth.authenticated) return null;
    const remote = await fetchLocalAiDefaults();
    if (!isRecord(remote)) return null;
    const baseUrl = normalizeHermesBase(remote.hermesEndpoint);
    if (!validProfileName(remote.hermesProfile)) return null;
    return { baseUrl, profileName: remote.hermesProfile };
  } catch {
    return null;
  }
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
  let profileName = hasValidProfile
    ? stored[STORAGE_KEYS.HERMES_PROFILE_NAME]
    : DEFAULT_HERMES_PROFILE_NAME;
  const hasApiKey = validApiKey(stored[STORAGE_KEYS.HERMES_API_KEY]);

  // Fresh install (no locally saved connection): prefill endpoint + profile
  // from the Joblit-synced defaults so the user only re-enters the API key.
  if (!hasValidBase && !hasValidProfile && !hasApiKey) {
    const remote = await fetchRemoteDefaults();
    if (remote) {
      baseUrl = remote.baseUrl;
      profileName = remote.profileName;
    }
  }

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
  // Sync the NON-SECRET connection defaults to Joblit so a future reinstall
  // prefills endpoint + profile. The API key never leaves the extension.
  void pushLocalAiDefaults({ hermesEndpoint: baseUrl, hermesProfile: input.profileName })
    .catch(() => undefined);
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
    if (code === "HERMES_ORIGIN_FORBIDDEN") return { state: "incompatible", joblitConnected: true, profileName: settings.profileName };
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
  const prompt = validatePositionIndependentPrompt(
    await (payload.target === "triage" && payload.jobIds
      ? fetchAiTriagePromptEnvelope({ jobIds: payload.jobIds })
      : fetchAiPromptEnvelope({ jobId: payload.jobId, target: payload.target })),
  );
  const now = Date.now();
  const base: RegistryBase = { ...payload, createdAt: now, updatedAt: now, promptMeta: prompt.promptMeta };
  await putEntry({ ...base, stage: "starting" }, expectedEpoch);

  let runId: string;
  try {
    ({ runId } = await makeApi(settings).startRun({
      input: prompt.input,
      instructions: prompt.instructions,
      session_id: `joblit:${payload.requestId}`,
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
  if (entry.stage === "repairing") {
    const lost = !repairInFlight.has(entry.requestId);
    const expired = Date.now() - entry.repairStartedAt > REPAIR_TIMEOUT_MS;
    if (lost || expired) {
      const terminal = publicFailure(entry, "AI_OUTPUT_INVALID");
      await putEntry({ ...entry, stage: "terminal", terminal, repaired: true, updatedAt: Date.now() }, expectedEpoch);
      return terminal;
    }
    return publicActive(entry, "running");
  }

  const settings = await readSecretSettings();
  let run;
  try {
    run = await makeApi(settings).getRun(entry.runId);
  } catch (error) {
    if (error instanceof HermesApiError && error.code === "HERMES_RUN_NOT_FOUND") {
      // Hermes garbage-collected the run before we could read its result.
      // Deleting the mapping here made every later GET_RUN a retryable
      // "not found" — an endless client retry loop. Converge to a sticky
      // terminal RUN_LOST instead so the page fails fast and moves on.
      const terminal = publicFailure(entry, "RUN_LOST");
      await putEntry({ ...entry, stage: "terminal", terminal, updatedAt: Date.now() }, expectedEpoch);
      return terminal;
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
    const base = publicActive(active, run.status);
    if (run.status === "running") {
      const progressChars = await makeApi(settings).peekRunProgress(entry.runId);
      if (progressChars !== null) return { ...base, progressChars };
    }
    return base;
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

function buildRepairMessage(feedback: string): string {
  return [
    "Your previous reply was rejected by Joblit's strict validator.",
    `Validator feedback: ${feedback}`,
    "Return the corrected result as exactly ONE JSON object with the same required keys.",
    "No code fences, no prose, no apologies. Preserve every correct part of your previous reply and change only what the feedback identifies.",
  ].join("\n");
}

export async function repairLocalAiRun(payload: RepairRunPayload): Promise<PublicRunResult> {
  if (!isRepairRunPayload(payload)) {
    throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Invalid repair payload");
  }
  const expectedEpoch = registryEpoch;
  const registry = await readRegistry();
  const entry = registry[payload.requestId];
  if (!entry) throw new HermesApiError("HERMES_RUN_NOT_FOUND", "Run mapping is missing", { retryable: true });
  if (entry.stage === "repairing") return publicActive(entry, "running");
  if (entry.stage !== "terminal" || entry.terminal.status !== "succeeded") {
    throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Only a succeeded run can be repaired");
  }
  if (entry.repaired) {
    throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Run was already repaired once");
  }

  const settings = await readSecretSettings();
  const repairing: RegistryEntry = {
    requestId: entry.requestId,
    jobId: entry.jobId,
    target: entry.target,
    createdAt: entry.createdAt,
    promptMeta: entry.promptMeta,
    stage: "repairing",
    repairStartedAt: Date.now(),
    updatedAt: Date.now(),
  };
  await putEntry(repairing, expectedEpoch);

  const operation = (async () => {
    let terminal: PublicRunResult;
    try {
      const content = await makeApi(settings).sessionChat(
        `joblit:${entry.requestId}`,
        buildRepairMessage(payload.feedback),
      );
      const success: PublicRunResult = {
        requestId: entry.requestId,
        jobId: entry.jobId,
        target: entry.target,
        status: "succeeded",
        modelOutput: content,
        promptMeta: entry.promptMeta,
      };
      terminal = validatePublicRunResult(success)
        ? success
        : publicFailure(repairing, "AI_OUTPUT_INVALID");
    } catch {
      terminal = publicFailure(repairing, "AI_OUTPUT_INVALID");
    }
    await mutateRegistry((current) => {
      const latest = current[entry.requestId];
      // Keep a cancel/stop that happened mid-repair; never resurrect the run.
      if (!latest || latest.stage !== "repairing") return;
      current[entry.requestId] = {
        ...latest,
        stage: "terminal",
        terminal,
        repaired: true,
        updatedAt: Date.now(),
      };
    }, expectedEpoch).catch(() => undefined);
  })().finally(() => repairInFlight.delete(entry.requestId));
  repairInFlight.set(entry.requestId, operation);

  return publicActive(repairing, "running");
}

export async function stopLocalAiRun(payload: RunLookupPayload): Promise<PublicRunResult> {
  if (!isRunLookupPayload(payload)) throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Invalid stop payload");
  const expectedEpoch = registryEpoch;
  const registry = await readRegistry();
  const entry = registry[payload.requestId];
  if (!entry) throw new HermesApiError("HERMES_RUN_NOT_FOUND", "Run mapping is missing", { retryable: true });
  if (entry.stage === "terminal") return entry.terminal;
  if (entry.stage === "repairing") {
    // The original run already completed; cancelling a repair just abandons it.
    const terminal: PublicRunResult = {
      requestId: entry.requestId,
      jobId: entry.jobId,
      target: entry.target,
      status: "cancelled",
    };
    await putEntry({ ...entry, stage: "terminal", terminal, repaired: true, updatedAt: Date.now() }, expectedEpoch);
    return terminal;
  }
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
    Promise.all([
      chrome.storage.local.remove(STORAGE_KEYS.HERMES_RUN_REGISTRY),
      chrome.storage.session.remove(SESSION_STORAGE_KEYS.HERMES_RUN_REGISTRY),
    ]).then(() => undefined)
  );
  registryMutationQueue = operation.catch(() => undefined);
  await operation;
}
