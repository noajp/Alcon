'use client';

import type { ReactNode } from 'react';
import type { ExplorerData, ElementWithDetails } from '@/hooks/useSupabase';
import type { WidgetConfig } from './types';
import { KpiCardsWidget } from './widgets/KpiCardsWidget';
import { StatusChartWidget } from './widgets/StatusChartWidget';
import { PriorityChartWidget } from './widgets/PriorityChartWidget';
import { OverdueWidget } from './widgets/OverdueWidget';
import { UpcomingWidget } from './widgets/UpcomingWidget';
import { ObjectProgressWidget } from './widgets/ObjectProgressWidget';
import { OkrSummaryWidget } from './widgets/OkrSummaryWidget';
import { ObjectiveCardsWidget } from './widgets/ObjectiveCardsWidget';
import { MiniGanttWidget } from './widgets/MiniGanttWidget';
import { MiniCalendarWidget } from './widgets/MiniCalendarWidget';

export interface WidgetContext {
  elements: ElementWithDetails[];
  explorerData: ExplorerData;
}

/**
 * Single source of truth for rendering any widget by type.
 */
export function renderWidget(widget: WidgetConfig, ctx: WidgetContext): ReactNode {
  switch (widget.type) {
    case 'kpi-cards':
      return <KpiCardsWidget elements={ctx.elements} />;
    case 'status-chart':
      return <StatusChartWidget elements={ctx.elements} />;
    case 'priority-chart':
      return <PriorityChartWidget elements={ctx.elements} />;
    case 'overdue-list':
      return <OverdueWidget elements={ctx.elements} />;
    case 'upcoming-list':
      return <UpcomingWidget elements={ctx.elements} />;
    case 'object-progress':
      return <ObjectProgressWidget explorerData={ctx.explorerData} />;
    case 'okr-summary':
      return <OkrSummaryWidget />;
    case 'objective-cards':
      return <ObjectiveCardsWidget explorerData={ctx.explorerData} />;
    case 'mini-gantt':
      return <MiniGanttWidget elements={ctx.elements} />;
    case 'mini-calendar':
      return <MiniCalendarWidget elements={ctx.elements} />;
    default:
      return (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Unknown widget: {widget.type}
        </div>
      );
  }
}

/** Widget types that render their own card chrome (KPI grid, objective cards). */
export const BARE_WIDGET_TYPES = ['kpi-cards', 'objective-cards'];
