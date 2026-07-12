export default function LoadingJobs() {
  return (
    <div className="route-loading-enter flex min-h-0 flex-1 flex-col gap-2 lg:h-full lg:overflow-hidden">
      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* Left: job list column */}
        <section className="flex min-h-0 flex-col rounded-2xl border border-border/60 bg-background/85">
          {/* Search + filters */}
          <div className="shrink-0 space-y-3 border-b border-border/60 p-3">
            <div className="h-10 animate-pulse rounded-xl bg-muted/60" />
            <div className="flex gap-2">
              <div className="h-8 w-28 animate-pulse rounded-full bg-muted/50" />
              <div className="h-8 w-24 animate-pulse rounded-full bg-muted/50" />
              <div className="ml-auto h-8 w-16 animate-pulse rounded-full bg-muted/50" />
            </div>
            {/* Status tabs */}
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-7 w-16 animate-pulse rounded-full bg-muted/40" />
              ))}
            </div>
          </div>
          {/* Job rows */}
          <div className="flex-1 space-y-2 overflow-hidden p-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="space-y-2 rounded-xl border border-border/50 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="h-5 w-14 animate-pulse rounded-full bg-muted/50" />
                  <div className="h-3 w-12 animate-pulse rounded bg-muted/40" />
                </div>
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted/60" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
              </div>
            ))}
          </div>
        </section>

        {/* Right: detail panel (desktop only) */}
        <section className="hidden min-h-0 flex-col rounded-2xl border border-border/60 bg-background/85 p-6 lg:flex">
          <div className="space-y-3">
            <div className="h-7 w-2/3 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted/60" />
            <div className="flex gap-2 pt-2">
              <div className="h-9 w-28 animate-pulse rounded-xl bg-muted/60" />
              <div className="h-9 w-28 animate-pulse rounded-xl bg-muted/50" />
              <div className="h-9 w-24 animate-pulse rounded-xl bg-muted/40" />
            </div>
          </div>
          <div className="mt-6 flex-1 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-muted/40"
                style={{ width: `${90 - (i % 3) * 15}%` }}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
