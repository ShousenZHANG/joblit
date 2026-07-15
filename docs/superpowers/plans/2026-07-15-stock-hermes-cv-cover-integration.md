# Stock Hermes CV/CL Local AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated Joblit user generate a grounded CV or cover letter in one click through the official, unmodified Hermes client running on the user's computer, then import the strict result as an editable Joblit DRAFT without exposing either Joblit or Hermes credentials to the page.

**Architecture:** The authenticated Joblit page sends only a bounded job ID, target, request ID, and nonce through an exact-origin `window.postMessage` bridge. A dedicated Joblit content script forwards allowlisted actions to the extension service worker. The worker fetches the canonical, self-contained prompt with the extension token, calls the loopback-only stock Hermes Runs API, polls and normalizes status, and returns a bounded result. Joblit strictly parses the local-AI result, persists it through the existing `manual-generate?finalize=false` route, and opens the existing full-screen DRAFT editor. No server-side `AiTask`, Hermes fork, generic proxy, page-visible token, or automatic ambiguous retry is introduced.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, Zod 4, next-intl, Chrome Extension Manifest V3, Chrome storage local/session APIs, stock Hermes `/v1/runs`, Vitest 4, Testing Library.

## Global Constraints

- Official Hermes only. Do not copy, patch, vendor, or fork Hermes runtime code.
- CV and cover letter only in this plan. Job matching is a separate follow-up plan.
- No Prisma migration and no `AiTask` record in the first release.
- The page never receives the Joblit extension token, Hermes API key, canonical prompt, Hermes `run_id`, or a generic fetch capability.
- The extension never accepts a caller-supplied URL or path. Every Joblit and Hermes route is a fixed constant.
- Hermes base URL must be loopback HTTP with a root path only: `127.0.0.1`, `localhost`, or `[::1]` plus an explicit valid port.
- A Hermes start request is not idempotent. An ambiguous POST becomes `RUN_START_UNKNOWN`; never retry it automatically.
- `waiting_for_approval` is invalid for the zero-tool Joblit profile. Stop the run and fail closed.
- Built-in Hermes memory, external memory providers, MCP, and executable toolsets remain disabled for the Joblit profile. Joblit's confirmed preference snapshot is authoritative.
- Local AI output uses strict JSON only. Legacy manual paste remains tolerant for backward compatibility.
- Local AI always lands as `DRAFT`; PDF/finalization remains an explicit user action in `TailorReviewDialog`.
- Preserve current manual Skill/copy/paste flow as a visible fallback.
- New user-facing strings go through `messages/en.json`, `messages/zh.json`, and the extension i18n dictionary.
- Implement each task test-first and commit only after its focused tests pass.

---

## Task 1: Make the canonical prompt self-contained and auth-agnostic

**Files:**

- Create: `lib/server/ai/resumePromptSnapshot.ts`
- Create: `lib/server/ai/resumePromptSnapshot.test.ts`
- Create: `lib/server/applications/applicationPrompt.ts`
- Create: `lib/server/applications/applicationPrompt.test.ts`
- Modify: `lib/server/ai/applicationPromptBuilder.ts`
- Modify: `lib/server/ai/applicationPromptBuilder.test.ts`
- Modify: `app/api/applications/prompt/route.ts`
- Modify: `test/api/applicationPrompt.test.ts`

**Contract:**

```ts
export const ApplicationPromptRequestSchema = z.object({
  jobId: z.string().uuid(),
  target: z.enum(["resume", "cover"]),
}).strict();

export interface ApplicationPromptPayload {
  requestId: string;
  prompt: { input: string; instructions: string; sessionId: string };
  promptMeta: Record<string, unknown>;
  expectedJsonShape: string;
  expectedJsonSchema: Record<string, unknown>;
  promptVersion: "v3-local-ai";
}

export async function buildApplicationPromptForUser(input: {
  userId: string;
  jobId: string;
  target: "resume" | "cover";
}): Promise<ApplicationPromptPayload>;
```

