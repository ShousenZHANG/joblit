# Joblit Production Readiness and UI/UX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the verified extension privacy and security gaps, make landing claims and interactions trustworthy and accessible, and add production release gates without changing Joblit's existing business flow or visual identity.

**Architecture:** Implement bounded vertical slices behind small pure helpers: a privacy-aware content-script bridge, a shared API-base normalizer, a server submission validator, an atomic token-activity throttle, and landing interaction fixes protected by component tests. CI then runs every product surface, including extension coverage and build, before the final production build.

**Tech Stack:** Next.js 16, React 19, next-intl, Prisma 7, Manifest V3, CRXJS/Vite 8, TypeScript 5, Vitest 4, GitHub Actions.

## Global Constraints

- Preserve existing information architecture, business workflows, warm-ivory/emerald visual identity, and motion character.
- Mobile compact controls and footer links use a minimum 44-pixel interaction area.
- Public API bases require HTTPS; HTTP is allowed only for localhost loopback development.
- Sensitive credential, verification, payment, banking, and government-identifier fields are never detected, captured, queued, or accepted by the server.
- `lastUsedAt` writes occur at most once per token per five-minute interval.
- Compatible patch/minor dependency updates are allowed; major migrations are excluded.
- Every behavior change follows red-green-refactor; configuration-only changes require their exact verification command.

---

## File Structure

- `chrome-extension/src/shared/jobContext.ts`: pure recognized-job-context predicate shared by detection and recording.
- `chrome-extension/src/shared/sensitiveFields.ts`: pure DOM-field sensitivity classifier and filter.
- `chrome-extension/src/shared/apiBase.ts`: URL normalization plus exact optional-host-permission request.
- `chrome-extension/src/background/tabBridge.ts`: ping, on-demand content-script injection, and active-tab messaging.
- `chrome-extension/src/background/apiErrors.ts`: typed HTTP failures and retryability classification.
- `lib/server/extensionSubmissionPayload.ts`: server-side schema, size limits, and sensitive-key rejection.
- Existing landing components remain separate; no layout component is merged or rewritten.

### Task 1: Extension form privacy and least-privilege injection

**Files:**
- Create: `chrome-extension/src/shared/jobContext.ts`
- Create: `chrome-extension/src/shared/jobContext.test.ts`
- Create: `chrome-extension/src/shared/sensitiveFields.ts`
- Create: `chrome-extension/src/shared/sensitiveFields.test.ts`
- Create: `chrome-extension/src/background/tabBridge.ts`
- Create: `chrome-extension/src/background/tabBridge.test.ts`
- Create: `chrome-extension/test/manifest.test.ts`
- Modify: `chrome-extension/manifest.json`
- Modify: `chrome-extension/src/shared/types.ts`
- Modify: `chrome-extension/src/content/detector/formDetector.ts`
- Modify: `chrome-extension/src/content/detector/formDetector.test.ts`
- Modify: `chrome-extension/src/content/recorder/submissionRecorder.ts`
- Modify: `chrome-extension/src/content/recorder/submissionRecorder.test.ts`
- Modify: `chrome-extension/src/content/index.ts`
- Modify: `chrome-extension/src/background/service-worker.ts`
- Modify: `chrome-extension/src/popup/pages/Dashboard.tsx`
- Modify: `chrome-extension/test/setup.ts`

**Interfaces:**
- Produces: `isJobApplicationContext(url: string): boolean`.
- Produces: `isSensitiveField(element: HTMLElement): boolean` and `filterSafeFields(fields: DetectedField[]): DetectedField[]`.
- Produces: `sendToActiveTab<T>(message: ContentMessage): Promise<T>`.
- Consumes: the built first `content_scripts` entry returned by `chrome.runtime.getManifest()` for on-demand injection.

- [ ] **Step 1: Write failing context and sensitive-field tests**

