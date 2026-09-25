"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCtaHref } from "./lib/useCtaHref";

/** The workspace entry point, routed and labelled for the visitor's session. */
export function CtaLink({ className, children }: { className?: string; children?: ReactNode }) {
  const cta = useCtaHref();
  return <Link href={cta.href} prefetch={cta.prefetch} className={className}>{children ?? cta.label}</Link>;
}