The candidate snapshot must be bounded and JSON-serializable, include only Joblit's relevant profile evidence (`basics.fullName`, `basics.title`, `summary`, `skills`, `experiences`, `projects`, `education`), omit email/phone/profile URLs and internal IDs, and preserve sanitized raw user content rather than LaTeX-escaped values. Both resume and cover prompts must embed it inside a delimited `<candidate-evidence>` block and treat candidate/JD blocks as untrusted data. Remove every instruction that tells the model to read `joblit-tailoring/context/resume-snapshot.json` or any local Skill Pack file.

- [ ] Write failing snapshot tests for deterministic ordering, field bounds, null omission, no Prisma/internal IDs, and no LaTeX escaping.
- [ ] Write failing prompt-builder tests proving both targets contain the candidate evidence, job evidence, strict output schema, and no local-file instruction.
- [ ] Implement `buildResumePromptSnapshot` with explicit per-field and total-size limits.
- [ ] Extract ownership lookup, profile/rules loading, Seek description upgrade, coverage calculation, prompt metadata, and prompt construction from the session route into `buildApplicationPromptForUser`.
- [ ] Keep route error semantics stable through a typed `ApplicationPromptError` with `INVALID_REQUEST`, `JOB_NOT_FOUND`, `NO_PROFILE`, and `PROMPT_TOO_LARGE` codes.
- [ ] Reduce `app/api/applications/prompt/route.ts` to `requireSession`, strict parse, service call, and existing JSON envelope.
- [ ] Run `npm test -- lib/server/ai/resumePromptSnapshot.test.ts lib/server/ai/applicationPromptBuilder.test.ts lib/server/applications/applicationPrompt.test.ts test/api/applicationPrompt.test.ts`.
- [ ] Commit with `git commit -m "refactor(ai): build self-contained application prompts"`.

## Task 2: Add the extension-authenticated canonical prompt endpoint

**Files:**

- Create: `app/api/ext/applications/prompt/route.ts`
- Create: `test/api/extApplicationPrompt.test.ts`
- Modify: `lib/server/rateLimit.ts` only if a new named limiter is required

**Request and response:**

```http
POST /api/ext/applications/prompt
Authorization: Bearer jfext_...
Content-Type: application/json

{"jobId":"<uuid>","target":"resume"}
```

The endpoint calls the same `buildApplicationPromptForUser` service as the session endpoint. It must re-check `Job.userId`, use `requireExtensionToken`, apply a per-user prompt rate limit, set `Cache-Control: no-store`, and return only the canonical prompt payload. It must never accept prompt text or a user ID from the extension.

- [ ] Write failing tests for missing/invalid token, strict body validation, ownership isolation, missing profile, both targets, `no-store`, and rate-limit response.
- [ ] Add a parity test showing the session and extension routes return equivalent prompt version/schema/metadata for the same mocked user and job.
- [ ] Implement the endpoint with the repository's existing `ExtensionTokenError` response pattern.
- [ ] Run `npm test -- test/api/applicationPrompt.test.ts test/api/extApplicationPrompt.test.ts`.
- [ ] Commit with `git commit -m "feat(api): expose canonical prompts to extension"`.

## Task 3: Enforce strict parsing for Local AI while preserving manual import

**Files:**

- Modify: `lib/server/applications/manualImportParser.ts`
- Modify: `lib/server/applications/manualImportParser.test.ts`
- Modify: `lib/server/applications/manualImportArtifact.ts`
- Modify: `lib/server/applications/manualImportArtifact.test.ts`
- Modify: `app/api/applications/manual-generate/route.ts`
- Modify: `test/api/applicationManualGenerate.test.ts`
- Modify: `app/(app)/jobs/types.ts`

**Contract:**

```ts
const ManualGenerateSchema = z.object({
  jobId: z.string().uuid(),
  target: z.enum(["resume", "cover"]),
  modelOutput: z.string().min(1).max(80_000),
  promptMeta: z.record(z.string(), z.unknown()).optional(),
  source: z.enum(["manual_import", "local_ai"]).default("manual_import"),
}).strict();

export function buildManualImportArtifact(input: {
  target: "resume" | "cover";
  modelOutput: string;
  mode: "legacy" | "strict";
}): ParsedArtifact;
```

