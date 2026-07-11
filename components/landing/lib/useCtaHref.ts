"use client";

import { useSession } from "next-auth/react";

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
 *   unauthenticated → `/login` (sign-in)
 *   loading         → `#access` (the invite form stays available)
 *
 * The return shape stays stable for existing consumers, but every state is
 * actionable so a slow session request never creates a dead primary CTA.
 */
export function useCtaHref() {
  const { status } = useSession();
  if (status === "authenticated") {
    return { href: "/jobs", disabled: false } as const;
  }
  if (status === "unauthenticated") {
    return { href: "/login", disabled: false } as const;
  }
  // status === "loading" — SessionProvider is mid-fetch.
  return { href: "#access", disabled: false } as const;
}
