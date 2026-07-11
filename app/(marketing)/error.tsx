"use client";

import { RouteErrorBoundary } from "@/components/error-boundary/RouteErrorBoundary";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" tabIndex={-1}>
      <RouteErrorBoundary error={error} reset={reset} />
    </main>
  );
}