Strict mode performs one `JSON.parse` followed by the current strict Zod output schema. It rejects fenced JSON, aliases, snake_case compatibility keys, trailing commas, smart-quote repair, flat cover aliases, and unknown keys. `source` chooses parsing policy only; it grants no authorization.

- [ ] Add red tests showing legacy mode still accepts currently supported compatibility input.
- [ ] Add red tests showing local-AI mode returns stable `INVALID_AI_RESULT` for fences, aliases, trailing commas, unknown keys, and over-limit output.
- [ ] Implement strict resume and cover parsers without normalization or repair.
- [ ] Include `source: "local_ai" | "manual_import"` in persisted provenance where the existing content schema supports source metadata; do not add a DB column.
- [ ] Pass the server-validated canonical `promptMeta.promptHash` into `buildManualImportArtifact` and persist it as non-empty `aiContent.promptMetaHash`; never trust a replacement hash supplied only by the page.
- [ ] Extend the DRAFT response with authoritative `job: {id,title,company,location}` so refresh recovery does not depend on an in-memory `JobItem`.
- [ ] Keep `finalize=false` behavior: no PDF render, no blob upload, no final content write.
- [ ] Run `npm test -- lib/server/applications/manualImportParser.test.ts lib/server/applications/manualImportArtifact.test.ts test/api/applicationManualGenerate.test.ts`.
- [ ] Commit with `git commit -m "feat(ai): enforce strict local output imports"`.

## Task 4: Define and test the browser bridge contract

**Files:**

- Create: `lib/shared/localAiBridgeContract.ts`
- Create: `lib/shared/localAiBridgeContract.test.ts`
- Create: `lib/client/localAiBridge.ts`
- Create: `lib/client/localAiBridge.test.ts`
- Create: `chrome-extension/src/shared/hermesTypes.ts`
- Create: `chrome-extension/src/shared/hermesTypes.test.ts`

**Wire protocol:**

```ts
type BridgeAction = "GET_STATUS" | "START_RUN" | "GET_RUN" | "STOP_RUN";

interface BridgeRequest {
  channel: "joblit.hermes.v1";
  direction: "web-to-extension";
  version: 1;
  messageId: string;
  nonce: string;
  issuedAt: number;
  action: BridgeAction;
  payload: unknown;
}

interface StartPayload {
  requestId: string;
  jobId: string;
  target: "resume" | "cover";
}
```

`GET_STATUS` has no caller-controlled connection details. `GET_RUN` and `STOP_RUN` accept only `requestId`. Public run results never contain the Hermes `run_id`, prompt, endpoint, or credentials. A successful terminal result is `{requestId,status:"succeeded",jobId,target,modelOutput,promptMeta}`. Stable errors contain `{code,message,retryable}`.

- [ ] Write red guard tests for valid messages and rejection of wrong channel/direction/version, expired/future timestamps, malformed UUIDs, unknown actions, extra fields, oversized payloads, invalid status, and oversized output.
- [ ] Implement equivalent strict guards on both web and extension sides.
- [ ] Write transport tests for exact origin, `event.source === window`, matching message ID and nonce, timeout cleanup, duplicate response suppression, and abort cleanup.
- [ ] Implement a single `window.postMessage` client; do not add DOM events, `externally_connectable`, or a page-injected script.
- [ ] Run `npm test -- lib/shared/localAiBridgeContract.test.ts lib/client/localAiBridge.test.ts`.
- [ ] Run `npm --prefix chrome-extension test -- src/shared/hermesTypes.test.ts`.
- [ ] Commit with `git commit -m "feat(ai): define secure local bridge contract"`.

## Task 5: Lock extension storage before exposing the Joblit bridge

**Files:**

- Create: `chrome-extension/src/background/storageSecurity.ts`
- Create: `chrome-extension/src/background/storageSecurity.test.ts`
- Modify: `chrome-extension/test/setup.ts`
- Modify: `chrome-extension/src/shared/constants.ts`
- Modify: `chrome-extension/src/shared/types.ts`
- Modify: `chrome-extension/src/background/service-worker.ts`
- Modify: `chrome-extension/src/background/service-worker.test.ts`
- Modify: `chrome-extension/src/content/index.ts`
- Modify: `chrome-extension/src/content/index.behavior.test.ts`
- Modify: `chrome-extension/src/content/widget/mount.ts`
- Modify: `chrome-extension/src/content/widget/mount.test.ts`
- Modify: `chrome-extension/src/content/widget/FloatingWidget.ts`
- Modify: `chrome-extension/src/content/widget/FloatingWidget.test.ts`

