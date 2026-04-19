"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-background/90 p-6 shadow-sm backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-2">
          <AlertCircle
            className="size-5 text-brand-emerald-600"
            aria-hidden
          />
          <h2 className="text-lg font-semibold text-foreground">
            Something went wrong
          </h2>
        </div>
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
        <Button
          type="button"
          onClick={reset}
          className="rounded-full bg-brand-emerald-600 px-4 text-white hover:bg-brand-emerald-700"
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
