"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const t = useTranslations("marketing");
  const tn = useTranslations("nav");

  useEffect(() => {
    if (!open) return;

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <div className="relative md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        onClick={() => setOpen((v) => !v)}
        className="edu-outline edu-cta--press edu-menu-button flex h-12 w-12 items-center justify-center"
      >
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>
      {open && (
        <div
          ref={panelRef}
          id="mobile-nav-panel"
          role="menu"
          className="edu-menu-panel"
        >
          <Link
            href="/jobs"
            role="menuitem"
            className="edu-fav-link"
            onClick={() => setOpen(false)}
          >
            {tn("jobs")}
          </Link>
          <Link
            href="/fetch"
            role="menuitem"
            className="edu-fav-link"
            onClick={() => setOpen(false)}
          >
            {tn("fetch")}
          </Link>
          <hr className="my-2 border-slate-200" />
          <Link
            href="/login"
            role="menuitem"
            className="edu-fav-link"
            onClick={() => setOpen(false)}
          >
            {t("login")}
          </Link>
          <Link
            href="/login"
            role="menuitem"
            className="edu-fav-link font-semibold text-emerald-700"
            onClick={() => setOpen(false)}
          >
            {t("cta")}
          </Link>
        </div>
      )}
    </div>
  );
}
