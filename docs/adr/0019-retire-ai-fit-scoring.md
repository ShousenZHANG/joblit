# ADR-0019: Retire AI fit scoring

- **Status:** Accepted
- **Date:** 2026-08-09
- **Context owner:** Joblit Engineering
- **Supersedes:** ADR-0016 in full (its Hermes recovery was already superseded
  by ADR-0018; its Fit-queue durability decisions retire here with the queue
  they protected)

## Context

Fit scoring asked a model to judge every JD requirement against the user's
profile, aggregated those judgements into a deterministic score server-side,
and used the score to triage the feed. It was engineered carefully — durable
`FitBatchClaim` leases, content-addressed prompts, receipt-backed settlement,
a frozen golden set replaying recorded model output through the real
aggregator — and it still did not earn its place.

The UI told the story first. The July–August triage rounds deleted the score
filter, the fit sort, the score badges, and the low-fit bulk-ignore flow, each
time because the deterministic signals beside them — the evidence-backed JD
requirements analysis, posting risk, plain recency — were doing the actual
triage work. By August the entire user-visible surface of fit scoring was
three Match/Gap/Partial badges on technology chips, and the landing page was
advertising the feature more prominently than the product exposed it.

What remained underneath was the heaviest writer-less chain in the codebase:
eleven API routes, five server modules, three tables, seven Job columns, a
Runner drain loop, and a triage prompt family — roughly four thousand lines
maintaining a number nobody looked at.

## Decision

Delete the feature, not just the UI.

1. **The queue, the receipts, and the projections go together.**
   `FitBatchClaim`, `FitBatchClaimItem`, `FitBatchImportReceipt`, their enums,
   and the seven `Job.fit*` columns are dropped in
   `20260809190000_retire_fit_scoring`. The `/api/jobs/fit/**` routes, the
   fit-coupled `/api/jobs/bulk-ignore` route, `fitRunService`,
   `fitBatchImport`, `fitScoring`, `fitPrescreen`, `fitGolden`, the lean
   match/triage prompt builders, and the Runner's `fitQueue` drain are deleted
   with them. The `"match"` and `"triage"` prompt targets leave the contracts.

2. **Old credentials must not brick.** Every pre-retirement `AgentCredential`
   was minted with `fit:drain` in its capability list, and validation rejects
   credentials carrying unknown capabilities. `fit:drain` therefore moves to a
   `LEGACY_AGENT_CAPABILITIES` list that validation tolerates but minting no
   longer issues. No route requires it, so the value is inert — but removing
   it from the known set would have revoked every existing Runner credential
   as a side effect, including its live tailoring capabilities.

3. **What fit claimed to do, the deterministic analysis actually does.** The
   JD requirements analysis (`lib/shared/jobExperienceAnalysis`,
   `jdTechnicalAnalysis`) extracts the hard asks — years of experience,
   clearances, work rights, named technologies — with evidence offsets that
   jump to the exact sentence in the ad. It has no model in the loop, so the
   same ad always reads the same way. The landing bento cell that sold fit now
   sells this, because it is the thing that survived contact with real use.

4. **Posting risk is untouched.** It was designed as a separate axis
   (deterministic, computed at import, zero LLM) and remains one.

## Deployment note

The drop migration and the code that stops selecting the dropped columns ship
in one release. Between `prisma migrate deploy` finishing and the new
deployment taking the alias, old serverless instances that SELECT `Job.fit*`
will error. That window is minutes on Vercel, the deployment is effectively
single-tenant today, and the alternative was a two-release expand/contract
dance for columns nothing reads. Accepted deliberately; ADR-0017's staged
pattern remains the template for retirements where the window matters.

## Consequences

- The Runner's cycle is tailoring only: claim a batch task, generate through
  the Codex CLI, import with the receipt. Its `fit:drain` API calls are gone.
- `AGENTS.md` loses the Fit Settlement Contract section; the batch tailoring
  protocol is unchanged.
- The golden-set evaluation harness goes with the aggregator it evaluated. If
  a future scoring feature returns, it should inherit the *discipline* (frozen
  replays through deterministic aggregation), not the code.
- Historical fit data is destroyed by the migration. It was derived data — a
  cached model opinion about a resume snapshot that has since changed — and
  re-derivable in principle by any future feature that wants it.
- The retired routes must not be reintroduced:
  `/api/jobs/fit/**` and `/api/jobs/bulk-ignore` join the pinned-absent list.
