"use client";

import { useState, useEffect, useCallback } from "react";

interface TocItem {
  id: string;
  label: string;
}

interface LegalTableOfContentsProps {
  items: TocItem[];
}

export default function LegalTableOfContents({ items }: LegalTableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );

    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [items]);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setMobileOpen(false);
    }
  }, []);

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="legal-toc-sidebar" aria-label="Table of contents">
        <p className="legal-toc-heading">On this page</p>
        <ul className="legal-toc-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => scrollTo(item.id)}
                className={`legal-toc-link${activeId === item.id ? " legal-toc-link--active" : ""}`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Mobile toggle */}
      <div className="legal-toc-mobile">
        <button
          onClick={() => setMobileOpen((o) => !o)}
          className="legal-toc-mobile-toggle"
          aria-expanded={mobileOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Table of Contents
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
            className={`legal-toc-chevron${mobileOpen ? " legal-toc-chevron--open" : ""}`}
          >
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {mobileOpen && (
          <ul className="legal-toc-mobile-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => scrollTo(item.id)}
                  className={`legal-toc-link${activeId === item.id ? " legal-toc-link--active" : ""}`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