```ts
expect(isJobApplicationContext("https://boards.greenhouse.io/acme/jobs/1")).toBe(true);
expect(isJobApplicationContext("https://careers.example.com/jobs/1")).toBe(true);
expect(isJobApplicationContext("https://bank.example.com/login")).toBe(false);

for (const html of [
  '<input type="password" name="password">',
  '<input autocomplete="one-time-code" name="otp">',
  '<input autocomplete="cc-number" name="card">',
  '<input name="tax_file_number" aria-label="TFN">',
]) {
  document.body.innerHTML = html;
  expect(isSensitiveField(document.querySelector("input")!)).toBe(true);
}
```

- [ ] **Step 2: Run the new tests and verify RED**

Run: `npm --prefix chrome-extension test -- src/shared/jobContext.test.ts src/shared/sensitiveFields.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement pure context and field-safety helpers**

```ts
const KNOWN_ATS_HOSTS = [
  /(^|\.)greenhouse\.io$/i,
  /(^|\.)lever\.co$/i,
  /(^|\.)myworkdayjobs\.com$/i,
  /(^|\.)workday\.com$/i,
  /(^|\.)icims\.com$/i,
  /(^|\.)successfactors\.com$/i,
  /(^|\.)taleo\.net$/i,
  /(^|\.)smartrecruiters\.com$/i,
  /(^|\.)bamboohr\.com$/i,
  /(^|\.)jobvite\.com$/i,
  /(^|\.)ashbyhq\.com$/i,
  /(^|\.)rippling\.com$/i,
  /(^|\.)seek\.com$/i,
];

const JOB_PATH = /(?:^|\/)(?:careers?|jobs?|apply|application|positions?|vacancies?|openings?)(?:\/|$)/i;

export function isJobApplicationContext(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return KNOWN_ATS_HOSTS.some((pattern) => pattern.test(url.hostname)) || JOB_PATH.test(url.pathname);
  } catch {
    return false;
  }
}
```

`isSensitiveField` must inspect input type, autocomplete tokens, name, id, placeholder, label/ARIA text, and deny credential, OTP, card, bank, tax, passport, licence, social-security, and national-id signals. `filterSafeFields` applies the predicate to adapter and generic results alike.

- [ ] **Step 4: Add detector and recorder regression tests**

```ts
it("never detects credential or payment fields", () => {
  document.body.innerHTML = `<form>
    <input type="email" name="email">
    <input type="password" name="password">
    <input autocomplete="one-time-code" name="otp">
    <input autocomplete="cc-number" name="card_number">
  </form>`;
  const result = detectForms(document);
  expect(result.fields.map((field) => field.name)).toEqual(["email"]);
});

it("filters sensitive fields even when an adapter passes them in", () => {
  const snapshot = captureFieldSnapshot([safeEmail, passwordField, otpField]);
  expect(snapshot).toEqual({ email: "person@example.com" });
});
```

- [ ] **Step 5: Run detector and recorder tests and verify RED**

Run: `npm --prefix chrome-extension test -- src/content/detector/formDetector.test.ts src/content/recorder/submissionRecorder.test.ts`

Expected: FAIL because current detection and capture include sensitive fields.

- [ ] **Step 6: Apply defense-in-depth filtering and context gating**

`detectFields` filters both adapter and generic results. `captureFieldSnapshot`, `buildFieldMappings`, and `recordSubmission` filter again. `interceptFormSubmits` returns a no-op outside `isJobApplicationContext(window.location.href)`. `index.ts` registers the content-message listener first, returns `JOBLIT_PONG` for `JOBLIT_PING`, and exits before retries/observer/widget/interception when the page is not a recognized automatic context. Add a `globalThis` sentinel so static and dynamic injection cannot initialize twice.

- [ ] **Step 7: Write failing manifest and active-tab bridge tests**

```ts
expect(manifest.host_permissions).toEqual(["https://www.joblit.tech/*"]);
expect(manifest.optional_host_permissions).toContain("https://*/*");
expect(manifest.content_scripts[0].matches).not.toContain("https://*/*");
expect(manifest.content_scripts[0].all_frames).not.toBe(true);
```

The bridge test first makes `tabs.sendMessage(JOBLIT_PING)` reject, verifies one `scripting.executeScript` call with the first built content-script entry, then verifies the requested fill message is forwarded. A second successful ping must skip injection.

- [ ] **Step 8: Run manifest and bridge tests and verify RED**

Run: `npm --prefix chrome-extension test -- test/manifest.test.ts src/background/tabBridge.test.ts`

Expected: FAIL because wildcard required access remains and the bridge does not exist.

- [ ] **Step 9: Implement least-privilege manifest and message bridge**

The main static content script matches supported ATS hosts plus `https://au.seek.com/*`, has no `all_frames`, and required `host_permissions` contains only `https://www.joblit.tech/*`. Keep `activeTab` and `scripting`. Add optional HTTPS and loopback HTTP host patterns.

