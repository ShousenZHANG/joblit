"use client";

import type { ReactNode } from "react";

export function renderBoldText(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const inner = part.slice(2, -2);
      return (
        <strong key={i} className="text-emerald-600 font-semibold">
          {inner}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
