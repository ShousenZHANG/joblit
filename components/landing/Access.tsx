"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { revealUp, useReveal } from "./lib/motion";
import { SectionKicker } from "./SectionKicker";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Phase = "idle" | "submitting" | "success" | "redirecting" | "error";

// Access — replaces the old pricing grid now that the product is fully free +
// invite-only. A single focused card: one email field → POST /api/access-requests.
// The whole product is free, so there is nothing to compare; the job of this
// section is to convert intent into an access request with as little friction
// as possible (one field, one button, an honest free/perks line).
export function Access() {
  const reveal = useReveal();
  const t = useTranslations("landing.access");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const submitting = phase === "submitting";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setPhase("error");
      setErrorMsg(t("invalidEmail"));
      return;
    }
    setPhase("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (!res.ok) throw new Error("failed");
      const json = (await res.json().catch(() => ({}))) as { status?: string };
      if (json.status === "approved") {
        // Already cleared — go straight to OAuth sign-in (the gate confirms the
        // email on the third-party login). Full nav so NextAuth owns the flow.
        setPhase("redirecting");
        window.location.href = "/login";
        return;
      }
      setPhase("success");
    } catch {
      setPhase("error");
      setErrorMsg(t("errorBody"));
    }
  }

  return (
    <motion.section
      {...reveal}
      data-testid="landing-access"
      id="access"
      className="mx-auto w-full max-w-3xl px-6 py-24 sm:px-10"
      variants={revealUp}
    >
      <div className="mb-10 text-center">
        <SectionKicker>{t("kicker")}</SectionKicker>
        <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t("titlePrefix")}{" "}
          <em className="font-serif italic text-foreground">{t("titleItalic")}</em>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
          {t("lede")}
        </p>
      </div>

      <div className="relative mx-auto max-w-xl overflow-hidden rounded-3xl border border-border/60 bg-card p-6 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.22)] sm:p-8">
        {/* Emerald hairline + glow — matches the hero canvas treatment. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-emerald-400/60 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-12 left-1/2 -z-10 h-40 w-40 -translate-x-1/2 rounded-full bg-brand-emerald-400/15 blur-3xl"
        />

        <AnimatePresence mode="wait" initial={false}>
          {phase === "success" || phase === "redirecting" ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col items-center py-4 text-center"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-emerald-50 text-brand-emerald-600 ring-1 ring-brand-emerald-100">
                {phase === "redirecting" ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-6 w-6" aria-hidden />
                )}
              </span>
              <p className="mt-4 text-base font-semibold text-foreground">
                {phase === "redirecting" ? t("approvedTitle") : t("successTitle")}
              </p>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                {phase === "redirecting" ? t("approvedBody") : t("successBody")}
              </p>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              onSubmit={onSubmit}
              noValidate
            >
              <label htmlFor="access-email" className="text-sm font-medium text-foreground">
                {t("emailLabel")}
              </label>
              <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
                <input
                  id="access-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (phase === "error") setPhase("idle");
                  }}
                  placeholder={t("emailPlaceholder")}
                  aria-invalid={phase === "error"}
                  className="h-11 flex-1 rounded-full border border-border bg-background px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-brand-emerald-400 focus:ring-2 focus:ring-brand-emerald-200"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="group inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-brand-emerald-600 px-6 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-emerald-700 hover:shadow-md disabled:opacity-70"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      {t("submitting")}
                    </>
                  ) : (
                    <>
                      {t("submit")}
                      <ArrowRight
                        className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </>
                  )}
                </button>
              </div>
              <div className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
                {phase === "error" ? (
                  <span className="text-rose-600">{errorMsg}</span>
                ) : null}
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="mt-5 flex items-center justify-center gap-1.5 border-t border-border/50 pt-4 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand-emerald-600" aria-hidden />
          <span>{t("perks")}</span>
        </div>
      </div>
    </motion.section>
  );
}
