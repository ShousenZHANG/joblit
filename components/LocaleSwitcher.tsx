"use client";

import { useOptimistic, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

const options = [
  { value: "en", label: "EN" },
  { value: "zh", label: "中文" },
] as const;

export function LocaleSwitcher({ size = "compact" }: { size?: "compact" | "touch" }) {
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

  return (
    <div
      className="flex items-center gap-0.5 rounded-full bg-muted p-0.5"
      aria-busy={isPending}
    >
      {options.map((opt) => {
        const isActive = optimisticLocale === opt.value;
        const showSpinner = isPending && isActive;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => switchLocale(opt.value)}
            disabled={isPending}
            aria-pressed={isActive}
            className={`relative inline-flex items-center justify-center gap-1 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 active:scale-95 disabled:cursor-wait ${
              size === "touch" ? "min-h-11 min-w-11 px-3" : "px-3 py-1"
            } ${
              isActive
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {showSpinner ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : null}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
