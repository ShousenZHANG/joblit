"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { SessionProvider } from "next-auth/react";
import NextTopLoader from "nextjs-toploader";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { FetchProgressPanel } from "./FetchProgressPanel";
import { FetchStatusProvider } from "./FetchStatusContext";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 15_000,
          },
        },
      }),
  );

  return (
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <NextTopLoader color="#111827" height={2} showSpinner={false} />
            <FetchStatusProvider>
              {children}
              <FetchProgressPanel />
            </FetchStatusProvider>
            <Toaster />
          </SessionProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}

