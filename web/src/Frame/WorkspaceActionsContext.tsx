'use client';

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

type CreateKind = 'object' | 'table' | 'notebook';
/** Where a new Object is made from: the Domain to preset, and the Strategy
 *  it goes under (a Strategy's Board). */
export interface CreateObjectContext { domainId?: string | null; strategy?: { id: string; name: string } | null }
interface WorkspaceActions {
  openCreate: (kind: CreateKind, context?: CreateObjectContext) => void;
  subscribeTableCreate: (open: () => void) => () => void;
}

const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

/** Creation requests are scoped to this workspace. Data invalidation remains
 * in the existing stores; this context only routes UI actions to their owner. */
export function WorkspaceActionsProvider({ onOpenCreateObject, onOpenCreateNotebook, children }: {
  onOpenCreateObject: (context?: CreateObjectContext) => void;
  onOpenCreateNotebook?: () => void;
  children: ReactNode;
}) {
  const tableOpeners = useRef(new Set<() => void>());
  const subscribeTableCreate = useCallback((open: () => void) => {
    tableOpeners.current.add(open);
    return () => { tableOpeners.current.delete(open); };
  }, []);
  const openCreate = useCallback((kind: CreateKind, context?: CreateObjectContext) => {
    if (kind === 'object') onOpenCreateObject(context);
    else if (kind === 'notebook') onOpenCreateNotebook?.();
    else tableOpeners.current.forEach(open => open());
  }, [onOpenCreateObject, onOpenCreateNotebook]);
  const value = useMemo(() => ({ openCreate, subscribeTableCreate }), [openCreate, subscribeTableCreate]);
  return <WorkspaceActionsContext.Provider value={value}>{children}</WorkspaceActionsContext.Provider>;
}

export function useWorkspaceActions(): WorkspaceActions {
  const actions = useContext(WorkspaceActionsContext);
  if (!actions) throw new Error('useWorkspaceActions requires WorkspaceActionsProvider');
  return actions;
}
