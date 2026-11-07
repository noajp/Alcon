'use client';

import { useState } from 'react';
import { PageSection } from '@/Function/shared/PageHead';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { formatRelative } from '@/Function/shared/dateUtils';
import type { MissionData } from '@/hooks/initiativeMissionData';
import type { StrategyDelegation } from '@/types/database';
import {
  type ActionState, type MissionBindingRow, type MissionElementRow, type MissionMeasureRow,
} from './missionModel';

// What the Strategy page's work and its record share, and the record's own
// parts — what was produced and what was approved, each shown once there is
// any. The Execution tab's Objects and Elements are in
// MissionExecution. The tabs place them above their widget boards
// (StrategyShell).

export interface MissionContext {
  initiativeId: string;
  initiativeName: string;
  spaceId: string | null;
  canEdit: boolean;
  measures: MissionMeasureRow[];
  bindings: MissionBindingRow[];
  elements: MissionElementRow[];
  mission: MissionData;
  /** False until the runs and dependencies are read; until then nothing counts as ready. */
  missionLoaded: boolean;
  /** How far the Strategy's AI work goes on its own. */
  delegation: StrategyDelegation;
  setDelegation: (d: StrategyDelegation) => Promise<void>;
  /** The definition the Strategy's Elements follow. */
  definitionId: string | null;
  setDefinition: (id: string | null) => Promise<void>;
  refetch: () => void;
  /** Elements open their Object, as everywhere on this page. */
  onOpenElement: (elementId: string) => void;
  /** Opens the Strategy's conversation, to settle what the Planner needs by talking. */
  onTalk?: () => void;
}

export const STATE_LABEL: Record<ActionState, string> = {
  done: 'Done', running: 'Running', waiting: 'Waiting', blocked: 'Blocked', failed: 'Failed', todo: 'To do', cancelled: 'Cancelled',
};

export function stateColor(state: ActionState): string {
  switch (state) {
    case 'done': return 'var(--status-success)';
    case 'running': return 'var(--status-info)';
    case 'waiting': return 'var(--status-warning)';
    case 'blocked': case 'failed': return 'var(--status-danger)';
    default: return 'var(--text-tertiary)';
  }
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col rounded-md border border-[var(--border-subtle)] px-3 py-2.5">
      <div className="truncate text-[11px] leading-4 text-muted-foreground" title={label}>{label}</div>
      <div className="mt-1.5 text-[22px] font-semibold leading-7 tracking-tight tabular-nums text-foreground">{value}</div>
      <div className="truncate text-[11px] leading-4 text-muted-foreground">{sub ?? '\u00a0'}</div>
    </div>
  );
}


// ── Evaluate ────────────────────────────────────────────────────────────────

export function MissionEvaluatePanel({ ctx }: { ctx: MissionContext }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const titleOf = new Map(ctx.elements.map((e) => [e.id, e.display_id ? `${e.display_id} ${e.title}` : e.title]));
  const decided = ctx.mission.actions;
  const finishedRuns = ctx.mission.runs.filter((r) => r.finished_at);

  return (
    <div className="space-y-6">
      {ctx.mission.artifacts.length > 0 && <PageSection title={t('Deliverables')}>
        {(
          <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
            {ctx.mission.artifacts.map((a) => (
              <li key={a.id} className="px-3 py-2">
                <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full items-center gap-2 text-left">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{a.title}</span>
                  <span className="shrink-0 truncate text-[11px] text-muted-foreground">{titleOf.get(a.element_id) ?? ''}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(a.updated_at)}</span>
                </button>
                {open === a.id && (
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-muted)] p-2.5 text-[12px] text-foreground">{a.content}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageSection>}

      {(decided.length > 0 || finishedRuns.length > 0) && <PageSection title={t('Audit trail')}>
        {(
          <ul className="space-y-1.5 text-[13px]">
            {decided.map((a) => (
              <li key={`a:${a.id}`}>
                <div className="text-foreground">{a.summary}{a.decision_note ? ` — ${a.decision_note}` : ''}</div>
                <div className="text-[11px] text-muted-foreground">{t('Approval')} · {a.status} · {formatRelative(a.decided_at ?? a.created_at)}</div>
              </li>
            ))}
            {finishedRuns.map((r) => (
              <li key={`r:${r.id}`}>
                <div className="text-foreground">{titleOf.get(r.element_id) ?? ''}{r.summary ? ` — ${r.summary}` : ''}</div>
                <div className="text-[11px] tabular-nums text-muted-foreground">
                  {t('Run')} · {r.status} · {r.model ?? ''} · ${Number(r.cost_usd || 0).toFixed(2)} · {formatRelative(r.finished_at!)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PageSection>}
    </div>
  );
}
