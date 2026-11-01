'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ExplorerData } from '@/Function/sync/explorerPatch';

const ExplorerDataContext = createContext<ExplorerData | null>(null);

/** The nearest workspace or explicit local scope owns the snapshot. Pass the
 * existing query value through unchanged so its reference identity survives.
 * Synthetic WidgetHost data remains an explicit widget argument. */
export function ExplorerDataProvider({ value, children }: {
  value: ExplorerData;
  children: ReactNode;
}) {
  return <ExplorerDataContext.Provider value={value}>{children}</ExplorerDataContext.Provider>;
}

export function useExplorerData(): ExplorerData {
  const data = useContext(ExplorerDataContext);
  if (data === null) throw new Error('useExplorerData requires an ExplorerDataProvider');
  return data;
}

/** The snapshot when one is in scope, else null — for shared surfaces (the
 *  list table) that enrich from it where it exists and work without it. */
export function useOptionalExplorerData(): ExplorerData | null {
  return useContext(ExplorerDataContext);
}