Storage keys add `HERMES_API_BASE`, `HERMES_API_KEY`, `HERMES_PROFILE_NAME`, and `WIDGET_POSITION`. Session storage holds the bounded run registry. The service worker must call `chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"})` before handling any message or processing the sync queue.

- [ ] Extend Chrome mocks with `storage.local.setAccessLevel`, `storage.session`, storage listeners, sender URLs, and manifest access.
- [ ] Write a failing fail-closed readiness test: if access-level restriction fails, no secret-bearing operation runs.
- [ ] Add background-only `GET_CONTENT_SETTINGS` and `SET_WIDGET_POSITION` messages returning only non-secret preferences/position.
- [ ] Migrate `content/index.ts` preference reads to `GET_CONTENT_SETTINGS`.
- [ ] Inject initial widget position into `mount.ts`; inject `onSavePosition` into `FloatingWidget`; remove every content-script `chrome.storage.local` read/write.
- [ ] Add tests proving content scripts cannot request auth or Hermes keys through the new RPC.
- [ ] Make queue startup and `online` processing await the same readiness promise.
- [ ] Run `npm --prefix chrome-extension test -- src/background/storageSecurity.test.ts src/background/service-worker.test.ts src/content/index.behavior.test.ts src/content/widget/mount.test.ts src/content/widget/FloatingWidget.test.ts`.
- [ ] Commit with `git commit -m "security(extension): restrict credential storage access"`.

## Task 6: Implement the fixed-route loopback Hermes client

**Files:**

- Create: `chrome-extension/src/shared/hermesBase.ts`
- Create: `chrome-extension/src/shared/hermesBase.test.ts`
- Create: `chrome-extension/src/background/hermesApi.ts`
- Create: `chrome-extension/src/background/hermesApi.test.ts`
- Modify: `chrome-extension/src/background/apiErrors.ts`
- Modify: `chrome-extension/src/background/apiErrors.test.ts`

**Client surface:**

```ts
interface HermesApi {
  probe(): Promise<HermesProbeResult>;
  startRun(body: {input: string; instructions: string; session_id: string}): Promise<{runId: string}>;
  getRun(runId: string): Promise<HermesRun>;
  stopRun(runId: string): Promise<void>;
}
```

The base normalizer accepts only root loopback HTTP URLs and produces the exact optional permission origin pattern. `probe()` checks `/health` for liveness and authenticated `/v1/capabilities`, `/v1/models`, and `/v1/toolsets` for API compatibility. It must not claim that these endpoints attest the active OAuth provider, model runtime, inherited MCP, or Codex-native tools.

- [ ] Write a URL acceptance matrix covering all loopback forms and rejection of credentials, query, fragment, non-root path, default/public hosts, LAN IPs, deceptive hostnames, HTTPS, and invalid ports.
- [ ] Write failing fetch tests for fixed paths, bearer header, `redirect:"error"`, timeout, non-JSON, content-length cap, streamed text cap, malformed schemas, 401, 404, 429, and 5xx.
- [ ] Implement stable errors: `HERMES_UNREACHABLE`, `HERMES_AUTH_FAILED`, `HERMES_INCOMPATIBLE`, `HERMES_RATE_LIMITED`, `HERMES_RESPONSE_TOO_LARGE`, and `HERMES_PROTOCOL_ERROR`.
- [ ] Accept only stock statuses `queued`, `running`, `waiting_for_approval`, `stopping`, `completed`, `failed`, and `cancelled`.
- [ ] Ensure no helper accepts an arbitrary pathname, method, headers, or request body from a page message.
- [ ] Run `npm --prefix chrome-extension test -- src/shared/hermesBase.test.ts src/background/hermesApi.test.ts src/background/apiErrors.test.ts`.
- [ ] Commit with `git commit -m "feat(extension): add hardened Hermes loopback client"`.

