# Frontend — `app/**`, `components/**`, `lib/client/**`, `lib/api/**`

Route groups, the Jobs workspace, the Resume Studio, contexts, and i18n wiring.
Vocabulary is `CONTEXT.md`.

---

## Provider stack

`app/layout.tsx:52-71` is the only `<html>`. It resolves `getLocale()` /
`getMessages()` and wraps everything in `NextIntlClientProvider`, then
`Providers`.

`app/providers.tsx:13-42`, outermost first: `ThemeProvider` →
`MotionConfig reducedMotion="user"` → `QueryClientProvider` (`staleTime` 15 s,
no refetch on focus) → `SessionProvider` → `NextTopLoader` →
`FetchStatusProvider` → children + `FetchProgressPanel` → `Toaster`.

There is **no** root `middleware.ts`. Auth gating is per-page
`getServerSession` + `redirect`.

---

## Route groups

| Group | What it is | Auth |
|---|---|---|
| `(marketing)` | Public landing + legal. Loads `Instrument_Serif` scoped to this group. | None |
| `(auth)` | Sign-in. Resolves the session before any UI and redirects authenticated visitors to a sanitized callback (`login/page.tsx:27-49`). | Inverse gate |
| `(app)` | Authenticated workspace shell: atmosphere layers, `GuideProvider`, `AppNav`, `CommandPalette`, `RouteTransition`. The layout itself does not gate. | Per page |

### Pages under `(app)`

| Page | Gate | Notes |
|---|---|---|
| `/jobs` | session; **CN market redirects to `/resume`** (`page.tsx:117`) | `force-dynamic`. SSR runs `listJobs` and seeds the same infinite-query key the client reads, then `HydrationBoundary`. |
| `/jobs/[id]/tailor` | session; missing Application → `/jobs` | The full-page Edit surface. Two legacy escape hatches for rows with no or invalid `aiContent`. |
| `/fetch` | session; CN → `/resume` | The Fetch Pipeline console. |
| `/resume` | session | The Resume Studio. The page is a 15-line shell; all logic is in `components/resume/**`. |
| `/resume/rules` | — | `redirect("/resume")`. |
| `/discover` | session | Both markets. |
| `/extension` | session | Stacks `LocalAiSetupCard`, `ExtensionTokenManager`, `KnowledgeBase`. |
| `/career` | — | **Compatibility redirect to `/jobs`** per ADR-0006. The whole file is 6 lines. No Career client, nav entry, or translations remain. |

There is no `/automation` route.

`AppNav.tsx:59-70` computes the link set from `useMarket()`: CN gets
`[/resume, /discover]`; AU gets `[/jobs, /fetch, /resume, /discover, /extension]`.
`CommandPalette.tsx:65-80` duplicates the same conditional list.

`app/global-error.tsx` renders **outside** `NextIntlClientProvider`, so it reads
the locale cookie directly and uses an inlined EN/ZH table.

---

## The Jobs workspace

### `JobsClient.tsx` — 1394 lines

Five state machines share one closure. By responsibility:

| Lines | Owns |
|---|---|
| 95–140 | Selection: `selectedId`, `selectionExplicitlyCleared`, `pendingWorkspaceUrlRef`, and `persistWorkspaceUrl` — the only workspace URL writer. It uses `history.replaceState`, not `router.replace`, because `/jobs` is `force-dynamic` and a replace would re-run the server component and discard every scrolled page (comment at `:122-131`). |
| 141–171 | `captureListViewport` — records a stable row + offset before a mutation and disables native `overflow-anchor`. Reaches into a Radix internal. |
| 181–200 | URL→state sync, skipping the write it just made. |
| 202–226 | `useJobPagination`, then `useJobMutations` — which receives `captureListViewport`, so a mutation hook drives scroll compensation. |
| 238–266 | `useExternalGenerate`, Local AI dialog state, `useLocalAiRun`, `useFitScan`. |
| 267–307 | Virtualization latch (flips at >80 rows, never back) and the layout-effect scroll restore. |
| 314–363 | Batch selection, with two render-phase adjustments: reset on filter change, prune on item-set change. |
| 425–475 | Fetch-import auto-refresh, throttled to 5 s. |
| 523–533 | `effectiveSelectedId` — re-derives selection, falling back to the first visible row unless explicitly cleared. |
| 584–638 | Job-detail query plus a version-coherence refetch. |
| 655–716 | Four dialogs. |
| 718–1391 | ~660 lines of markup. |

