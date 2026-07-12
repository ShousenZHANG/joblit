import { AppNav } from "@/components/app-shell/AppNav";
import { CommandPalette } from "@/components/app-shell/CommandPalette";
import { Starfield } from "@/components/landing/Starfield";
import { getTranslations } from "next-intl/server";
import { RouteTransition } from "../RouteTransition";
import { GuideProvider } from "../GuideContext";

// App shell — landing-aligned chrome. Swaps the legacy TopNav + edu-bg
// blobs for the shared AppNav pill + landing atmosphere gradient so the
// authenticated area reads as the same product as the marketing page.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("nav");

  return (
    <div className="relative grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-x-hidden overflow-y-auto lg:overflow-hidden">
      {/* Atmosphere, back→front: starfield → drifting aurora → nebula wash →
          grain. All fixed, pointer-events-none, z-0; content sits at z-1. The
          workspace gets the same sky as landing — it is where the user lives. */}
      <Starfield />
      <div aria-hidden className="landing-aurora">
        <span className="landing-aurora-blob landing-aurora-blob--1" />
        <span className="landing-aurora-blob landing-aurora-blob--2" />
        <span className="landing-aurora-blob landing-aurora-blob--3" />
        <span className="landing-aurora-blob landing-aurora-blob--4" />
      </div>
      <div aria-hidden className="landing-atmos" />
      {/* A solid dark fill reads flat and plastic; the grain is what makes
          deep space feel deep. */}
      <div aria-hidden className="landing-grain" />
      <GuideProvider>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-background focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-emerald-500 focus:ring-offset-2"
        >
          {t("skipToContent")}
        </a>
        <AppNav />
        <CommandPalette />
        <div className="relative z-[1] app-frame app-shell flex min-h-0 flex-col py-3 sm:py-4 md:py-5 lg:h-full">
          <main
            id="main-content"
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col outline-none"
          >
            <RouteTransition>{children}</RouteTransition>
          </main>
        </div>
      </GuideProvider>
    </div>
  );
}
