"use client";

import { useEffect } from "react";

// global-error replaces the entire document and renders OUTSIDE the
// NextIntlClientProvider, so it cannot use useTranslations. We read the
// `locale` cookie (same cookie i18n/request.ts uses: values "en" | "zh") and
// pick a self-contained inline string table. These mirror the catalog
// `errors.route.*` keys but are inlined here intentionally.
const STRINGS = {
  en: {
    title: "Something went wrong",
    message:
      "The app hit an unexpected error. Try again — if it keeps happening, reload the page.",
    tryAgain: "Try again",
    backToJobs: "Back to jobs",
  },
  zh: {
    title: "出错了",
    message: "应用遇到意外错误。请重试 —— 如果仍然发生，请刷新页面。",
    tryAgain: "重试",
    backToJobs: "返回职位",
  },
} as const;

function readLocale(): "en" | "zh" {
  if (typeof document === "undefined") return "en";
  const match = document.cookie.match(/(?:^|;\s*)locale=(en|zh)/);
  return match?.[1] === "zh" ? "zh" : "en";
}

// Root-layout crash fallback. global-error replaces the entire document, so it
// must render its own <html>/<body> and cannot rely on app providers or theme
// tokens being mounted — styles are inlined and self-contained.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    } else {
      console.error(
        `[global-error] ${error.name}: ${error.message}`,
        error.digest ? `(digest ${error.digest})` : "",
      );
    }
  }, [error]);

  const locale = readLocale();
  const t = STRINGS[locale];

  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f8fafc",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          color: "#0f172a",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "28rem",
            borderRadius: "1.25rem",
            border: "1px solid #e2e8f0",
            background: "#ffffff",
            padding: "2rem",
            textAlign: "center",
            boxShadow: "0 18px 40px -32px rgba(15,23,42,0.3)",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
            {t.title}
          </h1>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#64748b",
            }}
          >
            {t.message}
          </p>
          <div
            style={{
              marginTop: "1.5rem",
              display: "flex",
              gap: "0.5rem",
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: "2.5rem",
                padding: "0 1.25rem",
                borderRadius: "9999px",
                border: "none",
                background: "#059669",
                color: "#ffffff",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t.tryAgain}
            </button>
            <a
              href="/jobs"
              style={{
                height: "2.5rem",
                display: "inline-flex",
                alignItems: "center",
                padding: "0 1.25rem",
                borderRadius: "9999px",
                border: "1px solid #e2e8f0",
                color: "#0f172a",
                fontSize: "0.875rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {t.backToJobs}
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
