'use client';

import { format } from 'date-fns';
import { Target, CalendarDays, TrendingUp } from 'lucide-react';
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
const STATUS_STYLE: Record<string, { label: string; pill: string; bar: string }> = {
  on_track: {
    label: 'On Track',
    pill: 'bg-emerald-50 text-emerald-600',
    bar: 'bg-emerald-500',
  },
  at_risk: {
    label: 'At Risk',
    pill: 'bg-amber-50 text-amber-600',
    bar: 'bg-amber-500',
  },
  behind: {
    label: 'Behind',
    pill: 'bg-red-50 text-red-600',
    bar: 'bg-red-500',
  },
  achieved: {
    label: 'Achieved',
    pill: 'bg-blue-50 text-blue-600',
    bar: 'bg-blue-500',
  },
};

// ─── Helpers ───────────────────────────────────────────────

function findObject(
  objectId: string,
  objects: AlconObjectWithChildren[],
): AlconObjectWithChildren | null {
  for (const obj of objects) {
    if (obj.id === objectId) return obj;
    if (obj.children) {
      const found = findObject(objectId, obj.children);
      if (found) return found;
    }
  }
  return null;
}

function getObjectCompletion(
  objectId: string,
  objects: AlconObjectWithChildren[],
): { done: number; total: number } {
  const obj = findObject(objectId, objects);
  if (!obj?.elements) return { done: 0, total: 0 };
  return {
    done: obj.elements.filter(e => e.status === 'done').length,
    total: obj.elements.length,
  };
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

function getStatusStyle(status: string) {
  return STATUS_STYLE[status] ?? STATUS_STYLE.on_track;
}

// ─── Status Pill ──────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const style = getStatusStyle(status);
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium',
        style.pill,
      )}
    >
      {style.label}
    </span>
  );
}

// ─── Progress Bar ──────────────────────────────────────────

