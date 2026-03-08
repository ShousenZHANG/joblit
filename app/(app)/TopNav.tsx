"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { CircleHelp, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { useGuide } from "../GuideContext";

export function TopNav() {
  const { data } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const { openGuide, state } = useGuide();
  const t = useTranslations("nav");
  const tc = useTranslations("common");

  const prepareRouteChange = () => {
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (appShell) {
      appShell.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  const links = [
    { href: "/jobs", label: t("jobs") },
    { href: "/fetch", label: t("fetch") },
    { href: "/resume", label: t("resume") },
    { href: "/automation", label: t("automation") },
  ];
  const mobileRoute = links.find((link) => pathname.startsWith(link.href))?.href ?? "/jobs";
  const email = data?.user?.email ?? "";

  return (
    <div className="sticky top-0 z-40">
      <div className="relative app-frame py-2">
        <div className="edu-nav edu-nav--press flex-col items-stretch gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center justify-between gap-4 lg:justify-start">
            <div className="flex items-center gap-3">
              <div className="edu-logo">
                <Search className="h-4 w-4 text-emerald-700" />
              </div>
              <Link
                className="text-lg font-semibold text-slate-900"
                href="/"
              >
                Jobflow
              </Link>
            </div>
            <nav className="hidden items-center gap-2 lg:flex">
              {links.map((link) => {
                const active = pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={prepareRouteChange}
                    className={`edu-nav-link edu-nav-pill ${
                      active ? "edu-nav-pill--active" : ""
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="lg:hidden" data-testid="mobile-route-select-wrap">
            <Select
              value={mobileRoute}
              onValueChange={(next) => {
                if (next === mobileRoute) return;
                prepareRouteChange();
                router.push(next);
              }}
            >
              <SelectTrigger
                data-testid="mobile-route-select"
                className="h-10 rounded-xl border-2 border-slate-900/20 bg-[#fdf2e7] text-sm font-semibold text-slate-700"
              >
                <SelectValue placeholder="Navigate" />
              </SelectTrigger>
              <SelectContent>
                {links.map((link) => (
                  <SelectItem key={`mobile-select-${link.href}`} value={link.href}>
                    {link.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-full items-center justify-end gap-2 text-sm sm:gap-3 lg:w-auto">
            {email ? (
              <a
                href={`mailto:${email}`}
                className="hidden text-emerald-700 transition hover:text-emerald-800 hover:underline sm:inline"
              >
                {email}
              </a>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="edu-outline edu-cta--press edu-outline--compact h-9 flex-1 px-3 text-xs sm:flex-none"
              onClick={openGuide}
            >
              <CircleHelp className="mr-1 h-3.5 w-3.5" />
              {t("guide")}
              {state ? (
                <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  {state.completedCount}/{state.totalCount}
                </span>
              ) : null}
            </Button>
            <LocaleSwitcher />
            <Button
              variant="outline"
              size="sm"
              className="edu-outline edu-cta--press edu-outline--compact h-9 flex-1 px-3 text-xs sm:flex-none"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              {tc("signOut")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

