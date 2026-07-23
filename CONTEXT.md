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

### Application

The artifact produced by **tailoring** the Master Resume Profile to a specific Job. One per `(userId, jobId)`. Holds `resumePdfUrl`, `coverPdfUrl`, plus the `aiContent` snapshot used to render them.

Distinct from **Job**: Job is the role, Application is what the user submits *to* the role.

### Application Status

| Value | Meaning |
|---|---|
| `DRAFT` | The user has un-finalized edits to AI proposals. PDF may still be the previous final's PDF or absent. |
| `FINAL` | The currently rendered PDF reflects the committed `aiContent`. Re-editing flips back to `DRAFT`. |

The lifecycle is single-row, in-place. See **ADR-0002**.

### AI Content (`aiContent`)

The persisted snapshot of every AI proposal made for an Application, paired with the user's accept/reject/edit decisions. Stored as JSON on the `Application` row.

Captures:
- **Summary**: AI rewritten text + the original (for diff display).
- **Latest experience bullets**: AI-added bullets, each carrying `text`, `userEdit?`, `accepted`, and the quality-gate verdict.
- **Cover letter paragraphs**: AI drafts of the three body paragraphs, each with `userEdit?` and `accepted`.

The skills section is not part of this snapshot. AI-proposed skill additions were removed: the model proposed skills the candidate had no evidence for, so the grounding gate blocked finalize on almost every draft that carried them. A CV's skills come from the master profile only.

See **ADR-0001** for the persistence rationale.

---

## Workflow concepts

### Tailoring

The end-to-end process of converting a Master Resume Profile + a Job into a finished Application. Runs through three phases:

1. **Generate** — produce AI proposals (auto via Gemini, or manual via external LLM + JSON paste).
2. **Edit** — user reviews AI proposals on `/jobs/[id]/tailor`, accepts/rejects/edits.
3. **Finalize** — render LaTeX → PDF, commit `aiContent`, set status `FINAL`.

The **Edit** phase is new in v1.x. Before that, generate→finalize was atomic. See **ADR-0002**.

### Quality Gate

The set of post-generation filters that grade AI-added bullets. Defined in `lib/server/applications/manualImportParser.ts` (`isGroundedAddedBullet`, `isNonRedundantAddedBullet`) and applied by `manualImportArtifact.ts`. Bullets that fail a gate are **shown but disabled** in the Edit panel; the user may override by editing the bullet text.

Gates today:
- **Grounded** — the bullet must reference at least one term from the JD or master profile.
- **Non-redundant** — the bullet must not duplicate an existing bullet on the same experience.

### Codex Batch

External orchestration protocol that loops over `NEW` jobs and tailors each one without human review. See `AGENTS.md`. Codex always sets `?finalize=true` on generation routes — it skips the **Edit** phase entirely.

### Fetch Pipeline

The job-intake side: `FetchRun` task → GitHub Actions → Python JobSpy → admin import. Out of scope for tailoring.

### Skill Pack

The versioned set of prompt rules + canonical skills vocabulary used by the AI. Identified by `skillPackVersion`. The Edit panel displays the skill pack version that produced an `aiContent`; if the active version has moved on, a banner offers re-generation.

---

## Locale & market

### Market

Geographic region governing which job sources to fetch and which resume locale to use. `AU | CN`. See `lib/shared/market.ts`.

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
| "AI bullets" | **AI-added bullets** (the additions) or **AI proposals** (any AI mutation: bullets, summary, skills, cover) |
| "Generate" (alone) | **Generate AI proposals** or **Tailor** (the full pipeline) |
| "Cover letter" (as separate noun) | Treat as part of **Application** — a single Application has both CV and CL artifacts |
| "Draft" (vague) | **`DRAFT` Application** or **AI proposal** |

---

## See also

- [ADR-0001](./docs/adr/0001-application-aicontent-provenance.md) — Why we persist AI provenance.
- [ADR-0002](./docs/adr/0002-unified-tailor-edit-flow.md) — Why both generate paths converge through the Edit phase.
- [AGENTS.md](./AGENTS.md) — Codex Batch protocol.
- [docs/CODEMAPS/](./docs/CODEMAPS) — Architecture snapshots.
