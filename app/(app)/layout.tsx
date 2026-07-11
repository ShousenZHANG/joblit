import { AppNav } from "@/components/app-shell/AppNav";
import { CommandPalette } from "@/components/app-shell/CommandPalette";
import { Starfield } from "@/components/landing/Starfield";
import { RouteTransition } from "../RouteTransition";
import { GuideProvider } from "../GuideContext";

// App shell — landing-aligned chrome. Swaps the legacy TopNav + edu-bg
// blobs for the shared AppNav pill + landing atmosphere gradient so the
// authenticated area reads as the same product as the marketing page.
export default function AppLayout({ children }: { children: React.ReactNode }) {
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
      </div>
      <div aria-hidden className="landing-atmos" />
      {/* A solid dark fill reads flat and plastic; the grain is what makes
          deep space feel deep. */}
      <div aria-hidden className="landing-grain" />
      <GuideProvider>
        <AppNav />
        <CommandPalette />
        <div className="relative z-[1] app-frame app-shell flex min-h-0 flex-col py-3 sm:py-4 md:py-5 lg:h-full">
          <RouteTransition>{children}</RouteTransition>
        </div>
      </GuideProvider>
    </div>
  );
}

