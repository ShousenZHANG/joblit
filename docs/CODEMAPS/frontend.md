# Frontend — `app/**`, `components/**`, `lib/client/**`, `lib/api/**`

Route groups, the Jobs workspace, the Resume Studio, contexts, and i18n wiring.
Vocabulary is `CONTEXT.md`.

---

## Provider stack

`app/layout.tsx:61` is the only `<html>`. It resolves `getLocale()` /
`getMessages()` (`:57-58`) and wraps everything in `NextIntlClientProvider`,
then `Providers`.

`app/providers.tsx:27-35`, outermost first: `ThemeProvider` →
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
| `(auth)` | Sign-in. Resolves the session before any UI and redirects authenticated visitors to a sanitized callback (`login/page.tsx:30-38`). | Inverse gate |
| `(app)` | Authenticated workspace shell: atmosphere layers, `GuideProvider`, `AppNav`, `CommandPalette`, `RouteTransition`. The layout itself does not gate. | Per page |

### Pages under `(app)`

| Page | Gate | Notes |
|---|---|---|
| `/jobs` | session; **CN market redirects to `/resume`** (`page.tsx:114`) | `force-dynamic`. SSR runs `listJobs` and seeds the same infinite-query key the client reads, then `HydrationBoundary`. |
| `/jobs/[id]/tailor` | session; `not_found`/`busy` → `/jobs` | The full-page Edit surface. A `legacy` snapshot (no or invalid `aiContent`) renders `LegacyApplicationBanner` instead. The `busy` kind is now unreachable — ADR-0022 removed the TailoringRun read behind it, though the union member is kept for callers that still switch on it. |
| `/fetch` | session; CN → `/resume` | The Fetch Pipeline console. |
| `/resume` | session | The Resume Studio. The page is a 23-line shell; all logic is in `components/resume/**`. |
| `/resume/rules` | — | `redirect("/resume")`. |
| `/career` | — | **Compatibility redirect to `/jobs`** per ADR-0006. The whole file is 6 lines. No Career client, nav entry, or translations remain. |

There is no `/automation` route.

`AppNav.tsx:59-66` computes the link set from `useMarket()`: CN gets
`[/resume]`; AU gets `[/jobs, /fetch, /resume]`. GitHub trending is a popover
in both markets rather than a route (`TrendingPopover`). The Runner setup
popover went with ADR-0022; a comment at `:140-142` marks where it stood.
Language, theme, the guide and sign-out sit behind the account avatar.
`CommandPalette.tsx` duplicates the same conditional list.

`app/global-error.tsx` renders **outside** `NextIntlClientProvider`, so it reads
the locale cookie directly and uses an inlined EN/ZH table.

---

## The Jobs workspace

### `JobsClient.tsx` — 1125 lines

Several state machines share one closure. By responsibility:

| Area | Owns |
|---|---|
| Selection and URL | `selectedId`, explicit-clear state, the sole workspace URL writer, and scroll-anchor capture/restore around mutations. |
| List data | `useJobPagination`, `useJobMutations`, `useSuppressedJobRows`, keyboard navigation, and the >80-row virtualization latch. |
| Generation | `useExternalGenerate` owns the whole manual copy/paste path — issue a prompt, paste the JSON back, persist a DRAFT. `useTailorReviewController` opens manual or saved Application content in one full-screen Review & Edit dialog. There is no unattended generation: ADR-0022 deleted the Runner, the enqueue button, the per-row tailoring badge, the progress banner and the batch details dialog. |
| Surfaces | `app/(app)/jobs/components/` — `GenerateProgress`, `JobRequirementsPanel`, `JobSearchBar`, `JobDescriptionMarkdown`, `JsonInputPanel`, `StepImport`, `StepIndicator`, `VirtualJobList`, plus `ExternalGenerateDialog`, `TailorReviewDialog` and the mobile detail overlay. |

Per ADR-0007, status controls read `ACTIVE_JOB_STATUS_VALUES`, while the label
map in `types.ts:10-27` still carries all seven enum values. Badge colour is no
longer duplicated per surface: `utils/jobStatusPresentation.ts:41` is the single
map, and it projects a stored status through `toActiveJobStatus` (`:64`).

### `app/(app)/jobs/hooks/`

