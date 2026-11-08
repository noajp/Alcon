'use client';

import { useMemo } from 'react';
import { RailRow } from '@/Function/shared/RailRow';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { completionOf } from '@/Function/shared/completion';
import { formatRelative } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useStrategies, useWorkers } from '@/hooks/useSupabase';
import type { WidgetHost } from '../types';

// =============================================================
// Properties — a Strategy's facts, as the island beside its Overview: who
// owns it, how far its work has come, and when it last changed. What its AI
// work does and the harness it follows are set on the Automation page.
// =============================================================

export function StrategyPropertiesWidget({ host }: { host: WidgetHost }) {
  const { t } = useI18n();
  const { data: strategies } = useStrategies();
  const { data: workers } = useWorkers();
  const strategy = strategies.find((s) => s.id === host.subject.id) ?? null;

  const progress = useMemo(() => completionOf(host.elements), [host.elements]);

  if (!strategy) return null;
  const owner = workers.find((w) => w.user_id && w.user_id === strategy.created_by) ?? null;

  return (
    <div className="py-1">
      <RailRow name={t('Owner')} placeholder={!owner}
        icon={owner ? <WorkerAvatar worker={owner} size={16} /> : undefined}
        label={owner?.name ?? t('Unknown')} />
      <RailRow name={t('Progress')} label={
        <span className="flex w-full items-center gap-2">
          <SegmentedProgress value={progress.pct} className="flex-1" />
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{progress.pct}%</span>
        </span>
      } />
      {/* The Status mark filled by the share done, as an in-progress Element
          is: an empty ring with none done, a check with all. */}
      <RailRow name={t('Elements')}
        icon={<ElementProgressMark size={14}
          status={progress.total > 0 && progress.done === progress.total ? 'done' : progress.done > 0 ? 'in_progress' : 'todo'}
          progress={progress.total ? (progress.done / progress.total) * 100 : 0} />}
        label={<span className="tabular-nums">{progress.done}/{progress.total}</span>} />
      <RailRow name={t('Updated')} label={formatRelative(strategy.updated_at)} />
    </div>
  );
}