function ProgressBar({
  value,
  status,
  className,
}: {
  value: number;
  status: string;
  className?: string;
}) {
  const barColor = getStatusStyle(status).bar;
  return (
    <div className={cn('w-full h-1.5 rounded-full bg-neutral-100', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500 ease-out', barColor)}
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
  const obj = findObject(objectId, objects);
  const { done, total } = getObjectCompletion(objectId, objects);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (!obj) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-50 px-2.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-inset ring-neutral-200/60 transition-colors hover:bg-neutral-100">
      <span className="truncate max-w-[120px]">{obj.name}</span>
      {total > 0 && (
        <span className="font-medium tabular-nums text-neutral-500">
          {pct}%
        </span>
      )}
    </span>
  );
}

// ─── Key Result Row ───────────────────────────────────────

function KeyResultRow({
  kr,
  objects,
  isLast,
}: {
  kr: KeyResultWithLinks;
  objects: AlconObjectWithChildren[];
  isLast: boolean;
}) {
  const progress = computeKRProgress(kr);
  const style = getStatusStyle(kr.status);

  return (
    <div className={cn('px-5 py-3.5', !isLast && 'border-b border-neutral-100')}>
      <div className="flex items-center gap-3">
        {/* KR title */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-foreground/90 truncate">{kr.title}</p>
        </div>

        {/* Current / Target */}
        <span className="text-[12px] text-muted-foreground tabular-nums shrink-0">
          {kr.current_value ?? 0}
          <span className="text-neutral-300 mx-0.5">/</span>
          {kr.target_value ?? 0}
        </span>

        {/* Progress bar */}
        <div className="w-20 shrink-0">
          <ProgressBar value={progress} status={kr.status} />
        </div>

        {/* Percentage badge */}
        <span
          className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium tabular-nums shrink-0',
            style.pill,
          )}
        >
          {progress}%
        </span>
      </div>

      {/* Linked objects */}
      {kr.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
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
    <div
      className={cn(
        'rounded-2xl bg-white border border-border/60',
        'shadow-[0_1px_3px_rgba(0,0,0,0.04)]',
        'hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]',
        'transition-shadow duration-200',
      )}
    >
      {/* Card header */}
      <div className="p-5 pb-4">
        {/* Top row: status pill + due date */}
        <div className="flex items-center justify-between mb-3">
          <StatusPill status={objective.status} />
          {objective.due_date && (
            <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground tabular-nums">
              <CalendarDays className="h-3 w-3" />
              {format(new Date(objective.due_date), 'MMM d, yyyy')}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-[15px] font-medium text-foreground leading-snug">
          {objective.title}
        </h3>

        {/* Description */}
        {objective.description && (
          <p className="text-[13px] text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
            {objective.description}
          </p>
        )}

        {/* Overall progress */}
        <div className="flex items-center gap-3 mt-4">
          <ProgressBar value={progress} status={objective.status} />
          <span className="text-[13px] font-medium tabular-nums text-foreground/70 shrink-0">
            {progress}%
          </span>
        </div>
      </div>

      {/* Key Results */}
      {objective.keyResults.length > 0 && (
        <div className="border-t border-neutral-100">
          <div className="px-5 pt-3 pb-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Key Results
            </span>
          </div>
          {objective.keyResults.map((kr, i) => (
            <KeyResultRow
              key={kr.id}
              kr={kr}
              objects={objects}
              isLast={i === objective.keyResults.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton loader ───────────────────────────────────────

function ObjectiveCardSkeleton() {
  return (
    <div className="rounded-2xl bg-white border border-border/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-3 w-4/5" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-1.5 flex-1 rounded-full" />
        <Skeleton className="h-4 w-8" />
      </div>
      <div className="border-t border-neutral-100 pt-4 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3.5 w-40" />
            <div className="flex-1" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-1.5 w-20 rounded-full" />
            <Skeleton className="h-5 w-10 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Empty State ───────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-50 border border-neutral-200/60 mb-4">
        <Target className="h-5 w-5 text-neutral-400" />
      </div>
      <p className="text-[15px] font-medium text-foreground mb-1">
        No objectives yet
      </p>
      <p className="text-[13px] text-muted-foreground max-w-xs leading-relaxed">
        Create objectives and key results to track goals and measure progress.
      </p>
    </div>
  );
}

// ─── Summary Stats ─────────────────────────────────────────

function SummaryStats({ objectives }: { objectives: ObjectiveWithDetails[] }) {
  const total = objectives.length;
  const avgProgress = total > 0
    ? Math.round(objectives.reduce((s, o) => s + computeObjectiveProgress(o), 0) / total)
    : 0;
  const onTrack = objectives.filter(o => o.status === 'on_track').length;
  const totalKRs = objectives.reduce((s, o) => s + o.keyResults.length, 0);

  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      {[
        { label: 'Avg. Progress', value: `${avgProgress}%`, icon: TrendingUp },
        { label: 'On Track', value: `${onTrack}/${total}`, icon: Target },
        { label: 'Key Results', value: `${totalKRs}`, icon: Target },
      ].map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className={cn(
            'rounded-xl bg-white border border-border/60 px-4 py-3',
            'shadow-[0_1px_3px_rgba(0,0,0,0.04)]',
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
          </div>
          <p className="text-lg font-medium tabular-nums text-foreground">{value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────

export function OverviewView({ explorerData }: OverviewViewProps) {
  const { objectives, loading, error } = useObjectives();

  return (
    <div className="h-full overflow-y-auto bg-neutral-50/50">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Content */}
        {loading ? (
          <div className="space-y-4">
            <ObjectiveCardSkeleton />
            <ObjectiveCardSkeleton />
          </div>
        ) : error ? (
          <div
            className={cn(
              'rounded-2xl border border-red-200/60 bg-white p-8 text-center',
              'shadow-[0_1px_3px_rgba(0,0,0,0.04)]',
            )}
          >
            <p className="text-[13px] text-red-500">
              Failed to load objectives. Please try again.
            </p>
          </div>
        ) : objectives.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <SummaryStats objectives={objectives} />
            <div className="space-y-4">
              {objectives.map(objective => (
                <ObjectiveCard
                  key={objective.id}
                  objective={objective}
                  objects={explorerData.objects}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
