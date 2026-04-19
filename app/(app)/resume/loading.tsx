export default function LoadingResume() {
  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <section className="flex h-full min-h-0 flex-1 flex-col rounded-3xl border-2 border-border/60 bg-background/85 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur overflow-hidden route-loading-enter">
        {/* Header skeleton */}
        <div className="shrink-0 px-6 pt-6 pb-4 space-y-2">
          <div className="h-7 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded-lg bg-muted/70" />
        </div>

        {/* Three-panel layout skeleton */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left nav strip (desktop only) */}
          <div className="hidden lg:flex w-56 shrink-0 border-r border-border/60 flex-col p-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-muted/60" />
            ))}
          </div>

          {/* Center form area */}
          <div className="flex flex-1 flex-col min-h-0">
            {/* Mobile nav skeleton */}
            <div className="lg:hidden flex gap-2 px-4 py-2 border-b border-border/60 overflow-hidden">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 w-20 shrink-0 animate-pulse rounded-full bg-muted/60" />
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
              {/* Version selector skeleton */}
              <div className="rounded-2xl border border-border/60 bg-background/70 p-4 space-y-3">
                <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
                <div className="h-11 animate-pulse rounded-xl bg-muted/50" />
                <div className="h-11 animate-pulse rounded-xl bg-muted/50" />
              </div>

              {/* Form fields skeleton */}
              <div className="mt-6 space-y-4">
                <div className="h-6 w-40 animate-pulse rounded-lg bg-muted" />
                <div className="h-4 w-64 animate-pulse rounded-lg bg-muted/60" />
                <div className="grid gap-3 md:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <div className="h-4 w-20 animate-pulse rounded bg-muted/60" />
                      <div className="h-10 animate-pulse rounded-lg bg-muted/50" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right preview panel (desktop only) — A4 proportioned */}
          <div className="hidden md:flex w-[400px] shrink-0 border-l border-border/60 flex-col p-4">
            <div className="h-4 w-16 animate-pulse rounded bg-muted/60 mb-3" />
            <div className="flex flex-1 items-start justify-center">
              <div className="w-full max-w-[280px] aspect-[1/1.414] animate-pulse rounded-sm bg-muted/50" />
            </div>
          </div>
        </div>

        {/* Bottom action bar skeleton */}
        <div className="shrink-0 border-t border-border/60 px-4 py-3 flex items-center justify-between">
          <div className="h-4 w-28 animate-pulse rounded bg-muted/60" />
          <div className="flex gap-2">
            <div className="h-8 w-16 animate-pulse rounded-md bg-muted/60 md:hidden" />
            <div className="h-8 w-20 animate-pulse rounded-md bg-muted/70" />
          </div>
        </div>
      </section>
    </main>
  );
}
