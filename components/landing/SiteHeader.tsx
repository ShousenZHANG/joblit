"use client";

import Link from "next/link";
import { Github, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { ThemeToggle } from "@/components/providers/ThemeProvider";
import { CtaLink } from "./CtaLink";
import { REPO_URL } from "./links";
import styles from "./SiteHeader.module.css";

const DESKTOP_WIDTH = 960;
const links = [
  { key: "howItWorks", href: "#how-it-works" },
  { key: "demo", href: "#demo" },
  { key: "faq", href: "#faq" },
] as const;

export function SiteHeader() {
  const t = useTranslations("landingExperience.nav");
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const home = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Move focus to the destination before the menu unmounts, so keyboard users
  // land where the link points instead of back at the top of the page.
  const followLink = (href: string) => {
    const destination = document.getElementById(href.slice(1));
    if (destination && !destination.hasAttribute("tabindex")) destination.setAttribute("tabindex", "-1");
    destination?.focus({ preventScroll: true });
    setOpen(false);
  };

  // Mark the section under the reading line. An observer, not a scroll
  // listener: the browser reports crossings without per-frame work here.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const sections = links.flatMap(link => {
      const element = document.getElementById(link.href.slice(1));
      return element ? [element] : [];
    });
    if (!sections.length) return;
    const crossing = new Map<string, boolean>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) crossing.set(entry.target.id, entry.isIntersecting);
      const active = links.find(link => crossing.get(link.href.slice(1)));
      setCurrent(active ? active.href : null);
    }, { rootMargin: "-40% 0px -55% 0px" });
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onResize = () => {
      if (window.innerWidth < DESKTOP_WIDTH) return;
      // Only rescue focus that the closing disclosure would otherwise drop.
      const focused = document.activeElement;
      if (focused === toggle.current || panel.current?.contains(focused)) home.current?.focus({ preventScroll: true });
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <header className={styles.header}>
      <nav aria-label={t("primary")} className={styles.bar}>
        <Link ref={home} href="/" aria-label={t("home")} className={styles.brand}>
          <span className={styles.mark}><JoblitMark size={22} color="currentColor" ariaLabel={null} /></span>
          Joblit
        </Link>
        <div className={styles.links}>
          {links.map(link => (
            <a key={link.key} href={link.href} aria-current={current === link.href ? "location" : undefined}>{t(link.key)}</a>
          ))}
        </div>
        <div className={styles.actions}>
          <div className={styles.desktopOnly}><LocaleSwitcher size="touch" variant="ghost" /></div>
          <a className={`${styles.iconLink} ${styles.desktopOnly}`} href={REPO_URL} target="_blank" rel="noreferrer" aria-label={t("github")}>
            <Github size={18} aria-hidden="true" />
          </a>
          <ThemeToggle size="touch" variant="ghost" />
          <CtaLink className={styles.cta} />
          <button
            ref={toggle}
            type="button"
            className={styles.menuToggle}
            onClick={() => setOpen(value => !value)}
            aria-label={t(open ? "closeMenu" : "openMenu")}
            aria-expanded={open}
            aria-controls="landing-mobile-menu"
          >
            {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </nav>
      <span className={styles.progress} aria-hidden="true" />
      {open && (
        <div ref={panel} id="landing-mobile-menu" className={styles.panel}>
          <ul className={styles.panelLinks}>
            {links.map(link => (
              <li key={link.key}><a href={link.href} onClick={() => followLink(link.href)}>{t(link.key)}</a></li>
            ))}
            <li><a href={REPO_URL} target="_blank" rel="noreferrer">{t("github")}</a></li>
          </ul>
          <div className={styles.panelUtilities}><LocaleSwitcher size="touch" variant="ghost" /></div>
        </div>
      )}
    </header>
  );
}
