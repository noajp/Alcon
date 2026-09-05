'use client';

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

type CreateKind = 'object' | 'table';
interface WorkspaceActions {
  openCreate: (kind: CreateKind) => void;
  subscribeTableCreate: (open: () => void) => () => void;
}

const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

/** Creation requests are scoped to this workspace. Data invalidation remains
 * in the existing stores; this context only routes UI actions to their owner. */
export function WorkspaceActionsProvider({ onOpenCreateObject, children }: {
  onOpenCreateObject: () => void;
  children: ReactNode;
}) {
  const tableOpeners = useRef(new Set<() => void>());
  const subscribeTableCreate = useCallback((open: () => void) => {
    tableOpeners.current.add(open);
    return () => { tableOpeners.current.delete(open); };
  }, []);
  const openCreate = useCallback((kind: CreateKind) => {
    if (kind === 'object') onOpenCreateObject();
    else tableOpeners.current.forEach(open => open());
  }, [onOpenCreateObject]);
  const value = useMemo(() => ({ openCreate, subscribeTableCreate }), [openCreate, subscribeTableCreate]);
  return <WorkspaceActionsContext.Provider value={value}>{children}</WorkspaceActionsContext.Provider>;
}

export function useWorkspaceActions(): WorkspaceActions {
  const actions = useContext(WorkspaceActionsContext);
  if (!actions) throw new Error('useWorkspaceActions requires WorkspaceActionsProvider');
  return actions;
}
