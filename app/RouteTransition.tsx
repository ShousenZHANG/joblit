"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useReducedMotion } from "framer-motion";

export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const pendingFocusFrameId = useRef<number | null>(null);
  const [historyTargetPathname, setHistoryTargetPathname] = useState<string | null>(null);
  const [routeState, setRouteState] = useState(() => ({
    pathname,
    hasNavigated: false,
    fromHistory: false,
  }));

  if (routeState.pathname !== pathname) {
    setRouteState({
      pathname,
      hasNavigated: true,
      fromHistory: historyTargetPathname === pathname,
    });
    if (historyTargetPathname !== null) setHistoryTargetPathname(null);
  } else if (historyTargetPathname === pathname) {
    setHistoryTargetPathname(null);
  }

  const cancelPendingFocus = useCallback(() => {
    if (pendingFocusFrameId.current === null) return;
    cancelAnimationFrame(pendingFocusFrameId.current);
    pendingFocusFrameId.current = null;
  }, []);

  useEffect(() => {
    const markHistoryNavigation = () => {
      cancelPendingFocus();
      setHistoryTargetPathname(window.location.pathname);
    };

    window.addEventListener("popstate", markHistoryNavigation);
    return () => window.removeEventListener("popstate", markHistoryNavigation);
  }, [cancelPendingFocus]);

  useLayoutEffect(() => {
    if (!routeState.hasNavigated || routeState.pathname !== pathname) return;

    if (routeState.fromHistory) return;

    pendingFocusFrameId.current = requestAnimationFrame(() => {
      pendingFocusFrameId.current = null;
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
    return cancelPendingFocus;
  }, [cancelPendingFocus, pathname, routeState]);

  const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];
  const transition = reduce ? { duration: 0 } : { duration: 0.22, ease };

  const initial =
    !routeState.hasNavigated || routeState.fromHistory || reduce
      ? false
      : { opacity: 0, y: 4 };

  return (
    <motion.div
      key={pathname}
      initial={initial}
      animate={reduce ? {} : { opacity: 1, y: 0 }}
      transition={transition}
      data-route-transition="fade"
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}
