'use client';

import type { ExplorerData } from '@/hooks/useSupabase';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { DEFAULT_LAYOUTS } from '@/components/widgets/registry';
import { renderWidget, BARE_WIDGET_TYPES } from '@/components/widgets/renderWidget';

interface OverviewViewProps {
  explorerData: ExplorerData;
}

export function OverviewView({ explorerData }: OverviewViewProps) {
  return (
    <div className="h-full overflow-y-auto bg-neutral-50/50">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <WidgetGrid
          scope="overview"
          layoutKey="overview"
          defaults={DEFAULT_LAYOUTS.overview}
          renderWidget={(w) => renderWidget(w, { elements: [], explorerData })}
          bareTypes={BARE_WIDGET_TYPES}
        />
      </div>
    </div>
  );
}
