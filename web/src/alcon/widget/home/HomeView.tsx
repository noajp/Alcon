'use client';

import { useMemo } from 'react';
import type { ExplorerData } from '@/hooks/useSupabase';
import { WidgetGrid } from '@/alcon/widget/WidgetGrid';
import { DEFAULT_LAYOUTS } from '@/alcon/widget/registry';
import { renderWidget, BARE_WIDGET_TYPES } from '@/alcon/widget/renderWidget';
import { collectAllElements } from '@/alcon/object/ObjectsView';

interface HomeViewProps {
  explorerData: ExplorerData;
}

export function HomeView({ explorerData }: HomeViewProps) {
  const allElements = useMemo(
    () => [...collectAllElements(explorerData.objects), ...(explorerData.rootElements ?? [])],
    [explorerData],
  );

  return (
    <div className="flex-1 overflow-y-auto bg-card">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {allElements.length} elements across {explorerData.objects.length} objects
          </p>
        </div>

        <WidgetGrid
          scope="home"
          layoutKey="home"
          defaults={DEFAULT_LAYOUTS.home}
          renderWidget={(w) => renderWidget(w, { elements: allElements, explorerData })}
          bareTypes={BARE_WIDGET_TYPES}
        />
      </div>
    </div>
  );
}
