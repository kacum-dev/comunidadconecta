"use client";

import { createContext, useContext, type ReactNode } from "react";
import { defaultTemporalPreferences, type TemporalPreferences } from "@/lib/temporal";

const TemporalContext = createContext<TemporalPreferences>(defaultTemporalPreferences);

export function TemporalProvider({ preferences, children }: { preferences: TemporalPreferences; children: ReactNode }) {
  return <TemporalContext.Provider value={preferences}>{children}</TemporalContext.Provider>;
}

export function useTemporalPreferences() {
  return useContext(TemporalContext);
}