## Task 7: Orchestrate stock Hermes runs in the service worker

**Files:**

- Create: `chrome-extension/src/background/hermesRuns.ts`
- Create: `chrome-extension/src/background/hermesRuns.test.ts`
- Modify: `chrome-extension/src/background/api.ts`
- Modify: `chrome-extension/src/background/api.test.ts`
- Modify: `chrome-extension/src/background/auth.ts`
- Modify: `chrome-extension/src/background/auth.test.ts`
- Modify: `chrome-extension/src/background/service-worker.ts`
- Modify: `chrome-extension/src/background/service-worker.test.ts`

The worker fetches `POST /api/ext/applications/prompt` with the existing extension token, creates one deterministic Hermes `session_id` from the configured opaque profile name plus request ID, and stores request state in `chrome.storage.session`. Registry entries have a size limit and expire after one hour.

- [ ] Add `fetchAiPromptEnvelope({jobId,target})` to the existing Joblit API module using its private authenticated fetch path.
- [ ] Write red run tests for normal start/poll/success, failure, cancellation, service-worker restart recovery, expired mapping, run 404, output bounds, and prompt metadata preservation.
- [ ] Add an in-memory promise lock per `requestId` plus a persisted pre-POST `starting` marker.
- [ ] On successful 202, atomically replace `starting` with the stock `run_id`. On transport ambiguity, write `unknown` and return `RUN_START_UNKNOWN`; never issue another POST for that request ID.
- [ ] Map Hermes 404 after start to `RUN_LOST`. Map `waiting_for_approval` to a fail-closed stop plus `UNEXPECTED_APPROVAL_REQUIRED`.
- [ ] Cache one bounded terminal result so a page refresh can consume it, but return it idempotently and never re-import automatically twice.
- [ ] Make service-worker handlers validate sender context: web run actions require an exact Joblit tab URL; settings actions require an extension-page sender.
- [ ] On Joblit account disconnect, clear Joblit run mappings and terminal results. Keep Hermes connection settings independent; `Forget Hermes` clears them explicitly.
- [ ] Run `npm --prefix chrome-extension test -- src/background/api.test.ts src/background/hermesRuns.test.ts src/background/service-worker.test.ts src/background/auth.test.ts`.
- [ ] Commit with `git commit -m "feat(extension): orchestrate local Hermes runs"`.

## Task 8: Add the exact-origin Joblit content bridge

**Files:**

- Create: `chrome-extension/src/content/joblitBridge.ts`
- Create: `chrome-extension/src/content/joblitBridge.test.ts`
- Modify: `chrome-extension/manifest.json`
- Modify: `chrome-extension/test/manifest.test.ts`

The new content script runs at `document_start` on `https://www.joblit.tech/*`, top frame only. Keep existing ATS script at `content_scripts[0]` and Seek MAIN-world interceptor at `[1]` because `tabBridge.ts` currently depends on index zero. Append the Joblit bridge after them. Do not add `all_frames`, `externally_connectable`, `<all_urls>`, public HTTPS permissions, or a MAIN-world bridge.

- [ ] Write manifest tests first: exact production match, `document_start`, isolated world default, no `all_frames`, no `externally_connectable`, and unchanged ATS/Seek indices.
- [ ] Write bridge tests for exact origin, top frame, source/direction/version/schema checks, TTL, replay cache, rate limit, request/response size caps, and stable error redaction.
- [ ] Forward only `GET_STATUS`, `START_RUN`, `GET_RUN`, and `STOP_RUN` to the background.
- [ ] Never forward settings actions, arbitrary message types, prompt text, tokens, endpoints, or Hermes `run_id`.
- [ ] Add `minimum_chrome_version: "102"` for storage access-level and session-storage support.
- [ ] Run `npm --prefix chrome-extension test -- src/content/joblitBridge.test.ts test/manifest.test.ts`.
- [ ] Commit with `git commit -m "feat(extension): bridge Joblit to local AI"`.

## Task 9: Build a compact Local AI settings experience in the extension

