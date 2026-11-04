'use client';

import { useState } from 'react';
import { PageSection } from '@/Function/shared/PageHead';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { formatRelative } from '@/Function/shared/dateUtils';
import type { MissionData } from '@/hooks/initiativeMissionData';
import {
  measureStateOf, missionBarriers, missionSummary,
  type ActionState, type MissionBindingRow, type MissionElementRow, type MissionMeasureRow,
} from './missionModel';
import { measureStateLabel } from '../initiativeMeasureModel';

// What the Execution and Evaluate tabs share, and the Evaluate tab's own
// parts — what was achieved, what stands in the way, what was produced and
// what was approved. The Execution tab's Objects and Elements are in
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
  refetch: () => void;
  /** Elements open their Object, as everywhere on this page. */
  onOpenElement: (elementId: string) => void;
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

function StateDot({ state }: { state: ActionState }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: stateColor(state) }} />;
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[20px] font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));

// ── Evaluate ────────────────────────────────────────────────────────────────

export function MissionEvaluatePanel({ ctx }: { ctx: MissionContext }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const summary = missionSummary({ elements: ctx.elements, measures: ctx.measures, runs: ctx.mission.runs, artifacts: ctx.mission.artifacts });
  const barriers = missionBarriers(ctx.elements, ctx.mission.runs);
  const titleOf = new Map(ctx.elements.map((e) => [e.id, e.display_id ? `${e.display_id} ${e.title}` : e.title]));
  const decided = ctx.mission.actions;
  const finishedRuns = ctx.mission.runs.filter((r) => r.finished_at);

  return (
    <div className="space-y-6">
      <PageSection title={t('Achievement')}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
          <Stat label={t('Success conditions met')} value={`${summary.measuresMet} / ${summary.measures}`} />
          <Stat label={t('Actions done')} value={`${summary.progress}%`} sub={t('{done} of {all} actions', { done: summary.done, all: summary.actions })} />
          <Stat label={t('Deliverables')} value={String(summary.artifacts)} />
          <Stat label={t('AI cost')} value={`$${summary.costUsd.toFixed(2)}`} />
        </div>
        {ctx.measures.length > 0 && (
          <ul className="mt-2 space-y-1">
            {ctx.measures.map((m) => {
              const state = measureStateOf(m);
              return (
                <li key={m.id} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-foreground">{m.title}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {m.actual_value ?? '—'}{m.target_value != null ? ` / ${m.target_value}` : ''}{m.unit ?? ''}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{measureStateLabel(state)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </PageSection>

      <PageSection title={t('Barriers')}>
        {barriers.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t('Nothing is blocked, failed or waiting on a person.')}</p>
        ) : (
          <ul className="space-y-1.5">
            {barriers.map((b) => (
              <li key={b.elementId} className="flex items-start gap-2 text-[13px]">
                <StateDot state={b.kind} />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => ctx.onOpenElement(b.elementId)} className="block w-full truncate text-left text-foreground hover:underline">{b.label}</button>
                  {b.detail && <p className="line-clamp-2 text-[12px] text-muted-foreground">{b.detail}</p>}
                </div>
                <span className="shrink-0 text-[11px]" style={{ color: stateColor(b.kind) }}>{t(STATE_LABEL[b.kind])}</span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title={t('Deliverables')}>
        {ctx.mission.artifacts.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t('No deliverables yet. What AI runs save to their Elements appears here.')}</p>
        ) : (
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
      </PageSection>

      <PageSection title={t('Audit trail')}>
        {decided.length === 0 && finishedRuns.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t('No AI runs or approvals yet.')}</p>
        ) : (
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
      </PageSection>
    </div>
  );
}