```ts
export async function sendToActiveTab<T>(message: ContentMessage): Promise<T> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "JOBLIT_PING" });
  } catch {
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
    if (files.length === 0) throw new Error("Joblit content script is unavailable.");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
  }
  return chrome.tabs.sendMessage(tab.id, message) as Promise<T>;
}
```

Popup Fill/Toggle and keyboard commands call the background bridge, not tabs directly.

- [ ] **Step 10: Verify the full privacy slice**

Run: `npm --prefix chrome-extension test`

Expected: all extension tests pass, including the new privacy and manifest regressions.

- [ ] **Step 11: Commit**

```bash
git add chrome-extension
git commit -m "fix(extension): enforce least-privilege form access"
```

### Task 2: Secure extension API-base configuration

**Files:**
- Create: `chrome-extension/src/shared/apiBase.ts`
- Create: `chrome-extension/src/shared/apiBase.test.ts`
- Modify: `chrome-extension/src/background/api.ts`
- Modify: `chrome-extension/src/popup/pages/TokenSetup.tsx`
- Modify: `chrome-extension/src/popup/pages/Options.tsx`
- Modify: `chrome-extension/src/shared/i18n.ts`
- Modify: `chrome-extension/test/setup.ts`

**Interfaces:**
- Produces: `normalizeApiBase(value: unknown, fallback?: string): string` throwing `ApiBaseValidationError` for explicit invalid values.
- Produces: `requestApiBasePermission(base: string): Promise<boolean>`.
- Consumes: `DEFAULT_API_BASE` and the optional host patterns declared in Task 1.

- [ ] **Step 1: Write the failing normalization tests**

```ts
expect(normalizeApiBase("")).toBe(DEFAULT_API_BASE);
expect(normalizeApiBase("https://jobs.example.com/api///")).toBe("https://jobs.example.com/api");
expect(normalizeApiBase("http://localhost:3000/")).toBe("http://localhost:3000");
expect(() => normalizeApiBase("http://jobs.example.com")).toThrow(/HTTPS/);
expect(() => normalizeApiBase("https://user:pass@example.com")).toThrow(/credentials/);
expect(() => normalizeApiBase("https://example.com?token=x")).toThrow(/query/);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm --prefix chrome-extension test -- src/shared/apiBase.test.ts`

Expected: FAIL because `apiBase.ts` does not exist.

- [ ] **Step 3: Implement normalization and exact permission request**

Parse an absolute URL, allow HTTPS or loopback HTTP, reject credentials/query/hash, normalize trailing slashes, and request `${new URL(base).origin}/*` only when it differs from the production origin. A denied request returns `false` without changing storage.

- [ ] **Step 4: Integrate popup validation and background fallback**

Token setup and Options catch `ApiBaseValidationError`, display `t("error.apiBaseInvalid")`, clear it on edit, and persist only after permission succeeds. Background `getApiBase` normalizes stored data and falls back to `DEFAULT_API_BASE` if legacy storage is invalid.

- [ ] **Step 5: Verify GREEN**

Run: `npm --prefix chrome-extension test -- src/shared/apiBase.test.ts`

Expected: all API-base cases pass.

- [ ] **Step 6: Commit**

```bash
git add chrome-extension/src chrome-extension/test/setup.ts
git commit -m "fix(extension): validate self-hosted API origins"
```

### Task 3: Submission payload and retry defenses

**Files:**
- Create: `chrome-extension/src/background/apiErrors.ts`
- Create: `chrome-extension/src/background/apiErrors.test.ts`
- Create: `lib/server/extensionSubmissionPayload.ts`
- Create: `lib/server/extensionSubmissionPayload.test.ts`
- Modify: `chrome-extension/src/background/api.ts`
- Modify: `chrome-extension/src/background/service-worker.ts`
- Modify: `chrome-extension/src/background/syncProcessor.ts`
- Modify: `app/api/ext/submissions/route.ts`

