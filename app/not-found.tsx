import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-6">
      <div className="landing-atmos" aria-hidden />
      <div className="relative z-[1] w-full max-w-md rounded-3xl border border-border/70 bg-background/90 p-8 text-center shadow-[0_18px_40px_-32px_rgba(15,23,42,0.3)] backdrop-blur">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-emerald-50 text-brand-emerald-700">
          <Compass className="h-7 w-7" aria-hidden />
        </div>
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-brand-emerald-700">
          404
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The page you are looking for moved or never existed. Head back to your
          jobs to keep going.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href="/jobs"
            className="inline-flex h-10 items-center rounded-full bg-brand-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-emerald-700"
          >
            Back to jobs
          </Link>
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-full border border-border px-5 text-sm font-semibold text-foreground/85 transition-colors hover:bg-muted"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
