"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

/**
 * Shared landing-page CTA routing.
 *
 * Every "Start free" / "Open app" / "Log in" link on the marketing
 * surface used to hardcode `/login` — which caused a visible flash of
 * the login page for already-signed-in visitors (login page redirects
 * them to /jobs on mount via useEffect). Routing through this hook
 * resolves the right destination up-front:
 *
 *   authenticated   → `/jobs` (straight into the app)
 *   unauthenticated → `/login?callbackUrl=/jobs` (direct sign-in)
 *   loading         → `/jobs` (server resolves auth)
 *
 * The loading and authenticated states share one destination, preventing the
 * hydration race. A known signed-out visitor can still take the shorter direct
 * sign-in path. Only authenticated users prefetch the protected workspace.
 */
export function useCtaHref() {
  const { status } = useSession();
  const t = useTranslations("landing.nav");
  const authenticated = status === "authenticated";

  return {
    href:
      status === "unauthenticated"
        ? "/login?callbackUrl=/jobs"
        : "/jobs",
    disabled: false,
    label: t(authenticated ? "openApp" : "startFree"),
    prefetch: authenticated,
  } as const;
}
