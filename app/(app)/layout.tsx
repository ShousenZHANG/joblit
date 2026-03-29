import { Fredoka, Nunito } from "next/font/google";
import { TopNav } from "./TopNav";
import { RouteTransition } from "../RouteTransition";
import { GuideProvider } from "../GuideContext";

const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-edu-display",
  weight: ["400", "500", "600", "700"],
});

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-edu-body",
  weight: ["300", "400", "500", "600", "700"],
});

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`app-edu ${fredoka.variable} ${nunito.variable} relative grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-x-hidden overflow-y-auto lg:overflow-hidden`}
    >
      <div className="edu-bg" />
      <div className="edu-blob edu-blob--mint" />
      <div className="edu-blob edu-blob--peach" />
      <GuideProvider>
        <TopNav />
        <div className="relative z-10 app-frame app-shell flex min-h-0 flex-col py-2 sm:py-3 md:py-4 lg:h-full">
          <RouteTransition>{children}</RouteTransition>
        </div>
      </GuideProvider>
    </div>
  );
}

