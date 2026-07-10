# Joblit Production Readiness and UI/UX Hardening Design

**Date:** 2026-07-10
**Status:** Approved for implementation by the user's explicit instruction to continue through optimization and final commit

## Context

Joblit is a bilingual job-search workstation built with Next.js 16, React 19, Prisma, Vitest, a Python fetch worker, and a Manifest V3 Chrome extension. The current product already has a coherent warm-ivory and emerald visual language, strong core workflows, 769 root tests, 243 extension tests, a passing production build, and no high-severity production dependency vulnerabilities. The goal is therefore not a redesign or architecture rewrite. It is a targeted production-hardening pass that improves trust, accessibility, security, performance, and release confidence while preserving the existing information architecture, business flow, and animation character.

## Approaches Considered

### 1. Full product and visual rewrite

This could split large client components, replace the design system, and redesign every authenticated workflow at once. It offers the largest theoretical change but creates unnecessary regression risk, obscures which changes improve outcomes, and conflicts with the requirement to preserve proven business flows.

### 2. Production-readiness hardening in bounded vertical slices — selected

This approach fixes the highest-impact verified issues in independently testable slices: trustworthy landing content and interaction, extension connection security, token activity write amplification, and CI coverage of the extension. It preserves Joblit's existing brand system and makes measurable improvements without speculative infrastructure work.

### 3. Cosmetic-only polish

This would adjust spacing, shadows, and copy while leaving security boundaries, CI gaps, and database write amplification untouched. It is too shallow for a big-tech production-readiness standard.

## Product and Design Direction

The existing landing page remains the visual source of truth: warm neutral surfaces, ink-like foregrounds, restrained emerald accents, editorial typography, generous whitespace, and short 150–320 ms interactions. No new palette, font family, ornamental visual system, or perpetual animation is introduced.

The landing page has one job: explain the end-to-end job-search workflow truthfully and route an eligible visitor into the invite or application flow. Copy must describe shipped behavior rather than aspirational behavior. In-app generation is described as an editable, evidence-grounded proposal flow. Claude, ChatGPT, and Gemini are described as external Skill Pack destinations; the interface must not claim that users can configure arbitrary provider keys inside Joblit when that path does not exist.

The responsive interaction floor is 44 by 44 CSS pixels for compact mobile navigation controls and at least 44 pixels of tappable height for footer links. Existing hover, focus, reduced-motion, and sticky-navigation behavior remains intact.

## Slice A: Trustworthy Landing Experience

### Navigation

- The primary CTA always has a real destination during authentication hydration. Authenticated users go to `/jobs`; all other states go to `#access`.
- Loading state may use neutral copy but must not become a dead `#` link, remove itself from keyboard order, or disable pointer input.
- GitHub, primary CTA, and mobile menu controls receive a 44-pixel mobile touch target without increasing desktop visual density.
- Footer links receive a 44-pixel mobile tap height while retaining their current desktop rhythm.

### Capability statistics

Animated numeric counters remain visual decoration. Assistive technology receives the final value immediately, while the animated counter is hidden from the accessibility tree. Server-rendered and pre-intersection content therefore communicates the actual capability instead of zero.

### Factual content

- Remove claims of streamed sub-five-second PDF generation and no loading state.
- Replace bring-your-own-key claims with the shipped choices: in-app Gemini generation and downloadable Skill Pack use with Claude, ChatGPT, or Gemini.
- Explain data handling consistently: in-app generation sends the minimum required profile and JD content to the configured provider; exported Skill Packs are uploaded under the user's control.
- Apply equivalent English and Chinese wording.

## Slice B: Extension Connection Boundary

Create a focused shared URL normalizer used by the popup forms and background request client.

### Accepted values

- An empty value resolves to `DEFAULT_API_BASE`.
- Public and self-hosted endpoints must use `https:`.
- Local development may use `http:` only for `localhost`, `127.0.0.1`, or `[::1]`.
- A root pathname is normalized by removing trailing slashes.
- A non-root pathname is preserved without a trailing slash so reverse-proxy subpaths remain supported.

### Rejected values

- Non-HTTP protocols.
- Plain HTTP to non-loopback hosts.
- Embedded username or password.
- Query strings or fragments.
- Values that cannot be parsed as an absolute URL.

The setup and options screens show a localized, actionable error and do not persist invalid values. A custom self-hosted origin is requested as an optional host permission from the user's save or connect gesture; denial leaves the previous configuration untouched. The background API client normalizes stored values again as defense in depth; a corrupted legacy value falls back to the production default rather than becoming a token exfiltration destination.

## Slice C: Extension Form Privacy Boundary

Automatic extension behavior must be limited to a credible job-application context. Static content-script matches cover only the supported ATS hosts and Seek. The extension's required host permission covers only the production Joblit API. Unknown or custom recruiting pages use `activeTab` plus `chrome.scripting.executeScript` after the user clicks Fill, toggles the widget, or invokes the keyboard shortcut. A ping-before-inject bridge and a page-level sentinel make this path idempotent.

A shared, pure context classifier recognizes the supported ATS hosts and job-related URL paths. A dynamically injected script on a page outside that context registers only the message listener required for the explicit action, then exits without automatic form detection, a floating widget, submit interception, retries, or a DOM observer. Manual “Fill Current Page” remains available because it is initiated by the user.

