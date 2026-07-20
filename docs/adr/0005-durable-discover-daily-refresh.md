# ADR-0005: Durable daily Discover refresh

- Status: Accepted
- Date: 2026-07-20

## Context

Discover serves two global feeds: YouTube learning videos and GitHub trending
repositories. Per-instance memory caches disappear on serverless cold starts.
That caused repeat upstream calls, avoidable YouTube quota use, and no durable
last-known-good GitHub fallback. Scheduled invocations can also overlap or be
delivered more than once, while a failed Vercel Cron invocation is not retried.

## Decision

- Use one Vercel Cron route, `GET /api/discover/refresh-daily`, at `0 6 * * *`
  (UTC). No job-fetch route is scheduled.
- Fail closed unless `Authorization: Bearer <CRON_SECRET>` matches in constant
  time. Mark the route dynamic and every response `Cache-Control: no-store`.
- Reuse `DiscoverVideoCache` as a namespaced global JSON cache. Repo keys are
  `repos:{weekly|monthly}:{raw|clean}`; video keys remain
  `videos:{category}:{week|month}`.
- Atomically claim `discover-refresh:YYYY-MM-DD` in PostgreSQL before upstream
  work. A 90-second lease exceeds the platform execution ceiling and allows
  later recovery after a crashed invocation. A random owner token fences final
  writes so an expired owner cannot overwrite a replacement run. The completed
  summary remains for seven days and deduplicates same-day delivery.
- Refresh GitHub first, independently for weekly and monthly periods, and
  persist both raw and clean views. Zero parsed rows are an upstream/parser
  failure and never replace last-known-good content.
- Missing YouTube configuration, quota exhaustion, timeout, or one target
  failure cannot block GitHub or other independent targets.
- Refresh the 16 historical YouTube trending category/window keys with
  concurrency two. A shared `AbortSignal` cancels in-flight outbound requests
  at 48 seconds, leaving headroom inside the route's 60-second limit.
- User-facing routes read fresh DB cache first, perform a live fetch only when
  needed, and serve expired last-known-good data when upstream fails.

## Consequences

- Daily traffic consumes a predictable YouTube quota budget and most Discover
  views avoid upstream calls.
- GitHub content remains available across cold starts and transient outages.
- Cron results are observable as a structured per-target summary without
  exposing upstream error text.
- `CRON_SECRET` must be configured in Vercel. `YOUTUBE_API_KEY` stays optional;
  without it, repository refresh still succeeds and video targets are reported
  as skipped.
