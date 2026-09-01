'use client';

import { useMemo } from 'react';
import type { ExplorerData, AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import {
  useBoard,
  WidgetSurface,
  WidgetZone,
  HOME_BOARD,
  type WidgetHost,
  type Zone,
} from '@/alcon/widget';

/** Home is a band and a two-column board — no rail. */
const SURFACE_ZONES: Zone[] = ['band', 'main'];

function collectAllElements(objects: AlconObjectWithChildren[]): ElementWithDetails[] {
  const result: ElementWithDetails[] = [];
  const traverse = (objs: AlconObjectWithChildren[]) => {
    for (const obj of objs) {
      if (obj.elements) result.push(...obj.elements);
      if (obj.children) traverse(obj.children);
    }
  };
  traverse(objects);
  return result;
}

interface HomeViewProps {
  explorerData: ExplorerData;
}

/** Home dashboard — the one board whose subject is the viewer rather than a
 *  row: `me`, scoped to everything they can see. */
export function HomeView({ explorerData }: HomeViewProps) {
  const allElements = useMemo(
    () => [...collectAllElements(explorerData.objects), ...(explorerData.rootElements ?? [])],
    [explorerData],
  );

  const board = useBoard('home', HOME_BOARD);

  const host = useMemo<WidgetHost>(
    () => ({ subject: { kind: 'me', id: null }, elements: allElements, explorerData }),
    [allElements, explorerData],
  );

  return (
    <div className="flex-1 overflow-y-auto bg-card">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {allElements.length} elements across {explorerData.objects.length} objects
          </p>
        </div>

        <WidgetSurface board={board} host={host} zones={SURFACE_ZONES}>
          <WidgetZone zone="band" className="mb-4" />
          <WidgetZone zone="main" columns={2} />
        </WidgetSurface>
      </div>
    </div>
  );
}
