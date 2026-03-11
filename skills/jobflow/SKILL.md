---
name: jobflow
description: Use when working in the Jobflow repo (jobflow-web) or when discussing job fetch (JobSpy/LinkedIn/Seek/CN platforms), resume/cover tailoring, prompt rules/skill pack, or PDF export.
---

# Jobflow (jobflow-web)

Job-search command center: fetch → triage → tailor CV/CL → export PDFs.

## When to Use

- You are in the `ShousenZHANG/jobflow-web` repo, or the user mentions Jobflow/jobflow-web.
- The task involves job intake (JobSpy/LinkedIn, Seek manual add, CN platforms), prompt rules/skill pack, CV/CL generation, batch workflows, or PDF export.

## When NOT to Use

- For repositories other than jobflow-web (jobflow-tailoring pack is for Jobflow import only).
- When the task is generic job-search advice with no code or Jobflow workflow involved.

## Mental Model

- **Intake**
  - AU: FetchRun → GitHub Actions → Python JobSpy → import jobs (dedupe + tombstones)
  - CN: FetchRun → GitHub Actions → Python CN fetcher → import jobs
- **Workspace**: Jobs list + detail, search/filter, status `NEW`/`APPLIED`/`REJECTED`
- **Tailoring**: prompt → external model → strict JSON import → LaTeX render → PDF

## Key Paths (start here)

- UI pages: `app/(app)/` (`jobs`, `fetch`, `resume`, `resume/rules`)
- API routes: `app/api/` (`jobs`, `fetch-runs`, `applications`, `application-batches`, `prompt-rules`, `admin/import`)
- Server modules: `lib/server/` (AI prompts, LaTeX/PDF, persistence)
- Fetch workers: `tools/fetcher/` (`run_jobspy.py`, `run_cn_fetcher.py`, `cn_platforms/`)
- Schema: `prisma/schema.prisma`

More: `references/PATHS.md` and `references/FLOWS.md`.

## Non‑Negotiable Rules

- **Job dedupe**: unique `(userId, jobUrl)`; normalize with `canonicalizeJobUrl()`.
- **Manual generate**: never call `manual-generate` without the matching `promptMeta` from the prompt response.
- **Batch run**: do not use `/trigger` for Codex/batch execution (disabled by design); follow `AGENTS.md`.

## Common Mistakes

- Calling `POST /api/applications/manual-generate` without the matching `promptMeta` from the prompt response → import will reject with 409; always use prompt API first and pass its `promptMeta` into manual-generate.
- Assuming job URL is already normalized → use `canonicalizeJobUrl()` before dedupe checks or storage.
- Using batch trigger for Codex/automation → trigger is disabled; follow `AGENTS.md` for batch flows.

