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

        {/* Mobile nav */}
        <div className="lg:hidden">
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
            <Link href="/" className="flex shrink-0 items-center gap-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50">
                <Search className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <span className="text-sm font-bold text-slate-900">Jobflow</span>
            </Link>

            <nav className="flex items-center rounded-lg bg-slate-100/80 p-0.5" data-testid="mobile-current-route">
              {links.map((link) => {
                const active = pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={prepareRouteChange}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-all duration-150 ${
                      active
                        ? "bg-white text-emerald-700 shadow-sm"
                        : "text-slate-500 active:bg-white/60"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="mobile-more-menu"
                  aria-label="More options"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="3" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="13" cy="8" r="1.5" fill="currentColor"/></svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                <DropdownMenuItem onClick={openGuide}>
                  <CircleHelp className="mr-2 h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs font-medium">{t("guide")}</span>
                  {state ? (
                    <span className="ml-auto rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {state.completedCount}/{state.totalCount}
                    </span>
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <div className="flex flex-col gap-1 py-1">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Language</span>
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

