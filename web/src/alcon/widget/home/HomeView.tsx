'use client';

import { useExplorerData } from '@/alcon/shared/ExplorerDataContext';
import { useMemo, useSyncExternalStore } from 'react';
import {
  useBoard,
  WidgetSurface,
  WidgetZone,
  HOME_BOARD,
  type WidgetHost,
  type Zone,
} from '@/alcon/widget';
// Shared, and deduped: an Element multi-homed into two Objects appears twice
// in a naive walk, which is what crashed the Board.
import { getActiveSpaceId, ACTIVE_SPACE_CHANGE_EVENT } from '@/alcon/space/activeSpaceStore';
import { collectAllElements } from '@/alcon/object/ObjectsView';

/** Home is a band and a two-column board — no rail. */
const SURFACE_ZONES: Zone[] = ['band', 'main'];

/** Home dashboard — the one board whose subject is the viewer rather than a
 *  row: `me`, scoped to everything they can see. */
export function HomeView() {
  const explorerData = useExplorerData();
  const allElements = useMemo(
    () => [...collectAllElements(explorerData.objects), ...(explorerData.rootElements ?? [])],
    [explorerData],
  );

  const spaceId = useSyncExternalStore(subscribeSpace, getActiveSpaceId, () => null);
  const board = useBoard('home', HOME_BOARD, spaceId ?? 'me');

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

function subscribeSpace(listener: () => void) {
  window.addEventListener(ACTIVE_SPACE_CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(ACTIVE_SPACE_CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
