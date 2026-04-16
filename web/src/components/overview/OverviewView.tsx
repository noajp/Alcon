'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import { Target, Circle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useObjectives } from '@/hooks/useObjectives';
import type { ObjectiveWithDetails, KeyResultWithLinks } from '@/hooks/useObjectives';
import type { ExplorerData, AlconObjectWithChildren } from '@/hooks/useSupabase';

// ─── Props ─────────────────────────────────────────────────
interface OverviewViewProps {
  explorerData: ExplorerData;
}

// ─── Status config ─────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; ring: string }> = {
  on_track: {
    label: 'On Track',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    ring: 'ring-emerald-500/20',
  },
  at_risk: {
    label: 'At Risk',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    ring: 'ring-amber-500/20',
  },
  behind: {
    label: 'Behind',
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/40',
    ring: 'ring-red-500/20',
  },
  achieved: {
    label: 'Achieved',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    ring: 'ring-blue-500/20',
  },
};

const STATUS_DOT_COLORS: Record<string, string> = {
  on_track: 'bg-emerald-500',
  at_risk: 'bg-amber-500',
  behind: 'bg-red-500',
  achieved: 'bg-blue-500',
};

const STATUS_BAR_COLORS: Record<string, string> = {
  on_track: 'bg-emerald-500',
  at_risk: 'bg-amber-500',
  behind: 'bg-red-500',
  achieved: 'bg-blue-500',
};

// ─── Helpers ───────────────────────────────────────────────

function getObjectCompletion(
  objectId: string,
  objects: AlconObjectWithChildren[],
): { done: number; total: number } {
  const findObj = (objs: AlconObjectWithChildren[]): AlconObjectWithChildren | null => {
    for (const obj of objs) {
      if (obj.id === objectId) return obj;
      if (obj.children) {
        const found = findObj(obj.children);
        if (found) return found;
      }
    }
    return null;
  };
  const obj = findObj(objects);
  if (!obj?.elements) return { done: 0, total: 0 };
  return {
    done: obj.elements.filter(e => e.status === 'done').length,
    total: obj.elements.length,
  };
}

function getObjectName(
  objectId: string,
  objects: AlconObjectWithChildren[],
): string | null {
  const findObj = (objs: AlconObjectWithChildren[]): string | null => {
    for (const obj of objs) {
      if (obj.id === objectId) return obj.name;
      if (obj.children) {
        const found = findObj(obj.children);
        if (found) return found;
      }
    }
    return null;
  };
  return findObj(objects);
}

function computeKRProgress(kr: KeyResultWithLinks): number {
  if (!kr.target_value || kr.target_value === 0) return 0;
  const current = kr.current_value ?? 0;
  return Math.min(Math.round((current / kr.target_value) * 100), 100);
}

function computeObjectiveProgress(objective: ObjectiveWithDetails): number {
  if (objective.keyResults.length === 0) return 0;
  const total = objective.keyResults.reduce((sum, kr) => sum + computeKRProgress(kr), 0);
  return Math.round(total / objective.keyResults.length);
}

// ─── Status Badge ──────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.on_track;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        config.color,
        config.bg,
        config.ring,
      )}
    >
      {config.label}
    </span>
  );
}

// ─── Progress Bar ──────────────────────────────────────────

