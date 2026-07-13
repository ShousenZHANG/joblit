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
 *   unauthenticated → `/login` (sign-in)
 *   loading         → `/login` (sign-in remains immediately actionable)
 *
 * The hook also owns the translated label so every primary marketing CTA uses
 * the same authenticated/unauthenticated semantics. Every state is actionable,
 * so a slow session request never creates a dead primary CTA.
 */
export function useCtaHref() {
  const { status } = useSession();
  const t = useTranslations("landing.nav");
  if (status === "authenticated") {
    return { href: "/jobs", disabled: false, label: t("openApp") } as const;
  }
  return { href: "/login", disabled: false, label: t("startFree") } as const;
}
