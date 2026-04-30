'use client';

import type { ExplorerData, ElementWithDetails, AlconObjectWithChildren } from '@/hooks/useSupabase';
import { WidgetGrid } from '@/alcon/widget/WidgetGrid';
import { DEFAULT_LAYOUTS } from '@/alcon/widget/registry';
import { renderWidget, BARE_WIDGET_TYPES } from '@/alcon/widget/renderWidget';

interface OverviewViewProps {
  elements: ElementWithDetails[];
  object: AlconObjectWithChildren;
  explorerData: ExplorerData;
  onRefresh?: () => void;
}

/**
 * Object Overview tab — Asana-style project overview.
 * Shows brief, KPIs, team, milestones, recent activity for this Object.
 */
export function OverviewView({ elements, object, explorerData, onRefresh }: OverviewViewProps) {
  const layoutKey = `overview:${object.id}`;
  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <WidgetGrid
          scope="overview"
          layoutKey={layoutKey}
          defaults={DEFAULT_LAYOUTS.overview}
          renderWidget={(w) =>
            renderWidget(w, { elements, explorerData, object, onRefresh })
          }
          bareTypes={BARE_WIDGET_TYPES}
        />
      </div>
    </div>
  );
}