**Files:**

- Modify: `chrome-extension/src/popup/pages/Options.tsx`
- Modify: `chrome-extension/src/popup/pages/Options.test.tsx`
- Modify: `chrome-extension/src/popup/styles.css`
- Modify: `chrome-extension/src/shared/i18n.ts`
- Modify: `chrome-extension/src/shared/types.ts`
- Modify: `chrome-extension/src/background/service-worker.ts`

The Local AI Beta card shows `Not configured`, `Checking`, `Hermes unavailable`, `Authentication failed`, `Incompatible`, or `Ready`. It contains loopback endpoint, password-style API key, expected Joblit profile name, and `Test & save` / `Forget` actions. The API key is never returned to React after saving; settings reads expose only `hasApiKey`.

- [ ] Write interaction tests for first load, hidden key, valid save, invalid endpoint, permission denied, failed probe, success, re-check, and forget.
- [ ] Request only the normalized loopback origin permission, and only inside the user's save/test click.
- [ ] Save credentials only after URL validation, permission grant, and authenticated compatibility probe succeed.
- [ ] Keep the form compact: one primary action, inline status, progressive disclosure for endpoint/key, visible keyboard focus, reduced-motion-safe transitions, and `aria-live="polite"` status.
- [ ] Add English and Chinese strings for every state/error; do not expose raw server text.
- [ ] Run `npm --prefix chrome-extension test -- src/popup/pages/Options.test.tsx src/background/service-worker.test.ts`.
- [ ] Commit with `git commit -m "feat(extension): add Local AI setup experience"`.

## Task 10: Integrate one-click Local AI into Jobs CV/CL generation

**Files:**

- Create: `app/(app)/jobs/hooks/useLocalAiRun.ts`
- Create: `app/(app)/jobs/hooks/useLocalAiRun.test.tsx`
- Create: `app/(app)/jobs/components/LocalAiGenerateDialog.tsx`
- Create: `app/(app)/jobs/components/LocalAiGenerateDialog.test.tsx`
- Modify: `app/(app)/jobs/hooks/useExternalGenerate.ts`
- Modify: `app/(app)/jobs/JobsClient.tsx`
- Modify: `app/(app)/jobs/JobsClient.test.tsx`
- Modify: `app/(app)/jobs/components/JobDetailPanel.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

`useLocalAiRun` exposes `availability`, `runState`, `start`, `stop`, `retry`, and `reset`. It polls one request at a time at 750 ms, stores only the active public request ID in `sessionStorage`, restores after refresh, and consumes a successful terminal result once. It must not poll in a hidden unmounted dialog or create overlapping timers.

- [ ] Write hook tests for extension missing, setup required, start, queued/running, success, stop, retryable failure, `RUN_START_UNKNOWN`, `RUN_LOST`, refresh recovery, timeout cleanup, and one-time terminal consumption.
- [ ] Extract `persistGeneratedDraft({jobId,target,modelOutput,promptMeta,source})` from `useExternalGenerate`; manual uses `manual_import`, local uses `local_ai`.
- [ ] Make the draft importer rely on the authoritative server response job metadata, not the pre-refresh `JobItem` object.
- [ ] Write dialog tests for direct start, Starting/Queued/Running/Importing stages, `aria-live`, cancel, retry, close guard while importing, and `Use manual method` fallback.
- [ ] Make Local AI the primary CV/CL action when `Ready`; if unavailable, show a single setup action plus manual fallback rather than a dead button.
- [ ] On success, post exactly once to `/api/applications/manual-generate?finalize=false`, then open the existing full-screen `TailorReviewDialog` with DRAFT content.
- [ ] Preserve the current `ExternalGenerateDialog` unchanged as fallback except for shared draft-import extraction.
- [ ] Add localized stable error mapping; never display raw Hermes responses or stack traces.
- [ ] Run `npm test -- "app/(app)/jobs/hooks/useLocalAiRun.test.tsx" "app/(app)/jobs/components/LocalAiGenerateDialog.test.tsx" "app/(app)/jobs/JobsClient.test.tsx"`.
- [ ] Commit with `git commit -m "feat(jobs): generate CV and cover with local AI"`.

## Task 11: Add website setup visibility without collecting local secrets

**Files:**

- Create: `app/(app)/extension/LocalAiSetupCard.tsx`
- Create: `app/(app)/extension/LocalAiSetupCard.test.tsx`
- Modify: `app/(app)/extension/page.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

