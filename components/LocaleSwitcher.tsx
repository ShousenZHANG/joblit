"use client";

import { useOptimistic, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

const options = [
  { value: "en", label: "EN", ghostLabel: "EN" },
  { value: "zh", label: "中文", ghostLabel: "中" },
] as const;

interface LocaleSwitcherProps {
  size?: "compact" | "touch";
  /**
   * "solid" is the app-shell segmented control (active segment fills with
   * `bg-foreground`). "ghost" is the quiet variant for the marketing nav:
   * no container chrome, short labels, and a muted active state so the
   * page's single solid CTA keeps its monopoly on visual weight. The ghost
   * + touch combination collapses to the desktop control height at `lg`,
   * matching the rest of the landing nav cluster.
   */
  variant?: "solid" | "ghost";
}

export function LocaleSwitcher({
  size = "compact",
  variant = "solid",
}: LocaleSwitcherProps) {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticLocale, setOptimisticLocale] = useOptimistic(locale);

  function switchLocale(newLocale: string) {
    if (newLocale === optimisticLocale || isPending) return;
    localStorage.setItem("locale", newLocale);
    // eslint-disable-next-line react-hooks/immutability -- setting document.cookie is the browser's prescribed API for persisting cookies from a client component.
    document.cookie = `locale=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
    startTransition(() => {
      setOptimisticLocale(newLocale);
      router.refresh();
    });
  }

  const isGhost = variant === "ghost";
  const containerClass = isGhost
    ? "flex items-center gap-0.5 rounded-full"
    : "flex items-center gap-0.5 rounded-full bg-muted p-0.5";
  const sizeClass = isGhost
    ? size === "touch"
      ? "min-h-11 min-w-11 px-2 lg:min-h-9 lg:min-w-9"
      : "h-9 px-2"
    : size === "touch"
      ? "min-h-11 min-w-11 px-3"
      : "px-3 py-1";

  return (
    <div className={containerClass} aria-busy={isPending}>
      {options.map((opt) => {
        const isActive = optimisticLocale === opt.value;
        const showSpinner = isPending && isActive;
        const stateClass = isActive
          ? isGhost
            ? "bg-muted text-foreground"
            : "bg-foreground text-background shadow-sm"
          : "text-muted-foreground hover:text-foreground";
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => switchLocale(opt.value)}
            disabled={isPending}
            aria-pressed={isActive}
            aria-label={opt.label}
            className={`relative inline-flex items-center justify-center gap-1 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 active:scale-95 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${sizeClass} ${stateClass}`}
          >
            {showSpinner ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : null}
            <span>{isGhost ? opt.ghostLabel : opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
