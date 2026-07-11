"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import * as React from "react";

const subscribeToClient = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Root theme provider. Wire this at the app layout so both the marketing
 * landing and the authenticated shell share one theme source. Uses the
 * `class` attribute strategy so our Tailwind v4 `.dark` overrides in
 * `app/globals.css` light up without a round-trip.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

/**
 * Icon-only toggle. Avoids the classic SSR hydration mismatch by rendering
 * a placeholder until the client mounts and the persisted theme is known.
 */
export function ThemeToggle({
  className,
  size = "compact",
}: {
  className?: string;
  size?: "compact" | "touch";
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations("common");
  const mounted = React.useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot,
  );

  const isDark = resolvedTheme === "dark";
  const label = mounted
    ? isDark
      ? t("themeSwitchToLight")
      : t("themeSwitchToDark")
    : t("themeToggle");

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={
        `inline-flex ${size === "touch" ? "h-11 w-11" : "h-9 w-9"} items-center justify-center rounded-full border border-border bg-background/80 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ` +
        (className ?? "")
      }
    >
      {mounted ? (
        isDark ? (
          <Moon className="h-4 w-4" aria-hidden />
        ) : (
          <Sun className="h-4 w-4" aria-hidden />
        )
      ) : (
        <span className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
