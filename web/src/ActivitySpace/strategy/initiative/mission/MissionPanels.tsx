'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/ui/button';
import { PageSection } from '@/Function/shared/PageHead';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { startElementRun } from '@/Function/copilot/agentData';
import { runsInClaudeCode } from '@/Function/team/agentModel';
import { updateElement } from '@/hooks/useSupabase';
import { formatRelative } from '@/Function/shared/dateUtils';
import { applyInitiativePlan, requestInitiativePlan, type MissionData } from '@/hooks/initiativeMissionData';
import type { Worker } from '@/types/database';
import { MissionGraph } from './MissionGraph';
import {
  actionState, buildMissionGraph, draftGraph, handOverLabels, isHandedOver, latestRuns, measureStateOf, missionBarriers, missionSummary, normalizePlan,
  type ActionState, type MissionBindingRow, type MissionElementRow, type MissionMeasureRow, type PlanDraft,
} from './missionModel';
import { measureStateLabel } from '../initiativeMeasureModel';

// The Plan, Execute and Evaluate tabs' own parts — the Planner and the
// mission graph, what is running and what it costs, what was achieved, what
// stands in the way, what was produced and what was approved. The tabs place
// them above their widget boards (StrategyShell).

export interface MissionContext {
  initiativeId: string;
  initiativeName: string;
  spaceId: string | null;
  canEdit: boolean;
  measures: MissionMeasureRow[];
  bindings: MissionBindingRow[];
  elements: MissionElementRow[];
  mission: MissionData;
  refetch: () => void;
  /** Elements open their Object, as everywhere on this page. */
  onOpenElement: (elementId: string) => void;
}

const STATE_LABEL: Record<ActionState, string> = {
  done: 'Done', running: 'Running', waiting: 'Waiting', blocked: 'Blocked', failed: 'Failed', todo: 'To do', cancelled: 'Cancelled',
};

function stateColor(state: ActionState): string {
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[20px] font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));

// ── Plan ────────────────────────────────────────────────────────────────────