| Hook | Owns | Returns |
|---|---|---|
| `useJobFilters.ts` (193) | Filter state ↔ URL, debounced. Two writers: `router.replace` for filters, `history.replaceState` for workspace state. | 16 members. |
| `useJobPagination.ts` (212) | The list `useInfiniteQuery`, page merge/de-dup, the suppressed-delete filter, the scroll listener. | 13 members. |
| `useJobMutations.ts` (364) | All list writes: optimistic status patch with rollback, the 5 s undo window, a serial commit runner, session tombstones, a `pagehide` flush with `keepalive`, chunked batch delete with partial-success semantics. | `{updateStatus, requestDelete, batchDeleteMutation, updatingIds, deletingIds, error, setError}` |
| `useSuppressedJobRows.ts` (194) | The deferred-delete suppression set and the scroll-anchor capture/restore around it, extracted from `JobsClient`. | Suppression state plus the anchor helpers. |
| `useKeyboardNavigation.ts` (210) | j/k/Arrow/Escape row navigation with cancellable rAF focus retries for virtualized rows. | void |
| `useExternalGenerate.ts` (359) | The whole manual copy/paste path: `POST /api/applications/prompt`, the paste dialog, `POST /api/applications/manual-generate?finalize=false`, and the entry into the Edit phase. `persistGeneratedDraft` (`:31`) is its exported import seam and `GeneratedDraftSource` is now just `"manual_import"`. | Dialog/form state plus the persist action. |
| `useTailorReviewController.ts` (222) | Demand-loads a tenant-checked Application review snapshot, aborts stale selections, and opens the shared full-screen editor without placing AI content in list responses. | Manual and persisted-Application open/close state plus request cancellation. |
| `serialRunner.ts` (30) | Chains async tasks so a burst of expiring undo timers cannot fire parallel DELETEs. | — |
| `manualGenerateDraftResponse.ts` | The Zod schema `useExternalGenerate` validates the DRAFT import response against. | — |

`useBatchProgress`, `useBatchCompletionSignal` and `useEnqueueJobTailoring`
went with the queue (ADR-0022). Nothing in the workspace polls a server-side
job any more.

The deferred-delete tombstone set still lives in more than one place:
module-level `sessionDeletedJobIds` in `useJobMutations.ts`, the state owned by
`useSuppressedJobRows`, and the filter inside `useJobPagination`.
`useExternalGenerate` is constructed from `useJobMutations`' error setter.

### `app/(app)/jobs/utils/`

`jobsQueryCache.ts` (283) is the single owner of the `["jobs"]` key space — 14
exports. Both `jobsUrlState.ts:37` and `serializeJobListItem.ts:25` resolve
retired statuses through `toActiveJobStatus` per ADR-0007, so the SSR-seeded
first page and the client-fetched pages agree. Also: `visibleTotalCount.ts`,
`tailorParser.ts`, `jobStatusPresentation.ts`, `constants.ts`, while the shared
`jobExperienceAnalysis.ts` module owns evidence-preserving JD year analysis;
`skillPackMeta.ts` owns skill-pack freshness.

---

## The Tailoring Edit surfaces

Two entry points, one engine. Both are thin: they build a
`useTailoringEditSession` and hand it to a view.

### Shared session — `useTailoringEditSession.ts` (406)

The single owner of an edit session. It exposes `document` (target selection,
publication state, content mutators), `content`, `preview`, `busy`, `issue`,
and the three commands `finalize`, `discard`, `saveAndExit`. Callers pass only
the initial snapshot and a message table, so localization stays at the call
site.

It composes:

| Module | Role |
|---|---|
| `useTailorDraft.ts` (273) | The AI Content draft and its autosave: a monotonic version ref, a debounce, a single-flight persist, and a flush that throws if the newest version failed. Supplies the `aiContentHash` used as `expectedHash`. |
| `useTailoringPreviewLifecycle.ts` (738) | The preview state machine — debounce with queued follow-up, in-flight guards, object-URL revocation on replace and unmount, and `PreviewSyncStatus`. |
| `useTailoringSessionCommands.ts` (162) | `finalize` / `discard` / `saveAndExit`, including the blocked-review 422 path. |
| `tailorActions.ts` (139), `tailorResponseSchemas.ts` | The HTTP calls and their response schemas. |
| `useUnsavedChangesGuard.ts` | The leave-with-unsaved-work guard. |

### `TailorClient.tsx` (73) — the full-page route

Builds the session with the `tailor` message namespace, wires back/finalize to
`router.push("/jobs")`, and renders `TailorClientView.tsx` (486). Localized.

### `TailorReviewDialog.tsx` (141) — the dialog inside Jobs

A full-screen `Dialog` around `TailorReviewDialogView.tsx` (473). It builds the
same session with `initialTarget` fixed from the draft and `autoPreview: true`,
and intercepts close so `saveAndExit` runs first. It is localized through the
same `tailor` namespace; the props contract lives in
`TailorReviewDialog.types.ts`.

