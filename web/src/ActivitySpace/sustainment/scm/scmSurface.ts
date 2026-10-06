'use client';

import { createContext, useContext } from 'react';
import type { NavigationState } from '@/types/navigation';
import type { ScmActions, ScmData } from '@/hooks/useScm';
import type { ScmItem, ScmNode, ScmPlan } from './scmEngine';
import type { MovementMode } from './ScmForms';
import type { ScmView } from './scmNavigation';
import type { ScmScope } from './scmScope';

export type ScmDialog =
  | { kind: 'item'; item: ScmItem | null }
  | { kind: 'supplier'; supplierId: string | null }
  | { kind: 'movement'; initial?: { mode?: MovementMode; itemId?: string; locationId?: string; toLocationId?: string; quantity?: number } }
  | { kind: 'new-order'; initial?: { supplierId?: string; locationId?: string; lines?: { itemId: string; quantity: number }[]; rationale?: string } };

/** What every SCM pane needs: the snapshot, its plan, writes and navigation. */
export interface ScmSurface {
  /** The snapshot narrowed to the scope. */
  data: ScmData;
  /** Which records the panes cover: null = all, 'space' = shared by the Space, or a Domain id. */
  scope: ScmScope;
  /** The Domain new records start in: the scope's Domain, or none. */
  scopeDomainId: string | null;
  /** The Space's Domains the viewer can see, for choosing where a record belongs. */
  domains: { id: string; name: string }[];
  /** A record's Domain name; null when it is shared by the Space. */
  domainName: (id: string | null | undefined) => string | null;
  plan: ScmPlan;
  actions: ScmActions;
  /** The location every pane is filtered to; null = all locations. */
  locationId: string | null;
  /** Plan nodes at the selected location. */
  nodes: ScmNode[];
  go: (view: ScmView, extra?: Partial<NavigationState>) => void;
  openNode: (key: string) => void;
  openOrder: (id: string) => void;
  openSupplier: (id: string) => void;
  openDialog: (dialog: ScmDialog) => void;
  askCopilot: (prompt: string) => void;
  locationName: (id: string) => string;
  supplierName: (id: string | null) => string;
}

export const ScmSurfaceContext = createContext<ScmSurface | null>(null);

export function useScmSurface(): ScmSurface {
  const surface = useContext(ScmSurfaceContext);
  if (!surface) throw new Error('SCM panes must render inside ScmView.');
  return surface;
}
