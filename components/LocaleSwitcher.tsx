"use client";

import { useOptimistic, useTransition } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

const options = [
  { value: "en", label: "EN" },
  { value: "zh", label: "中文" },
] as const;

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticLocale, setOptimisticLocale] = useOptimistic(locale);

  function switchLocale(newLocale: string) {
    if (newLocale === optimisticLocale) return;
    localStorage.setItem("locale", newLocale);
    // eslint-disable-next-line react-hooks/immutability -- setting document.cookie is the browser's prescribed API for persisting cookies from a client component.
    document.cookie = `locale=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
    startTransition(() => {
      setOptimisticLocale(newLocale);
      router.refresh();
    });
  }

  return (
    <div className="flex gap-0.5 rounded-full bg-muted p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => switchLocale(opt.value)}
          className={`rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-all duration-200 ${
            optimisticLocale === opt.value
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }${isPending ? " opacity-70" : ""}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