Saved CV/CL actions pass only an `applicationId` into the controller.
`GET /api/applications/:id/review-snapshot` is session-only and `no-store`; it
verifies the Application, Job, and bound Resume Profile all belong to the
current user before returning AI content. It no longer consults a run table for
a `busy` verdict — ADR-0022 removed the only concurrent writer that guard
existed for. Legacy rows without valid AI content keep their direct PDF
fallback.

---

## The Resume Studio — `components/resume/**`

`ResumeContext.tsx` (432) is the composition root. It calls three hooks and
spreads all three return objects into one context value (`:397-421`), then adds
section-navigation, completion, autosave and locale members on top.

- Derives the Resume Locale from the UI Locale (`:82`).
- Owns dirty tracking by stringifying `buildPayload("save")` against a baseline
  keyed on `(activeProfileId, locale)` (`:175-195`), so a locale switch cannot
  re-baseline against the other locale's content.
- Gates the live preview on an actually-visible surface via `matchMedia`.
- `useResumeAutosave.ts` (168) debounces 800 ms from the last edit
  (`DEFAULT_DELAY_MS`, `:55`), is single-flight, and flushes on blur and
  `beforeunload` (`:159-160`). `SaveIndicator.tsx` renders its status; there is
  no Save button and no dirty-state nag.

`useResumeForm.ts` (827) is pure client form state: `useState` slices, immutable
mutators, dnd-kit reordering with focus remapping, and `buildPayload(mode)` —
the single serializer, which differs between `"preview"` (only fully renderable
entries) and `"save"`, and constructs objects field by field so the client-only
`rowId` never reaches the API. It has no direct test.

`useResumePreview.ts` (217) validates against the shared `ResumeProfileSchema`
before POSTing (`:89`), so a mid-typing draft never 400s the server; dedups by
payload key; keeps the last good PDF painted during refreshes; retries once on
502/503/504 (`:149`).

`useResumeProfiles.ts` (315) owns profile versions. It takes `setPdfUrl`,
`setPreviewStatus` and `setPreviewError` as parameters and reimplements
`resetPreviewState` (`:123`) as a copy of `useResumePreview`'s own
`resetPreview` (`:193`). A fourth parameter, `resetDraft`, is accepted and
never used (`:19`).

`ResumePageLayout.tsx` (344): `SectionContent` (`:43`) destructures context
values purely to re-drill them as props. Eight files call `useResumeContext`,
one of which is the provider itself and one a test.

The editor's presentation layer was rebuilt around one scroll (ADR-less; see
commits `b3a4852c`, `180506d9`, `a8d279f2`) and is not otherwise mapped here:

| Module | Role |
|---|---|
| `SectionShell.tsx` / `SectionNav.tsx` | One continuous scroll with a scrollspy rail. Completion is signalled by **exception** — an empty section dims; there are no filled-in badges. |
| `EntryCard.tsx` | A collapsed entry is a summary row (title + `entrySummary.ts` subtitle); expanding animates height. Remove is hidden when only one entry remains. |
| `GhostAddRow.tsx` | The dashed "add another" affordance that ends every repeatable list. |
| `BulletList.tsx` | Bullet rows with the bold-markdown seam (`applyBoldMarkdown` + `registerMarkdownRef`). |
| `EntryLinkRows.tsx` | Optional per-entry links; a known host auto-fills an empty label through `linkBrand.ts`. |
| `ReorderableList.tsx` / `SortableItem.tsx` | dnd-kit reordering shared by every repeatable section. |
| `SaveIndicator.tsx` | The only autosave surface — status text, no button. |
| `PreviewPanel.tsx` / `ResumePdfPreview.tsx` / `VersionSelector.tsx` | The right-hand preview column and profile-version switcher. |
| `sectionConfig.ts` | Section id → icon/title/description, consumed by both the shell and the rail. |

`useResumeProfiles.ts` splits identity adoption (`adoptProfileMeta`) from full
hydration (`hydrateFromResumeApi`) on purpose: autosave must adopt the saved
version's identity **without** replacing the draft the user is still typing into.

Section ordering is locale-dependent: `getSectionIds(locale)` returns 6 sections
for EN and 5 for CN (no Summary), with Education before Experience
(`constants.ts:67-75`).

---

## Contexts

Exactly three `createContext` calls exist.

