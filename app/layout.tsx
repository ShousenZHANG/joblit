import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";

// Geist Sans + Mono are Vercel's first-party font system designed for
// hi-density UIs and big numerals. Replaces the previous Source Sans 3
// + JetBrains Mono pairing that was masquerading under the same CSS
// variable names. The `geist` npm package self-hosts the fonts so we
// avoid an extra Google Fonts hop on first paint.
const geistSans = GeistSans;
const geistMono = GeistMono;

// Italic serif display face used for the Hero title emphasis
// ("re-engineered.") and every deep-dive / section heading <em>.
// Matches Landing.html which loads Instrument Serif for the same purpose.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.JOBLIT_WEB_URL ?? "https://www.joblit.tech"),
  title: {
    default: "Joblit Dashboard",
    template: "%s | Joblit",
  },
  description: "Job tracking and automated discovery dashboard.",
  // Next.js auto-discovers app/icon.svg + app/apple-icon.svg.
  // Setting an explicit shortcut + apple block keeps legacy crawlers
  // happy and overrides any cached default favicon (e.g. Vercel).
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/apple-icon.svg", type: "image/svg+xml" }],
  },
};

export const viewport = {
  themeColor: "#047857",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
