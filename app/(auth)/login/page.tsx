"use client";

import { signIn, useSession } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Github } from "lucide-react";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/providers/ThemeProvider";

// Landing-aligned auth page:
// - Fixed emerald/teal atmosphere mesh behind content (same as marketing)
// - Single centered surface card with serif italic emphasis on the
//   welcome headline, matching the landing hero voice
// - Theme-token chrome everywhere so dark mode renders cleanly
// - Kept the existing OAuth flow verbatim — only the shell changed

export default function LoginPage() {
  const { status } = useSession();
  const router = useRouter();
  const t = useTranslations("loginPage");

  useEffect(() => {
    if (status === "authenticated") {
      const sp = new URLSearchParams(window.location.search);
      const callbackUrl = sp.get("callbackUrl") || "/jobs";
      router.replace(callbackUrl);
    }
  }, [status, router]);

  function handleSignIn(provider: "google" | "github") {
    const sp = new URLSearchParams(window.location.search);
    const callbackUrl = sp.get("callbackUrl") || "/jobs";
    signIn(provider, { callbackUrl });
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-6 pb-16 pt-8 sm:px-10">
      <div aria-hidden className="landing-atmos" />

      <div className="relative z-[1] mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-5xl flex-col">
        {/* Minimal top bar — logo + locale + theme. No primary nav on
            auth pages; keeps focus on the sign-in affordance. */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground transition-colors hover:text-brand-emerald-700"
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
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
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

            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-emerald-200 bg-brand-emerald-50 px-3 py-1 text-[11px] font-semibold text-brand-emerald-700">
                <span
                  aria-hidden
                  className="flex h-1.5 w-1.5 rounded-full bg-brand-emerald-600"
                />
                {t("secureSignIn")}
              </span>

              <h1 className="mt-5 text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl sm:leading-[1.1]">
                {t("welcomeBack")}
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t("subtitle")}
              </p>

              <div className="mt-7 flex flex-col gap-3">
                <Button
                  onClick={() => handleSignIn("google")}
                  className="h-11 w-full justify-center gap-2 rounded-full bg-foreground text-[13px] font-semibold text-background transition-transform hover:-translate-y-px hover:bg-foreground/90"
                >
                  {t("continueGoogle")}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  onClick={() => handleSignIn("github")}
                  variant="outline"
                  className="h-11 w-full justify-center gap-2 rounded-full border-border bg-background text-[13px] font-semibold text-foreground hover:bg-muted"
                >
                  <Github className="h-4 w-4" aria-hidden />
                  {t("continueGithub")}
                </Button>
              </div>

              <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
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
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