| Context | Carries | Mounted | `useX()` without a provider |
|---|---|---|---|
| `FetchStatusContext` (`app/FetchStatusContext.tsx:69`) | Fetch-run lanes and their aggregate; per-user localStorage keys, cross-tab resync, a backoff poller, an elapsed ticker | `app/providers.tsx:32` — global, so it wraps marketing and auth too | **Throws** (`:510`) |
| `GuideContext` (`app/GuideContext.tsx:48`) | Onboarding Quick Start. Also *renders* `GuideCoachmark`, `GuideLauncher` and `GuidePanel`, and composes the hooks under `app/guide/`. Disabled entirely in the CN market | `app/(app)/layout.tsx:21` — `(app)` only | **Silent no-op stub** — `useGuide` falls back to `EMPTY_GUIDE_CONTEXT` (`:295-304`) |
| `ResumeContext` (`components/resume/ResumeContext.tsx:75`) | The whole Resume Studio | `app/(app)/resume/page.tsx` | **Throws** (`:428-432`) |

The two missing-provider contracts differ. A component accidentally rendered
outside `GuideProvider` silently stops completing onboarding tasks rather than
failing.

Two cross-component channels bypass context: the `joblit:command-palette` and
`joblit-fetch-started` window events.

---

## Client-side data access

`lib/api/fetchJson.ts` is the intended seam. It sets `Content-Type`, parses
JSON with a null fallback, throws `ApiError(status, message, payload)` on
non-2xx (`:85`), and optionally validates against a Zod schema.
`extractErrorMessage` (`:108`) understands more than one envelope shape,
because the server emits more than one.

Production importers now span the Jobs hooks, Tailoring Edit actions, Guide,
and Fetch-status modules. Some binary download/preview, `keepalive`, and
stream-specific calls still use platform `fetch` because `fetchJson` is a JSON
adapter rather than a universal transport wrapper.

There is no non-HTTP transport left in the client. The retired `postMessage`
bridge is historical (ADR-0014), and the Runner that replaced it is itself
retired (ADR-0022). The model is reached by the user, in their own browser tab,
by pasting.

React Query key spaces: `["jobs", queryString]`, `["job-details", jobId]`. The
trending popover holds its two periods in component state instead — it is a
single ambient panel with no cross-component consumers.

---

## i18n wiring

1. `next.config.ts:4` — `createNextIntlPlugin("./i18n/request.ts")`
2. `i18n/routing.ts:3-8` — locales `["en","zh"]`, `localePrefix: "never"` (no
   locale segment in any URL), `localeDetection: false` (`Accept-Language` is
   ignored)
3. `i18n/request.ts:5-17` — reads the `locale` cookie server-side, validates it,
   dynamically imports `../messages/${locale}.json`. This is the only load site.
4. `app/layout.tsx:65` — `NextIntlClientProvider`, so the full catalog ships to
   every client route, marketing included.

**The cookie.** `components/LocaleSwitcher.tsx:21-26` is the only writer: it sets
`localStorage` and `document.cookie` client-side, then `router.refresh()`. There
is no middleware and no server-side write.

**Market derivation.** `hooks/useMarket.ts` = `uiLocaleToMarket(useLocale())`.
`ResumeContext.tsx:82` separately derives the Resume Locale from the same UI
Locale.

**16 namespaces**, identical key sets in both files. Largest by leaf key:
`resumeForm` 148, `jobs` 145, `landing` 92, `tailor` 92, `privacy` 58,
`terms` 49. The `agent` namespace went with the Runner setup popover
(ADR-0022).

**The gate.** `test/messagesContract.test.ts` asserts (a) en and zh key
structures are identical, and (b) every key is referenced from source, with an
allowlist (`DYNAMIC_KEY_PREFIXES`, `:46`) for the three template-literal-built
prefixes, each naming its call site. Adding a key to one file and not the other
fails the suite.

**Surfaces with hardcoded English**, so a reader does not assume coverage:
`app/not-found.tsx` and the toast copy in `useExternalGenerate.ts`. The
Tailoring dialog is now localized — `TailorReviewDialogView.tsx` calls
`useTranslations`.

---

## Tests

68 colocated files, ~461 cases. The densest cluster is Jobs.

`JobsClient.test.tsx` is 2837 lines / 53 cases — the largest in the repo. Two
things to know before editing it: its seam is `vi.stubGlobal("fetch", …)` with a
per-suite URL router, and several assertions pin Tailwind class literals
(`:613-617`, `:1110`) rather than behaviour, so a visual tweak breaks the suite.

**Untested by any colocated test**: `useResumeForm.ts` (827 lines),
`useResumeProfiles.ts`, `ResumeContext.tsx`, all six resume sections,
`useJobFilters.ts`, `useJobPagination.ts`, `useJobMutations.ts` (364 lines,
exercised only indirectly through the full-page render). `useResumePreview.ts`
does have one (`useResumePreview.test.ts`).

Where a named seam exists — `useTailorDraft`, `fetchJson` — the tests mock the
module and stay short. That contrast is structural, not cultural.