Sensitive fields are excluded twice: once during form detection and again during submission snapshot creation. The deny-list covers password inputs; authentication and one-time-code autocomplete tokens; payment-card and transaction autocomplete tokens; and labels, names, ids, placeholders, or ARIA text that identify credentials, verification codes, payment data, government identifiers, or bank details. ATS-specific adapters cannot bypass the snapshot filter.

Submission interception refuses to attach outside a job-application context. `recordSubmission` repeats the same context check before sending data as defense in depth. The manifest stops injecting the main content script into every iframe because current fill and widget commands intentionally operate only in the top frame; iframe injection currently adds recording exposure without delivering iframe autofill.

The server applies independent payload limits and rejects sensitive field keys so an old or hostile client cannot bypass the extension filters. The offline queue accepts only transient network, timeout, rate-limit, and server failures; authentication and other permanent 4xx failures are returned to the user instead of retaining the payload locally for repeated upload attempts.

## Slice D: Extension Token Activity Write Throttling

Successful token authentication continues returning the same `{ userId, tokenId }` contract. `lastUsedAt` is refreshed at most once every five minutes per token:

1. Authentication reads the existing token row as it does today.
2. A fresh `lastUsedAt` skips the write entirely.
3. A missing or stale timestamp triggers `updateMany` with an atomic predicate on the token id and `lastUsedAt <= cutoff OR null`.
4. Concurrent requests may all attempt the conditional update, but only one can change the row for a given interval.

The activity update remains part of the successful authentication path so failures are visible to observability rather than silently hidden behind a misleading fire-and-forget comment. No schema migration or new index is needed because the primary-key predicate selects one row.

## Slice E: Release Gates and Test Signal

- Pull-request CI installs extension dependencies, runs extension coverage tests, and builds the extension before the root production build is considered releasable.
- Extension Vitest gains V8 coverage with a measured ratchet floor. The floor records the current baseline and prevents regression; it is not presented as an aspirational 80-percent gate.
- The root test environment provides a deterministic canvas context stub so intentional visual tests do not emit jsdom not-implemented warnings.
- The existing Knip configuration becomes an executable local audit command. Manifest entry points are declared explicitly. Unused export cleanup is limited to private code where removal cannot change runtime behavior; intentionally reusable UI primitives remain documented exceptions rather than being deleted for a vanity metric.

## Dependency Policy

This pass may apply compatible patch and minor updates already permitted by package ranges, followed by full verification. Major-version upgrades such as TypeScript 7, ESLint 10, jsdom 29, pdfjs 6, and Lucide 1 are excluded because they require dedicated migration plans. Prisma packages must remain version-aligned and generated client output must be regenerated if Prisma changes.

## Error Handling

- URL validation errors are surfaced next to the URL control and cleared when the user edits the value.
- Existing network and invalid-token messages remain distinct from URL validation.
- A legacy invalid stored base URL cannot be used for an authenticated request.
- Token activity write failures retain the existing authentication failure semantics, avoiding false-positive activity state.

## Testing Strategy

Every behavior change follows red-green-refactor:

- Landing component tests prove the hydration CTA target, final accessible counter value, and mobile touch-target classes.
- Extension unit tests cover valid normalization, every rejected URL class, popup persistence behavior, and background fallback behavior.
- Privacy regression tests prove that password, one-time-code, payment, bank, and government-id fields are neither detected nor captured; non-job pages do not receive automatic submission interception; supported ATS and careers URLs continue to initialize.
- Server tests cover fresh, stale, missing, and concurrent-safe token activity predicates.
- CI and coverage configuration is verified through the exact local commands it introduces.
- Final acceptance runs root lint, dependency policy, production dependency audit, root coverage, root production build, Python worker tests, extension coverage, extension build, dead-code audit, and browser checks at 375, 768, 1024, and 1440 pixels.

## Explicit Non-goals and Follow-up Risks

This pass does not add an external observability vendor, distributed rate-limit store, CSP nonce architecture, or authenticated browser fixtures. Those changes need deployment credentials, infrastructure choices, or a dedicated test-data strategy. They remain scored findings in the final audit instead of being hidden or implemented speculatively.

The large authenticated client components are not decomposed in this batch unless a touched behavior requires it. Their refactor should follow workflow-specific characterization tests rather than a repo-wide file-size rewrite.

## Acceptance Criteria

- Landing copy matches implemented product behavior in English and Chinese.
- All compact mobile controls and footer links meet the 44-pixel interaction floor.
- Animated statistics expose their final values to assistive technology before animation runs.
- Invalid or insecure extension API endpoints cannot be saved or used for authenticated requests.
- Automatic form detection, observation, widgets, and submission recording do not run outside a recognized job-application context.
- Sensitive credential, verification, payment, banking, and government-identifier fields are never detected or captured.
- The main content script no longer injects into subframes.
- The extension has no required all-HTTPS host permission; unknown recruiting pages are supported through explicit `activeTab` injection.
- Permanent submission failures are not retained in the offline queue, and the server rejects oversized or sensitive payloads.
- Extension token activity causes no more than one database write per five-minute interval per token.
- Extension tests, coverage, and build run on every pull request and branch push covered by the main CI workflow.
- Existing business workflows, navigation structure, visual identity, and motion behavior remain unchanged.
- All repository verification gates pass before the final code commit.