Per ADR-0007, status controls read `ACTIVE_JOB_STATUS_VALUES` (`:821`, `:1082`),
while the label map in `types.ts:6-23` and the badge maps in `JobListItem.tsx`
and `JobDetailPanel.tsx` still carry all seven enum values — and they disagree
on the colour for `APPLIED`.

### `app/(app)/jobs/hooks/`

| Hook | Owns | Returns |
|---|---|---|
| `useJobFilters.ts` (213) | Filter state ↔ URL, debounced. Two writers: `router.replace` for filters, `history.replaceState` for workspace state. | 16 members. `sortByFit` is never set, so the `sort=fit` branch at `:176` is unreachable. |
| `useJobPagination.ts` (221) | The list `useInfiniteQuery`, page merge/de-dup, the suppressed-delete filter, the scroll listener. | 13 members. `pageResponses` has no consumer. |
| `useJobMutations.ts` (534) | All list writes: optimistic status patch with rollback, the 5 s undo window, a serial commit runner, session tombstones, a `pagehide` flush with `keepalive`, chunked batch delete with partial-success semantics. | `{updateStatus, requestDelete, batchDeleteMutation, updatingIds, deletingIds, error, setError}` |
| `useKeyboardNavigation.ts` (210) | j/k/Arrow/Escape row navigation with cancellable rAF focus retries for virtualized rows. | void |
| `useExternalGenerate.ts` (435) | The manual-import Generate path and the shared entry into the Edit phase. | 23 members, including 12 raw `useState` setters. |
| `useLocalAiRun.ts` (434) | The Local AI run state machine: session-storage resume, 750 ms polling under a 180 s budget, one automatic repair on `INVALID_AI_RESULT`. | `{availability, runState, start, stop, retry, reset, checkAvailability}` |
| `useFitScan.ts` (315) | The full-database fit-scan pump; the database is the queue. Lease-recovery polling, per-batch budget. | `{state, start, stop, reset}` — **the narrowest interface in the directory, and the only one with an explicit test seam and a real unit test.** Copy this shape. |
| `useSearchHistory.ts` (44) | A localStorage ring of recent queries. | **No importer anywhere in `app/`.** |
| `serialRunner.ts` (30) | Chains async tasks so a burst of expiring undo timers cannot fire parallel DELETEs. | — |
| `runChunkedBatchDelete.ts` (88) | Sequential 25-id chunks; one failing chunk does not abort the rest. | — |

The deferred-delete tombstone set lives in **three** places: module-level
`sessionDeletedJobIds` (`useJobMutations.ts:34`), component state
`suppressedDeletedIds` (`JobsClient.tsx:118`), and the filter
(`useJobPagination.ts:95-98`). `useExternalGenerate` is constructed from
`useJobMutations`' error setter.

### `app/(app)/jobs/utils/`

`jobsQueryCache.ts` (283) is the single owner of the `["jobs"]` key space — 14
exports. `jobsUrlState.ts` resolves retired statuses through `toActiveJobStatus`
(`:38-41`) per ADR-0007; `serializeJobListItem.ts:21` does **not** and casts the
stored status raw. Also: `visibleTotalCount.ts`, `tailorParser.ts`,
`experienceParser.ts`, `skillPackMeta.ts`.

---

## The Tailoring Edit surfaces

Two implementations. Both mount `useTailorDraft` and reuse the same five
presentational modules from `app/(app)/jobs/[id]/tailor/`.

### Shared engine — `useTailorDraft.ts` (222)

Owns the AI Content draft and its autosave. A monotonic `versionRef`, a 2000 ms
debounce, `startPersist` serialized behind `inFlightRef`, and `flushNow()` which
drains the debounce and **throws** if the newest version failed. It returns the
`aiContentHash` that both callers pass as `expectedHash`.

### `TailorClient.tsx` (517) — the full-page route

Has a doc tab, so one session edits both `resume` and `cover`. Localized. Renders
`ReviewGateCard` unconditionally from the persisted review. `PdfPreview` runs
with the default 30 s idle auto-refresh.

