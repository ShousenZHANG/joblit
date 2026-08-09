"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import {
  Briefcase,
  FileText,
  Laptop,
  Moon,
  Search,
  Sun,
  Telescope,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useMarket } from "@/hooks/useMarket";

/**
 * Global ⌘K / Ctrl+K command palette — jump anywhere, switch theme, or search
 * jobs without leaving the keyboard. Mounted once in the app shell.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { setTheme } = useTheme();
  const t = useTranslations("nav");
  const isCN = useMarket() === "CN";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    // The nav's ⌘K button opens the palette without prop-drilling through the
    // server layout.
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("joblit:command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("joblit:command-palette", onOpenEvent);
    };
  }, []);

  const run = (action: () => void) => {
    setOpen(false);
    setQuery("");
    action();
  };

  const pages = useMemo(
    () =>
      isCN
        ? ([{ key: "resume", href: "/resume", icon: FileText }] as const)
        : ([
            { key: "jobs", href: "/jobs", icon: Briefcase },
            { key: "fetch", href: "/fetch", icon: Telescope },
            { key: "resume", href: "/resume", icon: FileText },
          ] as const),
    [isCN],
  );

  const trimmed = query.trim();

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      title={t("paletteTitle")}
      description={t("paletteHint")}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t("palettePlaceholder")}
      />
      <CommandList>
        <CommandEmpty>{t("paletteEmpty")}</CommandEmpty>
        {trimmed && !isCN ? (
          <CommandGroup heading={t("paletteActions")}>
            <CommandItem
              // Always match regardless of the query text.
              value={`search-jobs ${trimmed}`}
              onSelect={() =>
                run(() => router.push(`/jobs?q=${encodeURIComponent(trimmed)}`))
              }
            >
              <Search aria-hidden />
              {t("paletteSearchJobs", { query: trimmed })}
            </CommandItem>
          </CommandGroup>
        ) : null}
        <CommandGroup heading={t("palettePages")}>
          {pages.map((page) => (
            <CommandItem
              key={page.href}
              value={`${t(page.key)} ${page.href}`}
              onSelect={() => run(() => router.push(page.href))}
            >
              <page.icon aria-hidden />
              {t(page.key)}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("theme")}>
          <CommandItem value="theme-light" onSelect={() => run(() => setTheme("light"))}>
            <Sun aria-hidden />
            {t("paletteThemeLight")}
          </CommandItem>
          <CommandItem value="theme-dark" onSelect={() => run(() => setTheme("dark"))}>
            <Moon aria-hidden />
            {t("paletteThemeDark")}
          </CommandItem>
          <CommandItem value="theme-system" onSelect={() => run(() => setTheme("system"))}>
            <Laptop aria-hidden />
            {t("paletteThemeSystem")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