export function MissionPlanPanel({ ctx, objects, aiWorkers, ensureRoot }: {
  ctx: MissionContext;
  /** The Initiative's Objects — where new Elements can go. */
  objects: { id: string; name: string }[];
  aiWorkers: Worker[];
  /** The Initiative's root intent; new objectives hang under it. */
  ensureRoot: () => Promise<string>;
}) {
  const { t } = useI18n();
  const [guidance, setGuidance] = useState('');
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [objectId, setObjectId] = useState<string>('');
  const [aiWorkerId, setAiWorkerId] = useState<string>('');
  const targetObject = objectId || objects[0]?.id || '';
  const aiWorker = aiWorkerId || aiWorkers[0]?.id || '';

  const graph = useMemo(() => (draft
    ? draftGraph(ctx.initiativeName, ctx.measures, draft)
    : buildMissionGraph({
      initiativeName: ctx.initiativeName, measures: ctx.measures, elements: ctx.elements, bindings: ctx.bindings,
      edges: ctx.mission.edges, runs: ctx.mission.runs, artifacts: ctx.mission.artifacts,
    })), [draft, ctx]);

  const plan = async () => {
    setPlanning(true); setError(null); setNotice(null);
    try {
      const raw = await requestInitiativePlan(ctx.initiativeId, guidance);
      const next = normalizePlan(raw, new Set(ctx.measures.map((m) => m.id)));
      if (next.tasks.length === 0) setError(t('The Planner returned no tasks. Add guidance and try again.'));
      else setDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  };

  const apply = async () => {
    if (!draft || !targetObject) return;
    setApplying(true); setError(null);
    try {
      const rootIntentId = draft.objectives.some((o) => !o.measureId) ? await ensureRoot().catch(() => null) : null;
      const result = await applyInitiativePlan({
        initiativeId: ctx.initiativeId, spaceId: ctx.spaceId, objectId: targetObject, rootIntentId,
        aiWorkerId: aiWorker || null, objectives: draft.objectives, tasks: draft.tasks,
        dispatch: runsInClaudeCode(aiWorkers.find((w) => w.id === aiWorker)?.ai_config),
      });
      setDraft(null);
      setNotice(result.failed.length
        ? t('Created {n} Elements. Could not finish: {items}', { n: result.created, items: result.failed.join(', ') })
        : t('Created {n} Elements.', { n: result.created }));
      ctx.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <PageSection title={t('Mission')}>
      <div className="space-y-3">
        <p className="text-[12px] text-muted-foreground">
          {t('The Planner reads this Initiative — its purpose, success conditions, assumptions and decisions — and drafts the actions that carry it out. Nothing is created until you approve the draft.')}
        </p>
        <div className="flex items-start gap-2">
          <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} rows={2}
            placeholder={t('Guidance for the Planner (optional): scope, constraints, what to leave out…')}
            className="min-h-[52px] flex-1 resize-y rounded-md border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:bg-muted/30" />
          <Button variant="primary" size="sm" onClick={() => void plan()} disabled={planning || applying}>
            {planning ? t('Planning…') : draft ? t('Plan again') : t('Plan with AI')}
          </Button>
        </div>

        {draft && (
          <div className="space-y-2 rounded-lg border border-dashed border-border px-3 py-2.5">
            {draft.summary && <p className="text-[13px] text-foreground">{draft.summary}</p>}
            <p className="text-[12px] text-muted-foreground">
              {t('{tasks} actions for {objectives} objectives. Dashed nodes are new.', { tasks: draft.tasks.length, objectives: draft.objectives.length })}
            </p>
            {ctx.canEdit && objects.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  {t('Create in')}
                  <select value={targetObject} onChange={(e) => setObjectId(e.target.value)}
                    className="rounded-md border border-border/60 bg-transparent px-1.5 py-1 text-foreground">
                    {objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  {t('AI actions go to')}
                  <select value={aiWorker} onChange={(e) => setAiWorkerId(e.target.value)}
                    className="rounded-md border border-border/60 bg-transparent px-1.5 py-1 text-foreground">
                    <option value="">{t('Nobody (assign later)')}</option>
                    {aiWorkers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={applying}>{t('Discard')}</Button>
                  <Button variant="primary" size="sm" onClick={() => void apply()} disabled={applying}>
                    {applying ? t('Creating…') : t('Create these actions')}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                {ctx.canEdit ? t('Link an Object on the Execute tab first — the actions are created in it.') : t("Only the Initiative's owner can turn the draft into Elements.")}
              </p>
            )}
          </div>
        )}

        {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
        {notice && <p role="status" className="text-[12px] text-muted-foreground">{notice}</p>}

        {graph.nodes.length > 1 ? (
          <MissionGraph graph={graph} onOpenAction={draft ? undefined : ctx.onOpenElement} />
        ) : (
          <p className="text-[12px] text-muted-foreground">{t('No objectives or actions yet. Plan with AI, or add success conditions and Objects.')}</p>
        )}
      </div>
    </PageSection>
  );
}

// ── Execute ─────────────────────────────────────────────────────────────────

export function MissionExecutePanel({ ctx }: { ctx: MissionContext }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const summary = missionSummary({ elements: ctx.elements, measures: ctx.measures, runs: ctx.mission.runs, artifacts: ctx.mission.artifacts });
  const runs = latestRuns(ctx.mission.runs);
  const rows = ctx.elements
    .map((e) => ({ element: e, run: runs.get(e.id), state: actionState(e, runs.get(e.id)) }))
    .filter((r) => r.state !== 'cancelled');
  // run-agent starts only work that is not Claude Code's; Claude Code work is
  // handed to the dev loop's dispatcher instead, which starts it on a Mac.
  const startable = rows.filter((r) => !r.element.claudeCode && (r.state === 'todo' || r.state === 'failed'));
  const handable = rows.filter((r) => r.element.claudeCode && r.state === 'todo' && !isHandedOver(r.element));

  const handOver = async (ids: string[]) => {
    setBusy(ids.length === 1 ? ids[0] : 'all'); setNotice(null);
    let failed = 0;
    for (const id of ids) {
      const element = ctx.elements.find((e) => e.id === id);
      try { await updateElement(id, { labels: handOverLabels(element?.labels) }); } catch { failed += 1; }
    }
    setBusy(null);
    if (failed) setNotice(t('{n} could not be handed to Claude Code.', { n: failed }));
    ctx.refetch();
  };

  const run = async (elementId: string) => {
    setBusy(elementId); setNotice(null);
    const outcome = await startElementRun(elementId);
    setBusy(null);
    if (outcome === 'failed') setNotice(t('Could not start the run.'));
    ctx.refetch();
  };

  const runAll = async () => {
    if (!await appDialog.confirm(t('Start AI runs for {n} actions? Each run spends from this Space\'s AI budget.', { n: startable.length }))) return;
    setBusy('all'); setNotice(null);
    let failed = 0;
    for (const r of startable) if (await startElementRun(r.element.id) === 'failed') failed += 1;
    setBusy(null);
    if (failed) setNotice(t('{n} runs could not start.', { n: failed }));
    ctx.refetch();
  };

  return (
    <PageSection title={t('Execution status')} action={startable.length > 0 || handable.length > 0 ? (
      <>
        {handable.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => void handOver(handable.map((r) => r.element.id))} disabled={busy !== null}>
            {t('Hand {n} to Claude Code', { n: handable.length })}
          </Button>
        )}
        {startable.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => void runAll()} disabled={busy !== null}>
            {t('Run {n} with AI', { n: startable.length })}
          </Button>
        )}
      </>
    ) : undefined}>
      <div className="space-y-3">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
          <Stat label={t('Progress')} value={`${summary.progress}%`} sub={t('{done} of {all} actions', { done: summary.done, all: summary.actions })} />
          <Stat label={t('Running')} value={String(summary.running)} />
          <Stat label={t('Waiting on a person')} value={String(summary.waiting)} />
          <Stat label={t('Blocked or failed')} value={String(summary.blocked + summary.failed)} />
          <Stat label={t('Tokens')} value={compact(summary.inputTokens + summary.outputTokens)}
            sub={t('in {input} · out {output}', { input: compact(summary.inputTokens), output: compact(summary.outputTokens) })} />
          <Stat label={t('AI cost')} value={`$${summary.costUsd.toFixed(2)}`} />
        </div>
        {notice && <p role="status" className="text-[12px] text-muted-foreground">{notice}</p>}
        {rows.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t('No actions yet. Plan the mission on the Plan tab, or link Objects with work in them.')}</p>
        ) : (
          <div className="divide-y divide-border/50 rounded-lg border border-border/60">
            {rows.map(({ element, run: latest, state }) => (
              <div key={element.id} className="flex items-center gap-2.5 px-3 py-2">
                <StateDot state={state} />
                <button type="button" onClick={() => ctx.onOpenElement(element.id)}
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-foreground hover:underline">
                  {element.display_id ? `${element.display_id} ` : ''}{element.title}
                </button>
                <span className="shrink-0 text-[11px]" style={{ color: stateColor(state) }}>{t(STATE_LABEL[state])}</span>
                {latest && (
                  <span className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground md:inline">
                    {latest.model ?? ''} · {compact(latest.input_tokens + latest.output_tokens)} · ${Number(latest.cost_usd || 0).toFixed(2)}
                  </span>
                )}
                {element.claudeCode && state === 'todo' && (isHandedOver(element) ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">{t('Handed to Claude Code')}</span>
                ) : (
                  <Button variant="ghost" size="xs" onClick={() => void handOver([element.id])} disabled={busy !== null}>
                    {busy === element.id ? t('Handing over…') : t('Hand to Claude Code')}
                  </Button>
                ))}
                {!element.claudeCode && (state === 'todo' || state === 'failed') && (
                  <Button variant="ghost" size="xs" onClick={() => void run(element.id)} disabled={busy !== null}>
                    {busy === element.id ? t('Starting…') : state === 'failed' ? t('Retry with AI') : t('Run with AI')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </PageSection>
  );
}

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
