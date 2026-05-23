export default function MarketingLoading() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="landing-atmos" />
      <div className="relative z-[1] mx-auto flex w-full max-w-6xl flex-col items-center gap-20 px-6 pt-6">
        {/* Nav pill skeleton */}
        <div className="h-14 w-full animate-pulse rounded-full border border-border/60 bg-card" />

        {/* Hero skeleton — centered headline + dual CTA + product mock */}
        <div className="flex w-full flex-col items-center gap-5 pt-10">
          <div className="h-7 w-56 animate-pulse rounded-full bg-muted" />
          <div className="h-16 w-full max-w-2xl animate-pulse rounded-2xl bg-muted" />
          <div className="h-16 w-full max-w-xl animate-pulse rounded-2xl bg-muted" />
          <div className="h-5 w-80 max-w-full animate-pulse rounded-lg bg-muted/70" />
          <div className="mt-2 flex gap-3">
            <div className="h-11 w-32 animate-pulse rounded-full bg-muted" />
            <div className="h-11 w-32 animate-pulse rounded-full bg-muted/70" />
          </div>
          {/* Product mock */}
          <div className="mt-12 h-[360px] w-full max-w-5xl animate-pulse rounded-3xl border border-border/60 bg-card" />
        </div>

        {/* Stat strip skeleton */}
        <div className="flex w-full flex-wrap items-center justify-center gap-10">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted/60" />
            </div>
          ))}
        </div>

        {/* Section card grid skeleton */}
        <div className="grid w-full gap-5 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-2xl border border-border/60 bg-card"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
