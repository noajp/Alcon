'use client';

import { useMemo } from 'react';
import type { ElementWithDetails, AlconObjectWithChildren } from '@/types/database';
import type { ExplorerData } from '@/hooks/useSupabase';
import {
  useBoard,
  WidgetSurface,
  WidgetZone,
  OBJECT_SUMMARY_BOARD,
  type WidgetHost,
  type Zone,
} from '@/alcon/widget';

/** Summary is a band and a two-column board — no rail. */
const SURFACE_ZONES: Zone[] = ['band', 'main'];

interface SummaryViewProps {
  elements: ElementWithDetails[];
  object: AlconObjectWithChildren;
}

/** Object Summary — a two-column board and nothing else. No fixed spine: the
 *  Object's identity is the Overview tab's job, this tab is the numbers. */
export function SummaryView({ elements, object }: SummaryViewProps) {
  const board = useBoard('object-summary', OBJECT_SUMMARY_BOARD, object.id);

  const host = useMemo<WidgetHost>(() => {
    const explorerData: ExplorerData = { objects: [object], rootElements: [] };
    return { subject: { kind: 'object', id: object.id }, elements, object, explorerData };
  }, [elements, object]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <WidgetSurface board={board} host={host} zones={SURFACE_ZONES}>
          <WidgetZone zone="band" className="mb-4" />
          <WidgetZone zone="main" columns={2} />
        </WidgetSurface>
      </div>
    </div>
  );
}
