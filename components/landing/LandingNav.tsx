"use client";

import Link from "next/link";
import { ArrowUpRight, Github, Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { JoblitMark } from "@/components/brand/JoblitMark";
import { ThemeToggle } from "@/components/providers/ThemeProvider";
import { useCtaHref } from "./lib/useCtaHref";
import styles from "./ImmersiveLanding.module.css";

const links = [{ key: "workflow", href: "#workflow" }, { key: "features", href: "#features" }, { key: "faq", href: "#faq" }] as const;
export function LandingNav({ motionControl }: { motionControl?: ReactNode }) {
  const t = useTranslations("landingExperience.nav");
  const cta = useCtaHref();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const home = useRef<HTMLAnchorElement>(null);
  const mobileMenu = useRef<HTMLDivElement>(null);
  const closeAtSection = (href: string) => {
    const section = document.getElementById(href.slice(1));
    section?.setAttribute("tabindex", "-1");
    section?.focus({ preventScroll: true });
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    const onResize = () => {
      if (window.innerWidth < 960) return;
      const focused = document.activeElement;
      if (focused === toggle.current || mobileMenu.current?.contains(focused)) {
        home.current?.focus({ preventScroll: true });
      }
      setOpen(false);
    };
    document.addEventListener("keydown", onKey); window.addEventListener("resize", onResize);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [open]);
  return <header className={styles.navWrap}>
    <nav aria-label={t("primary")} className={styles.nav}>
      <Link ref={home} href="/" aria-label={t("home")} className={styles.wordmark}><span className={styles.mark}><JoblitMark size={21} color="currentColor" ariaLabel={null} /></span>Joblit</Link>
      <div className={styles.navLinks}>{links.map(link => <a key={link.key} href={link.href}>{t(link.key)}</a>)}</div>
      <div className={styles.navActions}>
        <div className={styles.desktopMotion}>{motionControl}</div>
        <div className={styles.desktopLocale}><LocaleSwitcher size="touch" variant="ghost" /></div>
        <a className={styles.github} href="https://github.com/ShousenZHANG/joblit" target="_blank" rel="noreferrer" aria-label={t("github")}><Github size={17} aria-hidden="true" /></a>
        <ThemeToggle size="touch" variant="ghost" />
        <Link className={styles.navCta} href={cta.href} prefetch={cta.prefetch}>{t("workspace")}<ArrowUpRight size={15} aria-hidden="true" /></Link>
        <button ref={toggle} className={styles.menuToggle} type="button" onClick={() => setOpen(value => !value)} aria-label={t(open ? "closeMenu" : "openMenu")} aria-expanded={open} aria-controls="landing-mobile-nav">{open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}</button>
      </div>
    </nav>
    {open && <div ref={mobileMenu} id="landing-mobile-nav" className={styles.mobileNav}>
      {links.map(link => <a key={link.key} href={link.href} onClick={() => closeAtSection(link.href)}>{t(link.key)}<ArrowUpRight size={15} aria-hidden="true" /></a>)}
      <a href="#demo" onClick={() => closeAtSection("#demo")}>{t("demo")}<ArrowUpRight size={15} aria-hidden="true" /></a>
      <div className={styles.mobileUtilities}><LocaleSwitcher size="touch" variant="ghost" />{motionControl}</div>
    </div>}
  </header>;
}