The website card uses only `GET_STATUS` and displays `Detecting`, `Extension missing`, `Joblit disconnected`, `Hermes setup required`, or `Local AI Ready`. It offers `Check again`, extension installation guidance, and an extension-settings action. The website must never render or accept a Hermes endpoint/key field.

- [ ] Write state and accessibility tests before the component.
- [ ] Add bounded detection timeout and re-check behavior.
- [ ] Place the card before the existing extension token manager, while preserving the current token workflow.
- [ ] Add an explicit Beta disclosure: local Hermes availability is checked on this browser only.
- [ ] Run `npm test -- "app/(app)/extension/LocalAiSetupCard.test.tsx"`.
- [ ] Commit with `git commit -m "feat(extension): surface Local AI readiness"`.

## Task 12: Cross-boundary verification, review, and release hardening

**Files:**

- Modify: `.github/workflows/ci.yml` only if focused checks are not already covered
- Modify: `README.md`
- Modify: `docs/adr/0004-hybrid-local-ai-runtime.md` only for implementation-truth corrections
- Modify: `docs/superpowers/specs/2026-07-15-ai-native-joblit-platform-design.md` only for implementation-truth corrections

- [ ] Run focused web API tests: `npm test -- test/api/applicationPrompt.test.ts test/api/extApplicationPrompt.test.ts test/api/applicationManualGenerate.test.ts`.
- [ ] Run focused web client tests: `npm test -- lib/client/localAiBridge.test.ts "app/(app)/jobs/hooks/useLocalAiRun.test.tsx" "app/(app)/jobs/components/LocalAiGenerateDialog.test.tsx" "app/(app)/jobs/JobsClient.test.tsx" "app/(app)/extension/LocalAiSetupCard.test.tsx"`.
- [ ] Run all extension tests: `npm --prefix chrome-extension test`.
- [ ] Run extension coverage and build: `npm --prefix chrome-extension run test:coverage` then `npm --prefix chrome-extension run build`.
- [ ] Run root quality gates: `npm run deadcode`, `npm run lint`, `npm run test:coverage`, and `npm run build`.
- [ ] Search for forbidden exposure: `rg -n "HERMES_API_KEY|API_SERVER_KEY|run_id|canonicalPrompt|externally_connectable|<all_urls>" app lib chrome-extension/src chrome-extension/manifest.json` and review every hit.
- [ ] Inspect `git diff --check`, `git status --short`, and the full diff for unrelated/user changes.
- [ ] Request an independent code review focused on origin validation, storage boundaries, ambiguous run starts, strict parsing, timer cleanup, and DRAFT-only persistence.
- [ ] Resolve all high/medium findings and rerun affected tests.
- [ ] Update docs to say `Hermes Local AI Beta`, stock Hermes only, loopback only, no memory in first release, and manual fallback available.
- [ ] Commit final integration with `git commit -m "feat(ai): ship stock Hermes CV and cover workflow"`.

## Acceptance Criteria

- An authenticated user with the extension and configured stock Hermes can generate CV or CL from Jobs with one primary action.
- The result is strictly schema-valid, grounded by a self-contained candidate/job evidence prompt, saved once as DRAFT, and opened in the existing editor.
- Refresh during a run can recover from extension session state; a lost Hermes run returns a clear recoverable error.
- An ambiguous Hermes start is never automatically duplicated.
- The page cannot read either token, the canonical prompt, Hermes endpoint, or Hermes `run_id`.
- Content scripts cannot read `chrome.storage.local` secrets after `TRUSTED_CONTEXTS` is enabled.
- Manual Skill/copy/paste import still works with its existing tolerant compatibility behavior.
- No database migration, server-side AI task, Hermes code fork, generic proxy, external memory, or MCP capability is added.
- Root and extension CI-equivalent gates pass.
