'use client';

import { useMemo } from 'react';
import { useBoard, WidgetSurface, WidgetZone, type WidgetHost, type Zone } from '@/alcon/widget';
import { CRM_BOARD, SCM_BOARD } from '@/alcon/widget/defaults';
import { useActiveSpaceId } from '@/alcon/space/activeSpaceStore';
import { CrmIcon, ScmIcon } from '@/alcon/shared/conceptIcons';
import { useExplorerData } from '@/alcon/shared/ExplorerDataContext';
import type { OperationsKind } from './operationsModel';

const ZONES: Zone[] = ['main'];
export function OperationsView(props: {
  kind: OperationsKind;
  onNavigate: NonNullable<WidgetHost['onNavigate']>;
  onViewChange?: (view: string) => void;
}) {
  const spaceId = useActiveSpaceId();
  return <OperationsSurface key={`${props.kind}:${spaceId}`} {...props} spaceId={spaceId} />;
}

function OperationsSurface({ kind, spaceId, onNavigate, onViewChange }: {
  kind: OperationsKind;
  spaceId: string | null;
  onNavigate: NonNullable<WidgetHost['onNavigate']>;
  onViewChange?: (view: string) => void;
}) {
  const board = useBoard(kind, kind === 'crm' ? CRM_BOARD : SCM_BOARD, spaceId ?? 'me');
  const explorerData = useExplorerData();
  const host = useMemo<WidgetHost>(() => ({
    subject: { kind: 'me', id: null }, elements: [], explorerData, onNavigate, onViewChange,
  }), [explorerData, onNavigate, onViewChange]);
  const Icon = kind === 'crm' ? CrmIcon : ScmIcon;
  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-card">
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <header className="space-y-2">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><Icon size={20} />{kind === 'crm' ? 'CRM' : 'SCM'}</h1>
          <p className="text-sm text-muted-foreground">
            {kind === 'crm' ? 'Track opportunities, focus follow-ups, and turn sales risks into action.' : 'Anticipate shortages, test demand changes, and plan replenishment.'}
          </p>
        </header>
        <WidgetSurface board={board} host={host} zones={ZONES}>
          <WidgetZone zone="main" columns={1} />
        </WidgetSurface>
      </div>
    </div>
  );
}
