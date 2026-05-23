export default function LoadingExtension() {
  return (
    <main className="route-loading-enter flex h-full min-h-0 flex-1 flex-col">
      <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border-2 border-border/60 bg-background/85 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 px-4 pb-2 pt-3 lg:px-6 lg:pb-4 lg:pt-6">
          <div className="space-y-2">
            <div className="h-7 w-44 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-64 max-w-full animate-pulse rounded bg-muted/60" />
          </div>
          <div className="h-9 w-32 shrink-0 animate-pulse rounded-xl bg-muted/50" />
        </div>
        {/* Content cards */}
        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 pb-4 lg:px-6 lg:pb-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="space-y-3 rounded-2xl border border-border/50 p-5"
            >
              <div className="h-5 w-40 animate-pulse rounded bg-muted/60" />
              <div className="h-4 w-full animate-pulse rounded bg-muted/40" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-muted/40" />
              <div className="h-10 w-full animate-pulse rounded-xl bg-muted/50" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
