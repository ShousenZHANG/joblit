"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { CircleHelp, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  ];
  const activeLink = links.find((link) => pathname.startsWith(link.href)) ?? links[0];
  const email = data?.user?.email ?? "";

  return (
    <div className="sticky top-0 z-40">
      <div className="relative app-frame py-2">
        {/* Desktop nav */}
        <div className="hidden lg:block">
          <div className="edu-nav edu-nav--press flex items-center justify-between gap-3">
            <div className="flex items-center gap-4">
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
              <nav className="flex items-center gap-2">
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
            <div className="flex items-center gap-3 text-sm">
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
                className="edu-outline edu-cta--press edu-outline--compact h-9 px-3 text-xs"
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
                className="edu-outline edu-cta--press edu-outline--compact h-9 px-3 text-xs"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                {tc("signOut")}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile nav – minimal app bar */}
        <div className="lg:hidden">
          <div className="flex items-center justify-between gap-3 rounded-3xl border-2 border-slate-900/10 bg-white/90 px-3 py-2 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.45)]">
            <div className="flex items-center gap-2">
              <div className="edu-logo h-9 w-9">
                <Search className="h-4 w-4 text-emerald-700" />
              </div>
              <Link
                href="/"
                className="text-sm font-semibold text-slate-900"
              >
                Jobflow
              </Link>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="mobile-current-route"
                  className="rounded-full px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 active:bg-slate-200"
                >
                  {activeLink.label}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="min-w-[8rem]">
                {links.map((link) => {
                  const isActive = pathname.startsWith(link.href);
                  return (
                    <DropdownMenuItem
                      key={`mobile-route-${link.href}`}
                      className={isActive ? "font-semibold text-emerald-700" : ""}
                      onClick={() => {
                        if (isActive) return;
                        prepareRouteChange();
                        router.push(link.href);
                      }}
                    >
                      {link.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  data-testid="mobile-more-menu"
                  className="h-8 w-8 rounded-full border-slate-200 bg-white text-xs font-semibold text-slate-700"
                >
                  ⋯
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[9rem]">
                <DropdownMenuItem
                  onClick={() => {
                    openGuide();
                  }}
                >
                  <span className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[10px] text-slate-600">
                    ?
                  </span>
                  <span className="text-xs font-medium text-slate-800">
                    {t("guide")}
                  </span>
                  {state ? (
                    <span className="ml-auto rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {state.completedCount}/{state.totalCount}
                    </span>
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <div className="flex flex-col gap-1 py-1">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Language
                    </span>
                    <LocaleSwitcher />
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="text-xs font-medium text-rose-600"
                >
                  {tc("signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

