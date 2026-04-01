import type { Metadata } from "next";
import Link from "next/link";
import { Search, ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Terms of Service — Jobflow",
  description: "Terms governing use of the Jobflow application.",
};

export default async function TermsOfServicePage() {
  const t = await getTranslations("terms");

  return (
    <div className="marketing-edu relative min-h-[100dvh] overflow-hidden">
      <div className="edu-bg" aria-hidden="true" />

      <div className="relative z-[2] mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <nav className="mb-8 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold text-slate-800 transition-colors hover:text-slate-900"
          >
            <Search className="h-4 w-4 text-emerald-700" />
            Jobflow
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
        </nav>

        <article className="prose prose-slate max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-base prose-p:leading-relaxed prose-li:leading-relaxed prose-a:text-emerald-700 prose-a:no-underline hover:prose-a:underline">
          <h1>{t("title")}</h1>
          <p className="text-sm text-slate-500">
            {t("lastUpdated")}
          </p>

          <p>{t("intro")}</p>

          {/* Section 1 */}
          <h2>{t("s1Title")}</h2>
          <p>{t("s1")}</p>

          {/* Section 2 */}
          <h2>{t("s2Title")}</h2>
          <p>{t("s2")}</p>

          {/* Section 3 */}
          <h2>{t("s3Title")}</h2>
          <p>{t("s3")}</p>

          {/* Section 4 */}
          <h2>{t("s4Title")}</h2>
          <p>{t("s4Intro")}</p>
          <ul>
            <li>{t("s4_1")}</li>
            <li>{t("s4_2")}</li>
            <li>{t("s4_3")}</li>
            <li>{t("s4_4")}</li>
            <li>{t("s4_5")}</li>
            <li>{t("s4_6")}</li>
            <li>{t("s4_7")}</li>
            <li>{t("s4_8")}</li>
          </ul>

          {/* Section 5 */}
          <h2>{t("s5Title")}</h2>
          <p>{t("s5_1")}</p>
          <p>{t("s5_2")}</p>
          <p>{t("s5_3")}</p>
          <p>{t("s5_4")}</p>

          {/* Section 6 */}
          <h2>{t("s6Title")}</h2>
          <p>{t("s6")}</p>

          {/* Section 7 */}
          <h2>{t("s7Title")}</h2>
          <p>{t("s7")}</p>

          {/* Section 8 */}
          <h2>{t("s8Title")}</h2>
          <p>{t("s8")}</p>

          {/* Section 9 */}
          <h2>{t("s9Title")}</h2>
          <p>{t("s9")}</p>

          {/* Section 10 */}
          <h2>{t("s10Title")}</h2>
          <p>{t("s10")}</p>

          {/* Section 11 */}
          <h2>{t("s11Title")}</h2>
          <p>{t("s11")}</p>

          {/* Section 12 */}
          <h2>{t("s12Title")}</h2>
          <ul>
            <li>{t("s12_1")}</li>
            <li>{t("s12_2")}</li>
            <li>{t("s12_3")}</li>
            <li>{t("s12_4")}</li>
            <li>{t("s12_5")}</li>
          </ul>

          {/* Section 13 */}
          <h2>{t("s13Title")}</h2>
          <p>{t("s13")}</p>
          <p>
            <strong>Email:</strong>{" "}
            <a href={`mailto:${t("s13Email")}`}>{t("s13Email")}</a>
          </p>
        </article>

        <footer className="mt-12 border-t border-slate-200 pt-6 text-center text-sm text-slate-500">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/" className="flex items-center gap-1.5 font-semibold text-slate-900">
              <Search className="h-3.5 w-3.5 text-emerald-700" />
              Jobflow
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link href="/privacy" className="hover:text-slate-900">Privacy</Link>
            <span aria-hidden="true">&middot;</span>
            <Link href="/terms" className="text-emerald-700">Terms</Link>
            <span aria-hidden="true">&middot;</span>
            <span>&copy; {new Date().getFullYear()} All rights reserved.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
