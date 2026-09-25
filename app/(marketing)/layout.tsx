import { Instrument_Sans } from "next/font/google";
import { getTranslations } from "next-intl/server";

// Display face for marketing headlines only. The width axis is loaded so
// headings can run condensed; body copy stays in the product's Geist.
const display = Instrument_Sans({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-landing-display",
  display: "swap",
});

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("marketing");

  return (
    <div className={`contents ${display.variable}`}>
      {/* Skip link — first focusable element so keyboard/screen-reader users can
          jump past the sticky nav straight to the page content. Visually hidden
          until focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-background focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-emerald-500 focus:ring-offset-2"
      >
        {t("skipToContent")}
      </a>
      {children}
    </div>
  );
}