**Interfaces:**
- Produces: `ApiRequestError(status: number, message: string)` and `isRetryableApiError(error: unknown): boolean`.
- Produces: `CreateSubmissionSchema`, capped at 200 fields, 200-character keys, 10,000-character values, and a 250-KiB serialized payload.

- [ ] **Step 1: Write failing retry classification tests**

```ts
expect(isRetryableApiError(new TypeError("Failed to fetch"))).toBe(true);
expect(isRetryableApiError(new ApiRequestError(429, "rate limited"))).toBe(true);
expect(isRetryableApiError(new ApiRequestError(503, "unavailable"))).toBe(true);
expect(isRetryableApiError(new ApiRequestError(401, "unauthorized"))).toBe(false);
expect(isRetryableApiError(new ApiRequestError(400, "invalid"))).toBe(false);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm --prefix chrome-extension test -- src/background/apiErrors.test.ts`

Expected: FAIL because the typed error module is missing.

- [ ] **Step 3: Implement typed API errors and queue policy**

All non-OK API responses throw `ApiRequestError`. Service-worker and sync-processor enqueue or retain only retryable errors. Permanent failures return an error and remove an already-queued item instead of retrying five times.

- [ ] **Step 4: Write failing server payload tests**

```ts
expect(CreateSubmissionSchema.safeParse(validPayload).success).toBe(true);
expect(CreateSubmissionSchema.safeParse({ ...validPayload, fieldValues: { password: "secret" } }).success).toBe(false);
expect(CreateSubmissionSchema.safeParse({ ...validPayload, fieldValues: tooManyFields }).success).toBe(false);
expect(CreateSubmissionSchema.safeParse({ ...validPayload, fieldValues: { notes: "x".repeat(10_001) } }).success).toBe(false);
```

- [ ] **Step 5: Run and verify RED**

Run: `npm test -- lib/server/extensionSubmissionPayload.test.ts`

Expected: FAIL because the schema module is missing.

- [ ] **Step 6: Implement and wire the server schema**

Move route-local validation into `extensionSubmissionPayload.ts`, add sensitive-key and size refinements, and import the schema from the route. Keep the existing generic 400 response contract.

- [ ] **Step 7: Verify GREEN**

Run: `npm test -- lib/server/extensionSubmissionPayload.test.ts && npm --prefix chrome-extension test -- src/background/apiErrors.test.ts`

Expected: both suites pass.

- [ ] **Step 8: Commit**

```bash
git add app/api/ext/submissions lib/server/extensionSubmissionPayload* chrome-extension/src/background
git commit -m "fix(security): reject unsafe extension submissions"
```

### Task 4: Throttle extension token activity writes

**Files:**
- Modify: `lib/server/auth/requireExtensionToken.ts`
- Modify: `lib/server/auth/requireExtensionToken.test.ts`
- Modify: `test/api/extJobsImport.test.ts`

**Interfaces:**
- Preserves: `requireExtensionToken(req): Promise<{ userId: string; tokenId: string }>`.
- Produces: one atomic conditional `updateMany` at most every five minutes.

- [ ] **Step 1: Replace the old expectation with failing boundary tests**

Use a fixed system time. Test null, 4:59 fresh, exactly 5:00 stale, and `updateMany({ count: 0 })` concurrent-loser behavior. Assert the `where` predicate includes `id` plus `lastUsedAt: null OR lte cutoff`.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- lib/server/auth/requireExtensionToken.test.ts test/api/extJobsImport.test.ts`

Expected: FAIL because current code calls `update` for every successful request.

- [ ] **Step 3: Implement the fast path and atomic update**

```ts
const LAST_USED_AT_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const now = new Date();
const cutoff = new Date(now.getTime() - LAST_USED_AT_WRITE_INTERVAL_MS);