**`handleRefresh` calls `/finalize`, not `/preview`** (`:134-152`) — refreshing
the PDF commits the draft and sets status `FINAL`. Per `CONTEXT.md`, `FINAL`
asserts that the rendered PDF reflects committed AI Content.

### `TailorReviewDialog.tsx` (749) — the dialog inside Jobs

Single target, fixed from `initialDraft.target`. All UI copy is hardcoded
English — no `useTranslations` call in the file. Closing is intercepted so the
draft flushes first.

**`handleRefresh` calls `/preview`** and produces an object URL (`:254-302`). It
owns a preview-sync state machine the page surface lacks: four refs, a 1400 ms
debounce with a 500 ms queued follow-up, in-flight/queued guards, and object-URL
revocation on replace and unmount.

It is also the only surface that parses a blocked finalize — `extractBlockedReview`
(`:724-737`) reads an `ApiError` with status 422 and code
`APPLICATION_REVIEW_BLOCKED`, which is what `fetchJson`'s typed `payload` makes
possible.

`patchSummary`, `patchLatestExperience`, `patchCover`, `callFinalize`,
`handleDiscard`, `StatusPill` and `extractMessage` are duplicated between the two
files, in places character for character.

---

## The Resume Studio — `components/resume/**`

`ResumeContext.tsx` (266) is the composition root. It calls three hooks and
spreads all three return objects into one context value (`:238-255`) — roughly
75 members covering form editing, PDF preview, and profile-version management.

- Derives the Resume Locale from the UI Locale (`:56`).
- Owns dirty tracking by stringifying `buildPayload("save")` against a baseline.
- Gates the live preview on an actually-visible surface via `matchMedia`.
- `beforeunload` guard while dirty — the Studio has no autosave.

`useResumeForm.ts` (827) is pure client form state: eight `useState` slices, ~35
immutable mutators, dnd-kit reordering with focus remapping, and `buildPayload(mode)`
— the single serializer, which differs between `"preview"` (only fully renderable
entries) and `"save"`, and constructs objects field by field so the client-only
`rowId` never reaches the API. It returns 55 keys and has no direct test.

`useResumePreview.ts` (209) validates against the shared `ResumeProfileSchema`
before POSTing, so a mid-typing draft never 400s the server; dedups by payload
key; keeps the last good PDF painted during refreshes; retries once on 502/503/504.

`useResumeProfiles.ts` (301) owns profile versions. It takes `setPdfUrl`,
`setPreviewStatus` and `setPreviewError` as parameters and reimplements
`resetPreviewState` (`:107-114`) as a copy of `useResumePreview`'s own
`resetPreview` (`:188-195`). A fourth parameter, `resetDraft`, is accepted and
never used.

`ResumePageLayout.tsx` (318): `SectionContent` (`:42-178`) destructures ~40
context values purely to re-drill them as props, giving `ExperienceSection` a
17-prop interface. Only six files call `useResumeContext`.

Section ordering is locale-dependent: `getSectionIds(locale)` returns 6 sections
for EN and 5 for CN, with Education before Experience (`constants.ts:67-75`).

---

## Contexts

Exactly three `createContext` calls exist.

| Context | Carries | Mounted | `useX()` without a provider |
|---|---|---|---|
| `FetchStatusContext` (`app/FetchStatusContext.tsx:60`) | Fetch-run lanes and their aggregate; per-user localStorage keys, cross-tab resync, a 3→8→15 s backoff poller, an elapsed ticker | `app/providers.tsx:32` — global, so it wraps marketing and auth too | **Throws** (`:413-419`) |
| `GuideContext` (`app/GuideContext.tsx:62`) | Onboarding Quick Start. Also *renders* the coachmark, beacon, launcher and panel (`:673-977`), and owns a focus trap, a `MutationObserver` anchor tracker with a 30-attempt budget, and a global `?` shortcut. Disabled entirely in the CN market | `app/(app)/layout.tsx:21` — `(app)` only | **Silent no-op stub** (`:981-993`) |
| `ResumeContext` (`components/resume/ResumeContext.tsx:49`) | The whole Resume Studio | `app/(app)/resume/page.tsx:17` | **Throws** (`:262-266`) |

The two missing-provider contracts differ. A component accidentally rendered
outside `GuideProvider` silently stops completing onboarding tasks rather than
failing.

Two cross-component channels bypass context: the `joblit:command-palette` and
`joblit-fetch-started` window events.

