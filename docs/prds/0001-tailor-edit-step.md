# PRD: Tailor Edit Step

- **Status:** Implemented
- **Owner:** Joblit Engineering
- **Created:** 2026-05-06
- **Target ship:** 2 sprints across 3 phases

## Summary

Insert an interactive **Edit phase** between AI generation and PDF finalization
in the Joblit tailoring pipeline. The user reviews each AI proposal (summary,
latest-experience bullet additions, and cover letter paragraphs),
accepts/rejects/edits inline, then explicitly **Finalizes** to render the PDF.
Skills and existing bullets remain Master Resume Profile-owned.

Today the pipeline is atomic: AI generates → PDF renders → Application saved. The user has no review step. AI quality is uneven, especially for bullets that fail grounding checks. The Edit step closes that gap.

## Goals

1. Show every AI proposal explicitly, mark its provenance, and let the user accept / reject / edit each one.
2. Match the visual language of the existing **Resume Studio** (`/resume`).
3. Preserve atomic behavior for the **Codex Batch** automation path (no UI in the loop).
4. Keep PDF render cost flat — no per-keystroke re-render.
5. Ship in additive phases without breaking existing Applications.

## Non-goals

- Versioning history of past finalizations (deferred — see ADR-0001 future work).
- Offline editing / localStorage queue.
- Real-time LaTeX preview.
- Editing master profile fields from the Tailor page (those live in Resume Studio).

## Domain

Vocabulary defined in [CONTEXT.md](../../CONTEXT.md). Architecture decisions in [ADR-0001](../adr/0001-application-aicontent-provenance.md) (provenance) and [ADR-0002](../adr/0002-unified-tailor-edit-flow.md) (unified flow).

## User stories

### S1 — Interactive review (Phase 1)

As a job seeker, after I generate AI proposals for a Job, I land on `/jobs/[id]/tailor` showing:

- **Summary** — AI rewrite editable, with a button to peek at my original.
- **Latest experience bullets** — original bullets locked, AI additions each with a checkbox (accept/reject), an inline editor, and a "Reset to AI" button.
- **PDF preview** — current draft renders on the right, with a Refresh button and an "auto-refresh after 30 s idle" indicator.
- **Auto-save** every 2 s, displayed as `Saved 3s ago` / `Saving…`.
- **Finalize** button at the bottom — re-renders PDF, locks the Application as `FINAL`, and routes to the success modal.

### S2 — Cover Letter review (Phase 2)

The Edit page gains:

- **Cover Letter tab** with three paragraph editors, each with character count and Reset-to-AI.
- **Per-document Finalize** — CV can be Final while CL stays Draft, or vice versa.

### S3 — Re-edit a finalized Application

A user revisits a previous job (status `APPLIED`), hits **Edit Tailored Resume** in the Job detail panel. Status flips to `DRAFT`, the Edit page loads with the saved `aiContent`. PDF on the right is the existing finalized PDF until they Finalize again.

### S4 — Application Batch

Feature-gated server auto-execute calls the durable
`generateApplicationArtifactsForJob` service and bypasses the interactive Edit
page. External Codex orchestration claims work through `run-once` and persists
returned model output through `manual-generate?finalize=true`.

### S5 — Migration of existing Applications

Pre-existing `Application` rows have `aiContent = NULL`. Opening their Edit page shows a banner: *"This was generated before edit support. Re-generate to enable editing"* with a re-generate CTA. The existing PDF stays downloadable.

## Functional requirements

### Schema migration

```prisma
enum ApplicationStatus {
  DRAFT
  FINAL
}

model Application {
  // existing fields...
  status         ApplicationStatus @default(FINAL)
  aiContent      Json?
  aiContentHash  String?
  resumeContentHash   String?
  resumePublishedHash String?
  coverContentHash    String?
  coverPublishedHash  String?
}
```

Migration name: `add_application_edit_workflow`. Backfill all existing rows to `status = FINAL`, `aiContent = NULL`, `aiContentHash = NULL`.

### `aiContent` JSON shape

Authoritative type lives in `lib/shared/schemas/aiContent.ts` (new file). Validated with Zod on every API boundary.