if (!record.lastUsedAt || record.lastUsedAt.getTime() <= cutoff.getTime()) {
  await prisma.extensionToken.updateMany({
    where: {
      id: record.id,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: cutoff } }],
    },
    data: { lastUsedAt: now },
  });
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- lib/server/auth/requireExtensionToken.test.ts test/api/extJobsImport.test.ts`

Expected: all token and integration tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/server/auth/requireExtensionToken* test/api/extJobsImport.test.ts
git commit -m "perf(auth): throttle extension token activity writes"
```

### Task 5: Trustworthy and accessible landing experience

**Files:**
- Create: `components/landing/lib/useCtaHref.test.tsx`
- Create: `components/landing/Nav.test.tsx`
- Create: `components/landing/LogoBar.test.tsx`
- Create: `components/landing/Footer.test.tsx`
- Create: `test/landingMessages.test.ts`
- Modify: `components/landing/lib/useCtaHref.ts`
- Modify: `components/landing/Nav.tsx`
- Modify: `components/landing/LogoBar.tsx`
- Modify: `components/landing/Footer.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`

**Interfaces:**
- `useCtaHref()` keeps its `{ href, disabled }` shape but returns an enabled `#access` fallback while the session loads.
- Animated numbers remain visual; a screen-reader-only final number is always present.

- [ ] **Step 1: Write failing CTA, touch-target, and counter tests**

```tsx
expect(renderHook(() => useCtaHref()).result.current).toEqual({ href: "#access", disabled: false });
expect(screen.getByRole("link", { name: /start free/i })).not.toHaveAttribute("aria-disabled", "true");
expect(screen.getByRole("button", { name: /open menu/i })).toHaveClass("h-11", "w-11");
expect(screen.getByText("8", { selector: ".sr-only" })).toBeInTheDocument();
expect(screen.getByRole("heading", { level: 2, name: /plugs into/i })).toBeInTheDocument();
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- components/landing/lib/useCtaHref.test.tsx components/landing/Nav.test.tsx components/landing/LogoBar.test.tsx components/landing/Footer.test.tsx`

Expected: FAIL for the dead loading CTA, 36-pixel controls, missing semantic heading, and inaccessible final counter values.

- [ ] **Step 3: Implement interaction and semantic fixes**

Loading CTAs route to `#access` and remain focusable. Mobile GitHub/CTA/menu controls use `h-11` and menu uses `w-11`; desktop density is restored with responsive classes when needed. Footer anchors are `inline-flex min-h-11 items-center` on mobile. All links receive visible focus styles. Nav and Footer hard-coded accessible labels are moved into `landing.nav` and `landing.footer` translations. LogoBar heading becomes `h2`; animated count is `aria-hidden` and a `.sr-only` final number is rendered beside it.

- [ ] **Step 4: Add failing marketing-fact tests**

The test compares English and Chinese landing key structure, asserts six non-empty FAQ entries, and rejects current unshipped claims such as streamed generation, under-five-second PDF completion, no loading state, and in-app OpenAI/Claude key configuration.

- [ ] **Step 5: Run and verify RED**

Run: `npm test -- test/landingMessages.test.ts`

Expected: FAIL against the current claims.

- [ ] **Step 6: Replace English and Chinese claims with shipped behavior**

Describe editable evidence-grounded proposals, in-app Gemini generation, and external Skill Pack use with Claude/ChatGPT/Gemini. Update hero meta, capability label, feature cards, access perks, privacy FAQ, provider FAQ, and any linked claim in both locale files. Do not change message structure or section order.

- [ ] **Step 7: Verify GREEN and accessibility**

Run: `npm test -- components/landing test/landingMessages.test.ts app/\(marketing\)/page.test.tsx`

Expected: all landing tests pass with no axe violations.

- [ ] **Step 8: Commit**

```bash
git add components/landing messages test/landingMessages.test.ts app/\(marketing\)/page.test.tsx
git commit -m "fix(marketing): align landing trust and accessibility"
```

### Task 6: CI, coverage, dead-code, and test-signal gates

**Files:**
- Modify: `chrome-extension/package.json`
- Modify: `chrome-extension/package-lock.json`
- Modify: `chrome-extension/vitest.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `knip.json`
- Modify: `test/setup.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces root commands `npm run deadcode` and existing verification commands.
- Produces extension command `npm run test:coverage` with measured ratchet thresholds.