function ProgressBar({
  value,
  status,
  height = 'h-2',
}: {
  value: number;
  status: string;
  height?: string;
}) {
  const barColor = STATUS_BAR_COLORS[status] ?? 'bg-emerald-500';
  return (
    <div className={cn('w-full rounded-full bg-muted/60', height)}>
      <div
        className={cn('rounded-full transition-all duration-500 ease-out', height, barColor)}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

// ─── Linked Object Chip ────────────────────────────────────

function LinkedObjectChip({
  objectId,
  objects,
}: {
  objectId: string;
  objects: AlconObjectWithChildren[];
}) {
  const name = getObjectName(objectId, objects);
  const { done, total } = getObjectCompletion(objectId, objects);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (!name) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-inset ring-border/50 transition-colors hover:bg-muted">
      <span className="truncate max-w-[140px]">{name}</span>
      {total > 0 && (
        <span className="font-medium text-foreground/70">
          {pct}%
        </span>
      )}
    </span>
  );
}

// ─── KR Row ────────────────────────────────────────────────

function KeyResultRow({
  kr,
  objects,
}: {
  kr: KeyResultWithLinks;
  objects: AlconObjectWithChildren[];
}) {
  const progress = computeKRProgress(kr);

  return (
    <div className="border-t border-border/50 px-6 py-4 first:border-t-0">
      <div className="flex items-center gap-4">
        {/* KR title */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground/90 truncate">{kr.title}</p>
        </div>

        {/* Progress bar + values */}
        <div className="flex items-center gap-3 shrink-0 w-[240px]">
          <span className="text-xs text-muted-foreground tabular-nums w-[60px] text-right">
            {kr.current_value ?? 0}/{kr.target_value ?? 0}
          </span>
          <div className="flex-1">
            <ProgressBar value={progress} status={kr.status} height="h-1.5" />
          </div>
        </div>

        {/* Percentage + status dot */}
        <div className="flex items-center gap-2 shrink-0 w-[70px] justify-end">
          <span className="text-xs font-medium tabular-nums text-foreground/80">
            {progress}%
          </span>
          <span
            className={cn(
              'h-2 w-2 rounded-full shrink-0',
              STATUS_DOT_COLORS[kr.status] ?? 'bg-neutral-400',
            )}
          />
        </div>
      </div>

      {/* Linked objects */}
      {kr.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5 pl-0">
          {kr.links.map(link => (
            <LinkedObjectChip
              key={link.id}
              objectId={link.object_id}
              objects={objects}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Objective Card ────────────────────────────────────────

function ObjectiveCard({
  objective,
  objects,
}: {
  objective: ObjectiveWithDetails;
  objects: AlconObjectWithChildren[];
}) {
  const progress = computeObjectiveProgress(objective);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="p-6 pb-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <StatusBadge status={objective.status} />
            <h3 className="text-base font-semibold text-foreground truncate">
              {objective.title}
            </h3>
          </div>
          {objective.due_date && (
            <span className="text-xs text-muted-foreground shrink-0 tabular-nums pt-0.5">
              {format(new Date(objective.due_date), 'MMM d, yyyy')}
            </span>
          )}
        </div>

        {objective.description && (
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
            {objective.description}
          </p>
        )}

        {/* Overall progress */}
        <div className="flex items-center gap-3 mt-4">
          <div className="flex-1">
            <ProgressBar value={progress} status={objective.status} />
          </div>
          <span className="text-sm font-semibold tabular-nums text-foreground/80 shrink-0 w-[40px] text-right">
            {progress}%
          </span>
        </div>
      </div>

      {/* Key Results */}
      {objective.keyResults.length > 0 && (
        <div className="border-t border-border">
          {objective.keyResults.map(kr => (
            <KeyResultRow key={kr.id} kr={kr} objects={objects} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton loader ───────────────────────────────────────

function ObjectiveCardSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-48" />
        <div className="flex-1" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="h-3 w-3/4" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-2 flex-1 rounded-full" />
        <Skeleton className="h-4 w-10" />
      </div>
      <div className="border-t border-border pt-4 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-40" />
            <div className="flex-1" />
            <Skeleton className="h-1.5 w-32 rounded-full" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Empty State ───────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60 mb-4">
        <Target className="h-7 w-7 text-muted-foreground/60" />
      </div>
      <h3 className="text-base font-medium text-foreground mb-1">
        No objectives yet
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Create objectives and key results to track your organization&apos;s goals and measure progress across projects.
      </p>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────

export function OverviewView({ explorerData }: OverviewViewProps) {
  const { objectives, loading, error } = useObjectives();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Objectives &amp; Key Results
          </p>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-6">
            <ObjectiveCardSkeleton />
            <ObjectiveCardSkeleton />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">
              Failed to load objectives. Please try again.
            </p>
          </div>
        ) : objectives.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {objectives.map(objective => (
              <ObjectiveCard
                key={objective.id}
                objective={objective}
                objects={explorerData.objects}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
