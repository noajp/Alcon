'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import type { ExplorerData, ElementWithDetails, AlconObjectWithChildren } from '@/hooks/useSupabase';
import type { WidgetConfig } from './types';
import { KpiCardsWidget } from './widgets/KpiCardsWidget';
import { StatusChartWidget } from './widgets/StatusChartWidget';
// recharts (~400KB) lives only in PriorityChartWidget — load it on demand so
// it's split out of the main bundle and only fetched when a priority-chart
// widget is actually placed on a dashboard.
const PriorityChartWidget = dynamic(
  () => import('./widgets/PriorityChartWidget').then((m) => m.PriorityChartWidget),
  { ssr: false, loading: () => <div className="h-full min-h-[120px] animate-pulse rounded-lg bg-muted/40" /> },
);
import { OverdueWidget } from './widgets/OverdueWidget';
import { UpcomingWidget } from './widgets/UpcomingWidget';
import { ObjectProgressWidget } from './widgets/ObjectProgressWidget';
import { MiniGanttWidget } from './widgets/MiniGanttWidget';
import { MiniCalendarWidget } from './widgets/MiniCalendarWidget';
import { ProjectBriefWidget } from './widgets/ProjectBriefWidget';
import { TeamRosterWidget } from './widgets/TeamRosterWidget';
import { RecentActivityWidget } from './widgets/RecentActivityWidget';
import { MilestonesWidget } from './widgets/MilestonesWidget';

export interface WidgetContext {
  elements: ElementWithDetails[];
  explorerData: ExplorerData;
  object?: AlconObjectWithChildren;
  onRefresh?: () => void;
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
    case 'mini-gantt':
      return <MiniGanttWidget elements={ctx.elements} />;
    case 'mini-calendar':
      return <MiniCalendarWidget elements={ctx.elements} />;
    case 'project-brief':
      return <ProjectBriefWidget object={ctx.object} onRefresh={ctx.onRefresh} />;
    case 'team-roster':
      return <TeamRosterWidget elements={ctx.elements} />;
    case 'recent-activity':
      return <RecentActivityWidget elements={ctx.elements} />;
    case 'milestones':
      return <MilestonesWidget elements={ctx.elements} />;
    default:
      return (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Unknown widget: {widget.type}
        </div>
      );
  }
}

/** Widget types that render their own card chrome (KPI grid). */
export const BARE_WIDGET_TYPES = ['kpi-cards'];