- [ ] **Step 1: Add extension coverage and measure the baseline**

Add `@vitest/coverage-v8` matching the extension Vitest major, add `test:coverage`, include `src/**`, exclude tests and declarations, then run `npm --prefix chrome-extension run test:coverage`. Set thresholds just below the measured statements, branches, functions, and lines values.

- [ ] **Step 2: Add deterministic canvas setup**

Define `HTMLCanvasElement.prototype.getContext` in `test/setup.ts` with the minimal no-op 2D methods used by tests. Run `npm test` and confirm canvas not-implemented warnings disappear without hiding application exceptions.

- [ ] **Step 3: Make Knip executable and focused**

Install Knip as a dev dependency, add `deadcode: "knip --include files,dependencies"`, and declare `chrome-extension/src/content/seek/seekInterceptMain.ts` as a manifest entry. Run `npm run deadcode`; expected output is empty and exit code is zero. Intentionally reusable shadcn exports are outside this focused files/dependencies gate.

- [ ] **Step 4: Add extension gates to main CI**

Use both lockfiles in the Node cache key, run `npm ci` inside `chrome-extension`, then run extension coverage and extension build before root build. Add `npm run deadcode` after root dependency installation.

- [ ] **Step 5: Apply compatible dependency updates**

Run `npm update` in the root and extension. Do not cross the major exclusions in Global Constraints. If Prisma packages change, align `prisma`, `@prisma/client`, and `@prisma/adapter-neon`, then run `npx prisma generate` and include generated client changes.

- [ ] **Step 6: Verify quality gates**

Run:

```bash
npm run lint
npm run deadcode
npm run deps:policy
npm run deps:audit
npm run test:coverage
npm --prefix chrome-extension run test:coverage
npm --prefix chrome-extension run build
```

Expected: every command exits zero; no high-severity production dependency vulnerability; coverage remains above both ratchets.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json knip.json test/setup.ts chrome-extension/package.json chrome-extension/package-lock.json chrome-extension/vitest.config.ts .github/workflows/ci.yml
git commit -m "ci: gate extension and dead-code quality"
```

### Task 7: Final regression, browser acceptance, and scored audit

**Files:**
- Create: `docs/audits/2026-07-10-production-readiness.md`
- Modify only if verification exposes a regression: the smallest owning implementation and test file.

- [ ] **Step 1: Run the complete fresh verification bundle**

```bash
npm run lint
npm run deadcode
npm run deps:policy
npm run deps:audit
npm run test:coverage
npm run build
python -m pytest tools/fetcher -q
npm --prefix chrome-extension run test:coverage
npm --prefix chrome-extension run build
```

Expected: all commands exit zero. Record exact test counts and four coverage values for each Vitest workspace.

- [ ] **Step 2: Run production browser acceptance**

Start the verified production build. Inspect `/`, `/login`, and `/get-extension` at 375, 768, 1024, and 1440 pixels. Confirm no horizontal scroll, no console errors, 44-pixel mobile navigation and footer targets, visible keyboard focus, Escape-closing mobile menu, correct English/Chinese content, reduced-motion behavior, and no persistent duplicate IDs.

- [ ] **Step 3: Inspect the final diff and repository state**

Run: `git diff --check origin/master..HEAD`, `git status --short`, and `git log --oneline -10`.

Expected: no whitespace errors, no uncommitted product changes, and only intentional commits.

- [ ] **Step 4: Write the scored audit**

Document baseline and final scores across architecture, security/privacy, code quality, tests/release engineering, performance, accessibility, UI consistency, UX clarity, internationalization, and operations. Every remaining risk includes severity, evidence path, impact, and recommended next action; external-credential or infrastructure work is explicitly separated from completed code work.

- [ ] **Step 5: Commit the audit and any final regression fix**

```bash
git add docs/audits/2026-07-10-production-readiness.md
git commit -m "docs: publish production readiness audit"
```

- [ ] **Step 6: Verify the final commit**

Run the complete verification bundle once more after the final commit, then confirm `git status --short --branch` is clean.
