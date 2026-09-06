"use client";

import { createContext, useContext, type ReactNode } from "react";

const LandingMotionContext = createContext(false);

export function LandingMotionProvider({ paused, children }: { paused: boolean; children: ReactNode }) {
  return <LandingMotionContext.Provider value={paused}>{children}</LandingMotionContext.Provider>;
}

export function useLandingMotionPaused() {
  return useContext(LandingMotionContext);
}
