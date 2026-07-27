# Joblit — Domain Glossary

Canonical vocabulary for the Joblit codebase. Use these exact terms in code, commit messages, issue titles, ADRs, and PR descriptions.

When a domain concept needs sharpening, add it here rather than letting two synonyms drift apart. Implementation-only terms (helper names, file paths) do not belong here.

---

## Core entities

### Master Resume Profile (`ResumeProfile`)

The user's source-of-truth resume. One per `(userId, locale)`. Edited in the **Resume Studio** (`/resume`). Contains basics, summary, experience, projects, education, skills.

Synonyms to avoid: "master resume", "base resume" — use **Master Resume Profile** or **`ResumeProfile`**.

### Job

A role record imported from a job board (LinkedIn, Indeed, etc.) via the **Fetch Pipeline**. Has `status` ∈ `NEW | APPLIED | REJECTED`. Belongs to one user, identified within that user by canonical `jobUrl`.

### FetchRun

A durable execution of the **Fetch Pipeline** for one user and market. Its
versioned `FetchRunConfig` snapshots the execution input (apart from
`dispatchMeta` bookkeeping); ordered `FetchRunCommitReceipt` rows are the
evidence that result batches crossed the database commit boundary.
`SUCCEEDED`, `FAILED`, and `PARTIAL` are terminal.

### Application

The artifact produced by **tailoring** the Master Resume Profile to a specific Job. One per `(userId, jobId)`. Holds `resumePdfUrl`, `coverPdfUrl`, plus the `aiContent` snapshot used to render them.

Distinct from **Job**: Job is the role, Application is what the user submits *to* the role.

### Application Artifact (`ApplicationArtifact`)

A durable lifecycle record for one Application PDF or TeX Blob. It tracks the
object from `STAGED` through `REFERENCED` and eventual retirement; it is not the
current Application aggregate. Its user, Job, and Application identifiers are
scalar identity snapshots without foreign keys so cleanup evidence survives
source-row deletion. A future account-deletion transaction must invoke the
explicit artifact-erasure preparation hook before deleting the User; no
supported account-deletion route is currently wired. Settled metadata may be
purged only after proving the User is absent. See **ADR-0010**.

### Application Status

| Value | Meaning |
|---|---|
| `DRAFT` | The user has un-finalized edits to AI proposals. PDF may still be the previous final's PDF or absent. |
| `FINAL` | The currently rendered PDF reflects the committed `aiContent`. Re-editing flips back to `DRAFT`. |

The lifecycle is single-row, in-place. See **ADR-0002**.

### AI Content (`aiContent`)

The persisted snapshot of the current AI proposal for each Application target,
paired with the user's accept/reject/edit decisions. Stored as JSON on the
`Application` row. Re-generating a target replaces that target's proposal; this
is not a history of every proposal ever generated.

CV and Cover may be generated independently. `aiContent.provenance.resume` and
`aiContent.provenance.cover` carry the authoritative generation metadata for
each target when known: `generatedAt`, `promptMetaHash`, and source. The legacy
root `generatedAt`, `promptMetaHash`, and optional `source` describe the latest
whole import only and must not be attributed to a preserved target.

Evidence and review remain aggregate-wide. After a target replacement or an
evidence-aware Edit/discard, the server rebuilds evidence and reviews the
combined CV + Cover snapshot before persistence. The browser may change only
`accepted` and `userEdit`.

Captures:
- **Summary**: AI rewritten text + the original (for diff display).
- **Latest experience bullets**: AI-added bullets, each carrying `text`, `userEdit?`, `accepted`, and the quality-gate verdict.
- **Cover letter paragraphs**: AI drafts of the three body paragraphs, each with `userEdit?` and `accepted`.

The skills section is not part of this snapshot. AI-proposed skill additions were removed: the model proposed skills the candidate had no evidence for, so the grounding gate blocked finalize on almost every draft that carried them. A CV's skills come from the master profile only.

**`accepted` gates additions, not replacements.** An AI-added bullet is an
addition: the user opts in, and an unaccepted bullet is omitted from the
document. The summary and the three Cover paragraphs are replacements of
required content — a Cover letter missing a body paragraph is invalid, not
shorter, and Finalize rejects it with `COVER_PARAGRAPHS_INCOMPLETE`. Rejecting
a replacement therefore cannot mean omitting it; the user edits it instead, and
`userEdit` already wins when present.

The one derivation of a proposal's final text lives in
`lib/shared/aiContentText.ts` and is used by the LaTeX composition, the evidence
ledger, and the claim ledger, so all three describe the same document.

See **ADR-0001** for the persistence rationale.

---

## Workflow concepts

### Tailoring

The end-to-end process of converting a Master Resume Profile + a Job into a finished Application. Runs through three phases:

1. **Generate** — produce AI proposals (auto via Gemini, or manual via external LLM + JSON paste).
2. **Edit** — user reviews AI proposals on `/jobs/[id]/tailor`, accepts/rejects/edits.
3. **Finalize** — render LaTeX → PDF, commit `aiContent`, set status `FINAL`.

The **Edit** phase is new in v1.x. Before that, generate→finalize was atomic. See **ADR-0002**.

### Tailoring Run (`TailoringRun`)

A durable execution that generates the required Resume and/or Cover AI
proposals for one Job from one issued set of prompt receipts and source
snapshots. It owns execution progress and cancellation; unlike an Application,
it is execution history rather than the user's current artifact.

Synonyms to avoid: "AI task", "generation session" — use **Tailoring Run**.

### Tailoring Run Receipt (`TailoringRunReceipt`)

Immutable evidence that one target of a Tailoring Run crossed the Application
acceptance seam. There is at most one accepted receipt for each required target;
an identical retry reuses that evidence instead of creating another acceptance.