Shape per [ADR-0001](../adr/0001-application-aicontent-provenance.md#decision).

### Routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/applications/manual-generate?finalize=<bool>` | Existing route. New `finalize` flag. |
| `PATCH` | `/api/applications/[id]/draft` | Auto-save target. Body: partial `aiContent`. Returns updated `aiContentHash`. |
| `POST` | `/api/applications/[id]/finalize` | Renders and publishes the selected document from current `aiContent`. Body: `{ expectedHash }` (stale-write guard). |
| `POST` | `/api/applications/[id]/discard` | Reverts user edits to the original AI proposals and re-projects each document's publication status. |

The interactive web UI explicitly uses `finalize=false` for manual import.
Server auto-execute persists through `generateApplicationArtifactsForJob`;
external Codex persists through `manual-generate`. The retired
`/api/applications/generate` and
`/api/applications/generate-cover-letter` routes are not part of the current
surface.

### Page route

`/jobs/[id]/tailor` — server component shell + client editor.

Page header:
- ← Back to job
- Job title · Company · Locale
- Save state indicator (right-aligned)
- Tabs: `Resume` · `Cover Letter` (Phase 2)

Body — split-pane on desktop (≥`lg`), tabs on mobile (`Edit` / `Preview`).

Bottom sticky bar: `Discard changes` · `Finalize →`

### Auto-save behavior

- Debounce 2 000 ms after last edit.
- Optimistic UI — local state updates immediately.
- On failure: toast + persistent banner with manual retry. No data loss; local state retained.
- On reconnect after offline: same retry path (no offline queue in v1).
- Multi-tab conflict: server returns `409` with current hash; client shows dialog `Another tab updated this draft, [Reload] / [Overwrite]`.

### PDF preview

- Initial PDF rendered at generation time and stored at `resumePdfUrl`.
- "Refresh preview" button calls `POST /api/applications/[id]/finalize?dryRun=true` (renders, does not commit).
- Auto-refresh once after 30 s of editing idle.
- LaTeX errors surface inline in preview area with the LaTeX excerpt that failed.

### Quality gate display

Bullets that fail a quality gate (`isGroundedAddedBullet`, `isNonRedundantAddedBullet`):
- Render disabled, with the failing reason on hover.
- Become enabled the moment the user types into the bullet's editor (the user is re-grounding it).
- Stored verdict moves into `aiContent.cv.latestExperience.addedBullets[i].qualityGate`.

### Application Batch contract

- Server auto-execute calls `generateApplicationArtifactsForJob` through its
  authenticated, feature-gated execute route.
- External Codex claims/completes tasks through `run-once` and imports through
  `manual-generate?finalize=true`.
- Both modes persist an Application aggregate; neither uses a retired session
  generation route.

## Non-functional requirements

- **Auth**: every Edit-page route uses `withSessionRoute` and asserts `Application.userId === session.userId`.
- **Validation**: Zod-validate the full `aiContent` body on every PATCH. Reject schemaVersion mismatches with `409`.
- **Tests**: 80%+ coverage on `aiContent` schema, route handlers, autosave hook, and finalize render. Existing API tests must keep passing.
- **A11y**: edit panel sections labeled with `aria-labelledby`. Tab triggers use `role="tab"`. PDF iframe has `title` attribute.
- **Mobile**: ≥360 px viewport supported. Tabs (`Edit` / `Preview`) replace split-pane below `md`.
- **Performance**: Edit page TTI ≤ 1.8 s on 3G Fast simulated. PDF preview renders out-of-band (no block on main bundle).

## UI design

Visual language mirrors `/resume` (Resume Studio):
- `rounded-3xl` cards with `border-border/60`.
- Section headers use the `SectionKicker` component.
- Emerald accents for AI provenance markers (left-border on AI-proposal cards).
- Strikethrough + muted color for the AI's "original" Summary text in the diff peek.
- `Geist Sans` body, `Instrument Serif` for italic emphasis (matches Hero italic).

Layout sketch:

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back   Sr. Frontend Engineer · Stripe   [Saved 3s ago]    │
├─────────────────────────────────────────────────────────────┤
│  [Resume]  [Cover Letter]                                    │
├──────────────────────────────────┬──────────────────────────┤
│  Summary [AI rewrote] [Reset]    │   ┌────────────────────┐ │
│  ┌────────────────────────────┐  │   │                    │ │
│  │ <textarea>                 │  │   │  PDF preview        │ │
│  └────────────────────────────┘  │   │                    │ │
│  ▾ See original                  │   │                    │ │
│                                   │   │                    │ │
│  Latest experience               │   │                    │ │
│   Junior Integration Analyst     │   └────────────────────┘ │
│                                   │   [Refresh preview]      │
│   Original (3 locked)             │   Last: 12 s ago         │
│   ▾                               │                          │
│   AI proposed (3 of 5 passed)     │                          │
│   ☑ Bullet text [edit]            │                          │
│   ☑ Bullet text [edit]            │                          │
│   ☐ Bullet text                   │                          │
│      ⚠ Low grounding              │                          │
│                                   │                          │
├──────────────────────────────────┴──────────────────────────┤
│            [Discard changes]    [Finalize →]                 │
└──────────────────────────────────────────────────────────────┘
```

## Implementation phasing

### Phase 1 — Edit MVP (5 dev-days)

- Schema migration (`add_application_edit_workflow`).
- `aiContent` Zod schema + types.
- Route changes: `?finalize` flag on `manual-generate`.
- New routes: `/draft` (PATCH), `/finalize` (POST), `/discard` (POST).
- `lib/server/applications/manualImportArtifact.ts` extended to emit full `aiContent` instead of merging silently.
- New page `/jobs/[id]/tailor` with split-pane shell.
- Edit panel: **Summary** + **Latest experience bullets** only.
- Auto-save hook with optimistic UI.
- PDF preview with manual refresh + 30 s idle auto-refresh.
- Discard button.
- Re-generate confirm dialog.
- Banner for legacy `aiContent = NULL` Applications.
- Test coverage ≥ 80% on new code.

### Phase 2 — Cover Letter (2 dev-days)

- Cover Letter tab + paragraph editors.
- Independent finalize per CV / CL.

### Phase 3 — Polish (2 dev-days)

- Quality gate disabled-with-reason rendering.
- Summary diff peek (original strikethrough).
- Mobile tabs (Edit / Preview).
- Multi-tab conflict dialog.
- `beforeunload` guard.
- Re-edit-from-FINAL entry point on Job detail panel.

### Phase 4 (deferred — out of this PRD)

- Versioning (ADR-0001 future work).
- Offline editing.
- Live LaTeX preview.

## Risks

| Risk | Mitigation |
|---|---|
| LaTeX render service backpressure on auto-refresh | 30 s idle threshold + per-user debounce; reuse existing render service quotas. |
| `aiContent` schema drift between client and server | Zod schema in `lib/shared/`, shared between frontend and API; `schemaVersion` field for migrations. |
| Concurrent tabs corrupting drafts | `aiContentHash` stale-write guard with explicit `Reload / Overwrite` dialog. |
| Manual and server-batch contract drift | Both paths pass current output through the canonical Application generation acceptance boundary; contract tests cover both sources. |
| User edits a heavy Application then accidentally re-generates | Confirmation dialog summarizing how many edited fields will be lost. |

## Test plan

- **Schema migration test**: backfill correctness on a seeded fixture.
- **Auto-save concurrency test**: two parallel PATCH calls, hash mismatch returns 409.
- **Finalize idempotency test**: running finalize twice with the same `aiContentHash` is a no-op.
- **Application Batch regression**: batch-related tests must prove durable
  Application persistence through the server generation service.
- **Editor unit tests**: accept/reject/edit on bullets updates `aiContent` correctly.
- **E2E (deferred to Phase 3)**: full generate → edit → finalize → re-edit → finalize loop.

## Open questions

- Should editing a previously-finalized Application revoke the existing PDF immediately, or keep it linked until the next finalize? — _Deferred; current plan: keep linked for re-download until next finalize commits a new `resumePdfUrl`._

## Approvals

- Joblit Engineering — 2026-05-06 (owner approval)
