'use client';

import type { ElementWithDetails, AlconObjectWithChildren } from '@/types/database';
import type { ExplorerData } from '@/hooks/useSupabase';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { DEFAULT_LAYOUTS } from '@/components/widgets/registry';
import { renderWidget, BARE_WIDGET_TYPES } from '@/components/widgets/renderWidget';

interface SummaryViewProps {
  elements: ElementWithDetails[];
  object: AlconObjectWithChildren;
}

export function SummaryView({ elements, object }: SummaryViewProps) {
  // Per-object layout key — each Object remembers its own widget arrangement
  const layoutKey = `object:${object.id}`;
  const explorerData: ExplorerData = { objects: [object], rootElements: [] };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <WidgetGrid
          scope="object-summary"
          layoutKey={layoutKey}
          defaults={DEFAULT_LAYOUTS['object-summary']}
          renderWidget={(w) => renderWidget(w, { elements, explorerData })}
          bareTypes={BARE_WIDGET_TYPES}
        />
      </div>
    </div>
  );
}
