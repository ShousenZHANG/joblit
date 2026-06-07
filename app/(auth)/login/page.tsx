"use client";

import { signIn, useSession } from "next-auth/react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Github, Loader2 } from "lucide-react";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion, type Variants } from "framer-motion";

import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/providers/ThemeProvider";

// Landing-aligned auth page. Single centered surface card, theme-token chrome,
// staggered entrance, and per-provider "connecting" feedback so a click lands
// with immediate response instead of a frozen button during the OAuth redirect.

type Provider = "google" | "github";

// Google's 4-colour "G" — brand-correct mark for provider parity (GitHub already
// carries its glyph). Inline SVG so there's no extra request / asset to manage.
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function LoginPageInner() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("loginPage");
  const reduced = useReducedMotion();
  const [loadingProvider, setLoadingProvider] = useState<Provider | null>(null);

  // NextAuth routes the invite-gate rejection here as ?error=AccessDenied
  // (pages.error = "/login"). Read it straight from the (reactive) search params
  // — no effect + setState, so there's no cascading render and no hydration
  // drift. The page is wrapped in <Suspense> below, as useSearchParams requires.
  const authError = searchParams.get("error");
  const callbackUrl = searchParams.get("callbackUrl") || "/jobs";

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(callbackUrl);
    }
  }, [status, router, callbackUrl]);

  function handleSignIn(provider: Provider) {
    if (loadingProvider) return;
    // Feedback BEFORE the redirect — the button shows "Connecting…" during the
    // hop to the provider instead of sitting frozen.
    setLoadingProvider(provider);
    void signIn(provider, { callbackUrl });
  }

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } },
  };
  const item: Variants = reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.3 } } }
    : {
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
      };

  const busy = loadingProvider !== null;

  return (
    <main className="relative min-h-screen overflow-hidden px-6 pb-16 pt-8 sm:px-10">
      <div aria-hidden className="landing-atmos" />

      <div className="relative z-[1] mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-5xl flex-col">
        {/* Minimal top bar — logo + locale + theme. No primary nav on
            auth pages; keeps focus on the sign-in affordance. */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg text-[15px] font-semibold tracking-tight text-foreground transition-colors hover:text-brand-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-500 focus-visible:ring-offset-2"
            aria-label="Joblit home"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-emerald-50 ring-1 ring-brand-emerald-100">
              <JoblitMark size={18} color="var(--brand-emerald-700, #047857)" ariaLabel={null} />
            </span>
            Joblit
          </Link>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16, scale: reduced ? 1 : 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mt-12 flex flex-1 items-center justify-center"
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-background/85 p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_20px_42px_-18px_rgba(5,150,105,0.2)] backdrop-blur-sm sm:p-10"
            data-testid="login-card"
          >
            {/* Corner glow — subtle emerald accent that pairs with the
                landing hero banner. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-brand-emerald-200/40 to-transparent blur-2xl"
            />
            {/* Top hairline, matching the hero canvas + access card. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-emerald-400/60 to-transparent"
            />

            <motion.div variants={container} initial="hidden" animate="show" className="relative">
              <motion.span
                variants={item}
                className="inline-flex items-center gap-2 rounded-full border border-brand-emerald-200 bg-brand-emerald-50 px-3 py-1 text-[11px] font-semibold text-brand-emerald-700"
              >
                <span
                  aria-hidden
                  className="flex h-1.5 w-1.5 rounded-full bg-brand-emerald-600"
                />
                {t("secureSignIn")}
              </motion.span>

              {authError === "AccessDenied" ? (
                <motion.div variants={item}>
                  <h1 className="mt-5 text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl sm:leading-[1.1]">
                    {t("deniedTitle")}
                  </h1>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {t("deniedBody")}
                  </p>
                  <Button
                    asChild
                    className="mt-6 h-11 w-full justify-center gap-2 rounded-full bg-brand-emerald-600 text-[13px] font-semibold text-white transition-colors hover:bg-brand-emerald-700"
                  >
                    <Link href="/#access">
                      {t("requestAccess")}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                  <p className="mt-6 text-xs font-medium text-muted-foreground">
                    {t("tryAnother")}
                  </p>
                </motion.div>
              ) : (
                <motion.div variants={item}>
                  <h1 className="mt-5 text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl sm:leading-[1.1]">
                    {t("welcomeBack")}
                  </h1>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {t("subtitle")}
                  </p>
                  {authError ? (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {t("genericError")}
                    </div>
                  ) : null}
                </motion.div>
              )}

              <motion.div variants={item} className="mt-7 flex flex-col gap-3">
                <Button
                  onClick={() => handleSignIn("google")}
                  disabled={busy}
                  aria-busy={loadingProvider === "google"}
                  className="h-11 w-full justify-center gap-2.5 rounded-full bg-foreground text-[13px] font-semibold text-background transition-all hover:-translate-y-px hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-500 focus-visible:ring-offset-2 active:translate-y-0 active:scale-[0.99] disabled:translate-y-0 disabled:opacity-60"
                >
                  {loadingProvider === "google" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      {t("connecting")}
                    </>
                  ) : (
                    <>
                      <GoogleIcon className="h-[18px] w-[18px]" />
                      {t("continueGoogle")}
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => handleSignIn("github")}
                  disabled={busy}
                  aria-busy={loadingProvider === "github"}
                  variant="outline"
                  className="h-11 w-full justify-center gap-2.5 rounded-full border-border bg-background text-[13px] font-semibold text-foreground transition-all hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-500 focus-visible:ring-offset-2 active:scale-[0.99] disabled:opacity-60"
                >
                  {loadingProvider === "github" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      {t("connecting")}
                    </>
                  ) : (
                    <>
                      <Github className="h-4 w-4" aria-hidden />
                      {t("continueGithub")}
                    </>
                  )}
                </Button>
              </motion.div>

              <motion.p
                variants={item}
                className="mt-6 text-xs leading-relaxed text-muted-foreground"
              >
                {t("agreementPrefix")}{" "}
                <Link
                  href="/terms"
                  className="font-medium text-foreground underline decoration-border underline-offset-2 transition-colors hover:text-brand-emerald-700 hover:decoration-brand-emerald-300"
                >
                  {t("terms")}
                </Link>{" "}
                {t("and")}{" "}
                <Link
                  href="/privacy"
                  className="font-medium text-foreground underline decoration-border underline-offset-2 transition-colors hover:text-brand-emerald-700 hover:decoration-brand-emerald-300"
                >
                  {t("privacyPolicy")}
                </Link>
              </motion.p>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </main>
  );
}

// useSearchParams must be inside a Suspense boundary (Next renders the params-
// dependent subtree on the client). The fallback is null — the card's entrance
// animation already covers the brief first paint.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
