---
name: joblit
description: Use when working in the Joblit repo (joblit) or when discussing Australian job fetch (JobSpy/LinkedIn), retained AU/CN Jobs and resumes, resume/cover tailoring, prompt rules/skill pack, or PDF export.
---

# Joblit (joblit)

Job-search command center: fetch → triage → tailor CV/CL → export PDFs.

## When to Use

- You are in the `ShousenZHANG/joblit` repo, or the user mentions Joblit/joblit.
- The task involves AU job intake (JobSpy/LinkedIn), retained AU/CN Job or
  Resume data, prompt rules/skill pack, CV/CL generation, batch workflows, or
  PDF export.

## When NOT to Use

- For repositories other than joblit (joblit-tailoring pack is for Joblit import only).
- When the task is generic job-search advice with no code or Joblit workflow involved.

## Mental Model

- **Intake**
  - Active: AU FetchRun → GitHub Actions → Python JobSpy → receipt-backed import (dedupe + tombstones)
  - Retained: CN Jobs, Resume, Chinese LaTeX, and translated UI
  - Retired: CN Fetch/Nowcoder and GLOBAL public-feed/ATS/source-health execution (ADR-0017)
  - Transitional schema: `SourceHealth` and `AtsBoardSource` are writer-less until Stage 2 removes them
- **Workspace**: Jobs list + detail, search/filter, status ledger from `NEW` through `ACCEPTED`
- **Tailoring**: prompt → external model → strict JSON import → LaTeX render → PDF

## Key Paths (start here)

- UI pages: `app/(app)/` (`jobs`, `fetch`, `resume`, `resume/rules`)
- API routes: `app/api/` (`jobs`, `fetch-runs`, `applications`, `application-batches`, `prompt-rules`)
- Server modules: `lib/server/` (AI prompts, LaTeX/PDF, persistence)
- Fetch worker: AU via `tools/fetcher/run_jobspy.py` (GitHub Actions); no CN or GLOBAL executor exists
- Schema: `prisma/schema.prisma`

More: `references/PATHS.md` and `references/FLOWS.md`.

## Non‑Negotiable Rules

- **Job dedupe**: unique `(userId, jobUrl)`; normalize with `canonicalizeJobUrl()`.
- **Fetch market**: create, config, trigger, and commit boundaries are AU-only; do not restore CN/GLOBAL adapters or source-health writes.
- **Manual generate**: never call `manual-generate` without the matching `promptMeta` from the prompt response.
- **Batch run**: do not use `/trigger` for Codex/batch execution (disabled by design); follow `AGENTS.md`.

## Common Mistakes

- Calling `POST /api/applications/manual-generate` without the matching `promptMeta` from the prompt response → import will reject with 409; always use prompt API first and pass its `promptMeta` into manual-generate.
- Assuming job URL is already normalized → use `canonicalizeJobUrl()` before dedupe checks or storage.
- Using batch trigger for Codex/automation → trigger is disabled; follow `AGENTS.md` for batch flows.