---

## Client-side data access

`lib/api/fetchJson.ts` (92) is the intended seam. It sets `Content-Type`, parses
JSON with a null fallback, throws `ApiError(status, message, payload)` on non-2xx,
and optionally validates against a Zod schema. `extractErrorMessage` (`:78-91`)
understands three envelope shapes, because the server emits three.

**Importers: 3.** `useTailorDraft.ts`, `TailorClient.tsx`, `TailorReviewDialog.tsx`.

**Hand-rolled `fetch`: 36 call sites across 17 files** — `useJobMutations.ts` (4),
`useResumeProfiles.ts` (4), `FetchClient.tsx` (4), `ExtensionTokenManager.tsx` (3),
`KnowledgeBase.tsx` (3), `useExternalGenerate.ts` (3), `useDiscoverData.ts` (2),
`PersonalInfoSection.tsx` (2), `FetchStatusContext.tsx` (2), `GuideContext.tsx` (2),
and one each in `JobsClient.tsx`, `useJobPagination.ts`, `useFitScan.ts`,
`TailorReviewDialog.tsx`, `SourceHealthPanel.tsx`, `useResumePreview.ts`,
`ResumeContext.tsx`. Three of those return a blob or a zip and could not use
`fetchJson` as written.

Non-HTTP transport: `lib/client/localAiBridge.ts` (171) is `postMessage`-based,
speaking six actions over `LOCAL_AI_BRIDGE_CHANNEL` with a nonce and TTL,
validating both directions against `lib/shared/localAiBridgeContract`.

React Query key spaces: `["jobs", queryString]`, `["job-details", jobId]`,
`["discover-trending", period, clean]`.

---

## i18n wiring

1. `next.config.ts:3` — `createNextIntlPlugin("./i18n/request.ts")`
2. `i18n/routing.ts:3-8` — locales `["en","zh"]`, `localePrefix: "never"` (no
   locale segment in any URL), `localeDetection: false` (`Accept-Language` is
   ignored)
3. `i18n/request.ts:5-17` — reads the `locale` cookie server-side, validates it,
   dynamically imports `../messages/${locale}.json`. This is the only load site.
4. `app/layout.tsx:65` — `NextIntlClientProvider`, so the full catalog ships to
   every client route, marketing included.

**The cookie.** `components/LocaleSwitcher.tsx:19-28` is the only writer: it sets
`localStorage` and `document.cookie` client-side, then `router.refresh()`. There
is no middleware and no server-side write.

**Market derivation.** `hooks/useMarket.ts` = `uiLocaleToMarket(useLocale())`.
`ResumeContext.tsx:56` separately derives the Resume Locale from the same UI
Locale.

**18 namespaces**, identical key sets in both files. Largest: `jobs` 221,
`resumeForm` 141, `landing` 92, `extension` 77, `tailor` 68.

**The gate.** `test/messagesContract.test.ts` asserts (a) en and zh key
structures are identical, and (b) every key is referenced from source, with an
allowlist for the seven template-literal-built prefixes, each naming its call
site. Adding a key to one file and not the other now fails the build.

**Surfaces with hardcoded English**, so a reader does not assume coverage:
`TailorReviewDialog.tsx`, `JobBatchDeleteDialog.tsx`, `PdfPreviewDialog.tsx`,
`app/not-found.tsx`, and the toast copy in `useJobMutations.ts` and
`useExternalGenerate.ts`.

---

## Tests

56 colocated files, ~369 cases. The densest cluster is Jobs.

`JobsClient.test.tsx` is 2299 lines / 64 cases — the largest in the repo. Two
things to know before editing it: its seam is `globalThis.fetch` patched with a
40-line URL router (`:128-169`), and several assertions pin Tailwind class
literals (`:487-495`, `:523-528`) rather than behaviour, so a visual tweak breaks
the suite.

**Untested by any colocated test**: `useResumeForm.ts` (827 lines),
`useResumeProfiles.ts`, `useResumePreview.ts`, `ResumeContext.tsx`, all six
resume sections, `useJobFilters.ts`, `useJobPagination.ts`, `useJobMutations.ts`
(534 lines, exercised only indirectly through the full-page render).

Where a named seam exists — `useTailorDraft`, `fetchJson` — the tests mock the
module and stay short. That contrast is structural, not cultural.
