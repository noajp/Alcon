import { useMemo } from 'react';
import { isAfter, isBefore, addDays, startOfDay } from 'date-fns';
import { STATUS, PRIORITY, SEMANTIC_COLORS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

interface StatusCount {
  status: string;
  label: string;
  count: number;
  color: string;
}

interface PriorityCount {
  priority: string;
  label: string;
  count: number;
  color: string;
}

interface ChartDatum {
  name: string;
  value: number;
  fill: string;
}

export interface DashboardData {
  total: number;
  completedCount: number;
  completionRate: number;

  statusCounts: StatusCount[];
  priorityCounts: PriorityCount[];

  totalEstimated: number;
  totalActual: number;

  overdueElements: ElementWithDetails[];
  upcomingElements: ElementWithDetails[];

  statusChartData: ChartDatum[];
  priorityChartData: ChartDatum[];
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#EF4444',
  high: '#F59E0B',
  medium: '#A3A3A3',
  low: '#D4D4D4',
};

export function useDashboardData(elements: ElementWithDetails[]): DashboardData {
  return useMemo(() => {
    const today = startOfDay(new Date());
    const sevenDaysLater = addDays(today, 7);

    const total = elements.length;

    // --- Status counts ---
    const statusMap = new Map<string, number>();
    for (const el of elements) {
      const key = el.status ?? 'backlog';
      statusMap.set(key, (statusMap.get(key) ?? 0) + 1);
    }

    const statusCounts: StatusCount[] = Object.entries(STATUS).map(([key, meta]) => ({
      status: key,
      label: meta.label,
      count: statusMap.get(key) ?? 0,
      color: SEMANTIC_COLORS.status[key as keyof typeof SEMANTIC_COLORS.status] ?? '#D4D4D4',
    }));

    const completedCount = statusMap.get('done') ?? 0;
    const completionRate = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    // --- Priority counts ---
    const priorityMap = new Map<string, number>();
    for (const el of elements) {
      const key = el.priority ?? 'medium';
      priorityMap.set(key, (priorityMap.get(key) ?? 0) + 1);
    }

    const priorityCounts: PriorityCount[] = Object.entries(PRIORITY).map(([key, meta]) => ({
      priority: key,
      label: meta.label,
      count: priorityMap.get(key) ?? 0,
      color: PRIORITY_COLORS[key] ?? '#A3A3A3',
    }));

    // --- Hours ---
    let totalEstimated = 0;
    let totalActual = 0;
    for (const el of elements) {
      totalEstimated += el.estimated_hours ?? 0;
      totalActual += el.actual_hours ?? 0;
    }

    // --- Overdue & upcoming ---
    const overdueElements: ElementWithDetails[] = [];
    const upcomingElements: ElementWithDetails[] = [];

    for (const el of elements) {
      if (!el.due_date || el.status === 'done' || (el.status as string) === 'cancelled') continue;

      const due = startOfDay(new Date(el.due_date));

      if (isBefore(due, today)) {
        overdueElements.push(el);
      } else if (isBefore(due, sevenDaysLater) || due.getTime() === sevenDaysLater.getTime()) {
        upcomingElements.push(el);
      }
    }

    // Sort overdue by due_date ascending (most overdue first)
    overdueElements.sort((a, b) =>
      new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime()
    );

    // Sort upcoming by due_date ascending (soonest first)
    upcomingElements.sort((a, b) =>
      new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime()
    );

    // --- Chart data ---
    const statusChartData: ChartDatum[] = statusCounts
      .filter((s) => s.count > 0)
      .map((s) => ({ name: s.label, value: s.count, fill: s.color }));

    const priorityChartData: ChartDatum[] = priorityCounts
      .filter((p) => p.count > 0)
      .map((p) => ({ name: p.label, value: p.count, fill: p.color }));

    return {
      total,
      completedCount,
      completionRate,
      statusCounts,
      priorityCounts,
      totalEstimated,
      totalActual,
      overdueElements,
      upcomingElements,
      statusChartData,
      priorityChartData,
    };
  }, [elements]);
}
