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
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon size={16} />{kind === 'crm' ? 'CRM' : 'SCM'}</div>
          <h1 className="text-2xl font-semibold">{kind === 'crm' ? 'Sales pipeline' : 'Inventory planning'}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {kind === 'crm' ? 'Know which opportunities need a conversation, and what is likely to close.' : 'See what will run short, when it matters, and how much to replenish.'}
          </p>
        </header>
        <WidgetSurface board={board} host={host} zones={ZONES}>
          <WidgetZone zone="main" columns={1} />
        </WidgetSurface>
      </div>
    </div>
  );
}