Synonyms to avoid: "completion flag", "callback record" — use **Tailoring Run
Receipt**.

### Quality Gate

The set of post-generation filters that grade AI-added bullets.
`acceptApplicationGeneration` is the single generation-acceptance seam and
applies the grounding/non-redundancy checks from `manualImportParser.ts` for
manual, Local AI, and server-batch output. Bullets that fail a gate are **shown
but disabled** in the Edit panel; the user may override by editing the bullet
text.

Gates today:
- **Grounded** — the bullet must reference at least one term from the JD or master profile.
- **Non-redundant** — the bullet must not duplicate an existing bullet on the same experience.

### Codex Batch

External orchestration protocol that loops over `NEW` jobs and tailors each
one. See `AGENTS.md`. For every concrete job and target, Codex obtains the exact
prompt and `promptMeta` generation receipt before importing through
`manual-generate`; batch context itself carries contract identity, not a
job-less receipt.

### Fetch Pipeline

The job-intake side. A `FetchRun` stores a versioned, market-discriminated
configuration, performs network discovery through the AU worker or an
in-process CN/GLOBAL adapter, then commits ordered result batches through the
`fetch-run-commit/v1` protocol.

The **FetchRun commit boundary** is the transaction that persists Jobs, the
batch receipt, counters, and terminal projection while holding `FRUN → JOBJ`
locks. Cancellation competes for `FRUN`: it stops future commits but never
pretends that receipt-backed Jobs were rolled back. See **ADR-0008**.

### Title Match

How hard the Fetch Pipeline's title filter presses. `strict | relaxed | off`.

- **strict** — the title must answer one of the requested queries.
- **relaxed** — also keeps a sibling role inside the base query's domain.
- **off** — no title filter. Quality gates, location and freshness still apply.

This replaces the `includeFromQueries` boolean, which the AU worker read as
"skip the include filter" and the GLOBAL processor read as "apply a looser
one", while a single UI control sent the same value to both. Both readings had
a cause — AU searches through a job board that has already matched the terms
upstream, GLOBAL reads feeds that return their whole catalogue — so the states
are named rather than guessed. The boolean is still persisted for the AU
worker's legacy projection; `resolveTitleMatchMode` derives the mode from it
when the field is absent.

The rules themselves live in `lib/shared/jobRelevance.ts` and
`tools/fetcher/run_jobspy.py`, which read one vocabulary from the `relevance`
block of `fetchRolePacks.config.json` and are held to one behaviour by
`test/fetchRelevance.corpus.json`. Seniority words (`senior`, `lead`,
`principal`, `staff`, …) are stripped before matching: they state a level, not
a domain, and treating one as a required title signal made a search for
"Senior AI Engineer" return strictly fewer roles than "AI Engineer".

### Skill Pack

The downloadable V3 distribution of the user's active effective prompt rules,
current output schemas, prompt templates, examples, local validator, and
optional Master Resume Profile snapshot. It does not distribute AI-authored
skills: skills remain Master Resume Profile-owned.

Two deterministic identities exist for different artifacts:

- The historical `PromptMeta.skillPackVersion` field is the **generation
  receipt version**. It covers the effective rules, current prompt/schema
  contract, and Master Resume Profile snapshot used to construct a generation
  request.
- `GET /api/prompt-rules/skill-pack` returns
  `x-skill-pack-version`, the **download content version** over the final sorted
  logical file names and contents in that ZIP.
- The same response returns `x-generation-receipt-version`; the UI checks it
  against the current Prompt receipt before marking the locale-specific pack
  as fresh.

These identities answer different questions and are not required to be equal.
Neither identity depends on ZIP timestamps or a wall-clock build date.

---

## Locale & market

### Market

Geographic region governing which job sources to fetch and which resume locale to use. `AU | CN`. See `lib/shared/market.ts`.

`FetchRunConfig.market` also accepts `GLOBAL` for the global public-feed/ATS
adapter. That is an execution-source selector, not a third UI or Resume Market;
it follows the AU locale path.

### Resume Locale

BCP 47 tag stored on `ResumeProfile` and used by the LaTeX renderer. `en-AU | zh-CN`. Always derivable from Market.

### UI Locale

Short locale code used by next-intl for translation strings. `en | zh`. Always derivable from Market.

---

## Terms to avoid

| Don't say | Say instead |
|---|---|
| "Resume" (alone) | **Master Resume Profile** or **Application** (be specific) |
| "Save" | **Auto-save** (background, debounced) or **Finalize** (explicit, renders PDF) |
| "AI bullets" | **AI-added bullets** (the additions) or **AI proposals** (summary, AI-added bullets, or Cover paragraphs) |
| "Generate" (alone) | **Generate AI proposals** or **Tailor** (the full pipeline) |
| "Cover letter" (as separate noun) | Treat as part of **Application** — a single Application has both CV and CL artifacts |
| "Draft" (vague) | **`DRAFT` Application** or **AI proposal** |

---

## See also

- [ADR-0001](./docs/adr/0001-application-aicontent-provenance.md) — Why we persist AI provenance.
- [ADR-0002](./docs/adr/0002-unified-tailor-edit-flow.md) — Why both generate paths converge through the Edit phase.
- [ADR-0008](./docs/adr/0008-fetch-run-execution-commit-protocol.md) — Why all Fetch Pipeline adapters share one durable commit boundary.
- [ADR-0009](./docs/adr/0009-tailoring-run-acceptance-protocol.md) — Why all AI proposal sources share one durable acceptance protocol.
- [AGENTS.md](./AGENTS.md) — Codex Batch protocol.
- [docs/CODEMAPS/](./docs/CODEMAPS) — Architecture snapshots.
