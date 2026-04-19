import { AppNav } from "@/components/app-shell/AppNav";
import { RouteTransition } from "../RouteTransition";
import { GuideProvider } from "../GuideContext";

// App shell — landing-aligned chrome. Swaps the legacy TopNav + edu-bg
// blobs for the shared AppNav pill + landing atmosphere gradient so the
// authenticated area reads as the same product as the marketing page.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-x-hidden overflow-y-auto lg:overflow-hidden">
      {/* Fixed gradient mesh behind the app (emerald/teal/amber wash,
          dark-mode quieter variant). Same atmosphere as landing. */}
      <div aria-hidden className="landing-atmos" />
      <GuideProvider>
        <AppNav />
        <div className="relative z-[1] app-frame app-shell flex min-h-0 flex-col py-3 sm:py-4 md:py-5 lg:h-full">
          <RouteTransition>{children}</RouteTransition>
        </div>
      </GuideProvider>
    </div>
  );
}

