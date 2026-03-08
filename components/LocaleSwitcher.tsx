"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

const options = [
  { value: "en", label: "EN" },
  { value: "zh", label: "中文" },
] as const;

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();

  function switchLocale(newLocale: string) {
    if (newLocale === locale) return;
    localStorage.setItem("locale", newLocale);
    document.cookie = `locale=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
    router.refresh();
  }

  return (
    <div className="flex gap-0.5 rounded-full bg-slate-100 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => switchLocale(opt.value)}
          className={`rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-all duration-200 ${
            locale === opt.value
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
