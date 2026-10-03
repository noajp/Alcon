'use client';

import { useMemo } from 'react';
import { useBoard, WidgetSurface, WidgetZone, type WidgetHost, type Zone } from '@/Function/widget';
import { CRM_BOARD } from '@/Function/widget/defaults';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { CrmIcon } from '@/Function/shared/conceptIcons';
import { useExplorerData } from '@/Function/shared/ExplorerDataContext';
import type { NavigationState } from '@/types/navigation';
import { OperationsNavigationContext } from './OperationsNavigation';
import { operationsQueue, operationsQueueRoute } from './operationsQueues';

const ZONES: Zone[] = ['main'];
export function OperationsView(props: {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const spaceId = useActiveSpaceId();
  return <OperationsSurface key={spaceId ?? 'me'} {...props} spaceId={spaceId} />;
}

function OperationsSurface({ navigation, spaceId, onNavigate, onViewChange }: {
  navigation: NavigationState;
  spaceId: string | null;
  onNavigate: (navigation: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const board = useBoard('crm', CRM_BOARD, spaceId ?? 'me');
  const explorerData = useExplorerData();
  const host = useMemo<WidgetHost>(() => ({
    subject: { kind: 'me', id: null }, elements: [], explorerData, onNavigate, onViewChange,
  }), [explorerData, onNavigate, onViewChange]);
  const queue = operationsQueue(navigation);
  const navigationContext = useMemo(() => ({ queue, onSelect: (value: typeof queue) => onNavigate(operationsQueueRoute(value)) }), [queue, onNavigate]);
  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-card">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CrmIcon size={16} />CRM</div>
          <h1 className="text-2xl font-semibold">Sales pipeline</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Know which opportunities need a conversation, and what is likely to close.
          </p>
        </header>
        <OperationsNavigationContext.Provider value={navigationContext}>
        <WidgetSurface board={board} host={host} zones={ZONES}>
          <WidgetZone zone="main" columns={1} />
        </WidgetSurface>
        </OperationsNavigationContext.Provider>
      </div>
    </div>
  );
}
