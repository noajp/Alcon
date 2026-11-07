'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Clock, Flag, Hand, Pause } from '@/ui/icons';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { ElementIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { PageSection } from '@/Function/shared/PageHead';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { advanceFromElement, startElementRun } from '@/AIP/ai/agentData';
import { runsInClaudeCode } from '@/Function/team/agentModel';
import { updateElement } from '@/hooks/useSupabase';
import { applyInitiativePlan, requestInitiativePlan } from '@/hooks/initiativeMissionData';
import { createIntent } from '@/hooks/strategyData';
import { AI_WEIGHTS, isAiWeight, type AgentRunStatus, type AiWeight, type ElementWithDetails, type StrategyDelegation, type Worker } from '@/types/database';
import { ElementCard } from '@/ActivitySpace/execution/element/board/ElementCard';
import { FLOW_COLUMNS, FLOW_COLUMN_LABEL, flowColumnOf, type FlowColumn } from '@/ActivitySpace/execution/domain/flow/flowColumn';
import { StatusPicker } from '@/Function/shared/StatusPicker';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { ActionTag } from '@/Function/shared/elementAction';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { ElementProgressMark, getElementProgress } from '@/Function/shared/ElementProgressMark';
import {
  answeredQuestions, buildFleet, draftFleet, handOverLabels, measureStateOf, missionSummary, normalizePlan, normalizeQuestions, plannerSources,
  startableTasks, UNPLACED, yourTurn,
  type ActionState, type FleetElement, type FleetObject, type FleetObjectRow, type PlanDraft, type PlannerSource, type PlanQuestion,
} from './missionModel';
import { STATE_LABEL, compact, stateColor, type MissionContext } from './MissionPanels';
import { YourTurnTray } from './YourTurnTray';
import { measureStateLabel } from '../initiativeMeasureModel';
import { DefinitionPanel } from './DefinitionPanel';
import { listenForPlanRequests } from './plannerRequest';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { setElementAiWeight, setElementDefinition, useDefinitions, useRunRounds, type Definition, type RoundSummary } from '@/hooks/definitionData';

// The Strategy's Execution Chain: every action under its Objects in a column
// for where it stands — To do, Waiting on you, In progress, To review, Done —
// left to right, as a Domain's Flow board reads them, each card saying which
// Object it belongs to, who carries it out, what it delivers and what it
// waits on. The Planner's draft waits, dashed, in the first column until the
// person creates it; then its actions move along the chain like the rest.

/** The card ground, as the Board's Element cards draw it. */
const CARD = 'rounded-lg border border-[var(--border-subtle)] bg-card dark:bg-muted shadow-[var(--shadow-island)]';

function StateIcon({ state }: { state: ActionState }) {
  switch (state) {
    case 'running': return <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />;
    case 'done': return <Check size={11} strokeWidth={2.5} />;
    case 'failed': case 'blocked': return <AlertTriangle size={11} />;
    case 'waiting': return <Hand size={11} />;
    case 'cancelled': return <Pause size={11} />;
    default: return <span className="h-1.5 w-1.5 rounded-full bg-current" />;
  }
}

function StateBadge({ state }: { state: ActionState }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{ color: stateColor(state), background: `color-mix(in srgb, ${stateColor(state)} 14%, transparent)` }}>
      <StateIcon state={state} />
      {t(STATE_LABEL[state])}
    </span>
  );
}

/** One count of the summary line: quiet at zero, coloured when it asks for something. */
/** One count of the summary: the number over its label, so every count
 *  shares one baseline. A count that asks for something takes its tone;
 *  zero stays quiet. */
function Fact({ label, n, tone }: { label: string; n: number; tone?: 'warning' | 'danger' }) {
  const color = n > 0 && tone ? `var(--status-${tone})` : undefined;
  return (
    <span className="flex flex-col">
      <span className={cn('text-[15px] font-medium leading-5 tabular-nums', n > 0 ? 'text-foreground' : 'text-muted-foreground')}
        style={color ? { color } : undefined}>{n}</span>
      <span className="text-[11px] leading-4 text-muted-foreground">{label}</span>
    </span>
  );
}

/** Whether the card's state comes from an AI run rather than the Element's
 *  Status — the one case the card still needs a badge for. */
function runOnlyState(state: ActionState, status: string | null): boolean {
  if (state === 'failed') return true;
  if (state === 'running') return status !== 'in_progress';
  if (state === 'waiting') return status !== 'review';
  return false;
}

function DraftTag() {
  const { t } = useI18n();
  return <span className="shrink-0 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{t('Draft')}</span>;
}


const STRATEGY_DEFINITION = '__strategy';

/** The Element's own definition, chosen on its card: its output shape and its
 *  loop are enforced for it (a Strategy's definition only directs). */
function DefinitionPick({ value, definitions, onChange }: { value: string | null; definitions: Definition[]; onChange: (id: string | null) => void }) {
  const { t } = useI18n();
  if (definitions.length === 0 && !value) return null;
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <span className="shrink-0">{t('Harness')}</span>
      <OptionMenu label={t('Harness')} value={value ?? STRATEGY_DEFINITION}
        options={[{ value: STRATEGY_DEFINITION, label: t('The Strategy\'s') }, ...definitions.map((d) => ({ value: d.id, label: d.name }))]}
        onChange={(v) => onChange(v === STRATEGY_DEFINITION ? null : v)} />
    </span>
  );
}

const WEIGHT_LABEL: Record<AiWeight, string> = { light: 'Light (small model)', standard: 'Standard', heavy: 'Heavy (large model)' };

/** How heavy the work is for an AI: the model a run picks when no setting names one. */
function WeightPick({ value, onChange }: { value: AiWeight | null; onChange: (w: AiWeight | null) => void }) {
  const { t } = useI18n();
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <span className="shrink-0">{t('Weight')}</span>
      <OptionMenu label={t('Weight')} value={value ?? 'standard'}
        options={AI_WEIGHTS.map((w) => ({ value: w, label: t(WEIGHT_LABEL[w]) }))}
        onChange={(w) => onChange(w === 'standard' ? null : w)} />
    </span>
  );
}

/** What the Execution tab adds under a card's title: what it delivers,
 *  what it waits on, the model that ran it and what that cost, and a hand-off
 *  to Claude Code. */
function MissionLines({ element, busy, onHandOver, rounds, definitionPick, pickSet = false }: {
  element: FleetElement; busy: boolean; onHandOver?: () => void; rounds?: RoundSummary; definitionPick?: React.ReactNode;
  /** A definition or weight other than the default is chosen: its row stays in view. */
  pickSet?: boolean;
}) {
  const { t } = useI18n();
  const meta = [element.model, element.costUsd > 0 ? `$${element.costUsd.toFixed(2)}` : null].filter(Boolean).join(' · ');
  // A loop's progress: how many rounds, the latest value and the best.
  const loop = rounds && rounds.rounds > 0
    ? t('{n} rounds · latest {last} · best {best}', {
      n: rounds.rounds, last: rounds.last ?? '—',
      best: rounds.values.length ? Math.max(...rounds.values) : '—',
    })
    : null;
  if (!element.serves.length && !element.waitsOn.length && !meta && !onHandOver && !loop && !definitionPick) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-[12px] leading-5 text-muted-foreground">
      {element.serves.length > 0 && (
        <div className="flex min-w-0 items-center gap-1.5"><Flag size={12} className="shrink-0" /><span className="truncate">{element.serves.join(', ')}</span></div>
      )}
      {element.waitsOn.length > 0 && (
        <div className="flex min-w-0 items-center gap-1.5"><Clock size={12} className="shrink-0" /><span className="truncate">{t('After {items}', { items: element.waitsOn.join(', ') })}</span></div>
      )}
      {loop && <div className="tabular-nums">{loop}</div>}
      {/* How the AI runs it is a setting, not the work: shown only while the
          card is hovered or focused, unless something other than the
          default is chosen. */}
      {definitionPick && (
        <div className={cn('min-w-0 flex-wrap items-center gap-x-3', pickSet ? 'flex' : 'hidden group-hover/card:flex group-focus-within/card:flex has-[[data-state=open]]:flex')}>
          {definitionPick}
        </div>
      )}
      {(meta || onHandOver) && (
        <div className="flex items-center gap-2 tabular-nums">
          {meta && <span className="truncate text-[11px] text-muted-foreground/70">{meta}</span>}
          {onHandOver && (
            <Button variant="ghost" size="xs" className="ml-auto" onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onHandOver(); }} disabled={busy}>
              {t('Hand to Claude Code')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** A task of the Planner's draft, drawn as the Element card it will become —
 *  dashed, and not editable until it is created. */
function DraftCard({ element }: { element: FleetElement }) {
  const { t } = useI18n();
  return (
    <div className={cn(CARD, 'border-dashed border-border px-3 py-2.5')}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-foreground line-clamp-3 break-words">{element.title}</p>
        {element.action && <ActionTag action={element.action} className="mt-0.5" />}
        <DraftTag />
      </div>
      <MissionLines element={element} busy={false} />
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[12px] text-muted-foreground">
        {element.assignee === 'human' ? <span className="truncate">{element.assigneeName ?? t('A person')}</span> : t('AI')}
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border">
          <ElementIcon size={11} />
        </span>
      </div>
    </div>
  );
}


export function MissionExecutionPanel({ ctx, objects, details, domains, aiWorkers, people, ensureRoot }: {
  ctx: MissionContext;
  /** The written Elements, by id, as the shared Element card reads them. */
  details: ReadonlyMap<string, ElementWithDetails>;
  /** The Strategy's Objects, in order. */
  objects: FleetObjectRow[];
  /** The Space's Domains — where a new Object can go. */
  domains: { id: string; name: string }[];
  aiWorkers: Worker[];
  /** The Space's people — whom the Planner may give a person's task to. */
  people: Worker[];
  /** The Strategy's root intent; new objectives hang under it. */
  ensureRoot: () => Promise<string>;
}) {
  const { t } = useI18n();
  const [guidance, setGuidance] = useState('');
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  // How the Planner read the Strategy's files for the current draft.
  const [sources, setSources] = useState<PlannerSource[] | null>(null);
  // The Planner's questions, asked before it plans, and the answers typed.
  const [questions, setQuestions] = useState<{ reason: string; items: PlanQuestion[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiWorkerId, setAiWorkerId] = useState('');
  const [fallbackObjectId, setFallbackObjectId] = useState('');
  const [fallbackDomainId, setFallbackDomainId] = useState('');
  const aiWorker = aiWorkerId || aiWorkers[0]?.id || '';
  const placeIn = fallbackObjectId || objects[0]?.id || '';
  const newObjectsIn = fallbackDomainId || objects.find((o) => o.domain_id)?.domain_id || domains[0]?.id || '';
  const personName = useMemo(() => new Map(people.map((w) => [w.id, w.name])), [people]);

  const current = useMemo(() => buildFleet({
    objects, elements: ctx.elements, measures: ctx.measures, bindings: ctx.bindings,
    edges: ctx.mission.edges, runs: ctx.mission.runs,
  }), [objects, ctx.elements, ctx.measures, ctx.bindings, ctx.mission.edges, ctx.mission.runs]);
  const fleet = useMemo(() => (draft ? draftFleet(current, ctx.measures, draft, personName) : current), [draft, current, ctx.measures, personName]);

  const summary = missionSummary({ elements: ctx.elements, measures: ctx.measures, runs: ctx.mission.runs, artifacts: ctx.mission.artifacts });
  // Before the dependencies are read every AI Element would look ready.
  const ready = ctx.missionLoaded ? current.flatMap((o) => o.elements.filter((e) => e.ready)) : [];
  const handable = current.flatMap((o) => o.elements.filter((e) => e.handable));
  const rounds = useRunRounds(ctx.elements.map((e) => e.id));
  const definitions = useDefinitions(ctx.spaceId);
  const turns = useMemo(() => yourTurn({ fleet: current, elements: ctx.elements, runs: ctx.mission.runs, actions: ctx.mission.actions }),
    [current, ctx.elements, ctx.mission.runs, ctx.mission.actions]);

  const plan = async (opts: { answers?: { question: string; answer: string }[]; noQuestions?: boolean; guidance?: string } = {}) => {
    setPlanning(true); setError(null); setNotice(null);
    try {
      const reply = await requestInitiativePlan(ctx.initiativeId, opts.guidance ?? guidance, opts);
      setSources(plannerSources(reply.sources));
      const asked = normalizeQuestions(reply.questions);
      if (asked.length > 0) {
        setQuestions({ reason: reply.reason, items: asked });
        setAnswers({});
        setDraft(null);
        return;
      }
      setQuestions(null);
      const next = normalizePlan(reply.plan, new Set(ctx.measures.map((m) => m.id)), {
        objects: new Map(objects.map((o) => [o.id, o.name])),
        domainIds: new Set(domains.map((d) => d.id)),
        definitionIds: new Set(definitions.data.map((d) => d.id)),
        workerIds: new Set(personName.keys()),
      });
      if (next.tasks.length === 0) setError(t('The Planner returned no tasks. Add guidance and try again.'));
      else setDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  };

  // The conversation hands the Planner its guidance: shown in the box, and
  // planned with at once.
  const planRef = useRef(plan);
  useEffect(() => { planRef.current = plan; });
  useEffect(() => listenForPlanRequests(ctx.initiativeId, (g) => {
    setGuidance(g);
    void planRef.current({ guidance: g });
  }), [ctx.initiativeId]);

  // The answers become the Strategy's assumptions — what every later run
  // reads — and the Planner plans with them.
  const answerAndPlan = async () => {
    if (!questions) return;
    const given = answeredQuestions(questions.items, answers);
    if (ctx.canEdit && given.length > 0) {
      const root = await ensureRoot().catch(() => null);
      if (root) {
        for (const g of given) {
          await createIntent({ strategy_id: ctx.initiativeId, parent_intent_id: root, kind: 'assumption', title: `${g.question} → ${g.answer}` })
            .catch(() => undefined);
        }
        ctx.refetch();
      }
    }
    await plan({ answers: given, noQuestions: true });
  };

  const start = async (elementIds: string[]) => {
    let failed = 0;
    for (const id of elementIds) if (await startElementRun(id) === 'failed') failed += 1;
    return failed;
  };

  const apply = async (andRun: boolean) => {
    if (!draft) return;
    setApplying(true); setError(null); setNotice(null);
    try {
      const rootIntentId = draft.objectives.some((o) => !o.measureId) ? await ensureRoot().catch(() => null) : null;
      const worker = aiWorkers.find((w) => w.id === aiWorker);
      const dispatch = runsInClaudeCode(worker?.ai_config);
      const result = await applyInitiativePlan({
        initiativeId: ctx.initiativeId, spaceId: ctx.spaceId,
        fallbackObjectId: placeIn || null, fallbackDomainId: newObjectsIn || null, rootIntentId,
        aiWorkerId: aiWorker || null, objectives: draft.objectives, objects: draft.objects, tasks: draft.tasks, dispatch,
      });
      // Claude Code work is handed over on creation; the rest an AI starts now.
      const toStart = andRun && !dispatch
        ? startableTasks(draft).map((k) => result.elementIds[k]).filter((id): id is string => !!id)
        : [];
      const notStarted = toStart.length ? await start(toStart) : 0;
      setDraft(null);
      const created = result.failed.length
        ? t('Created {n} Elements. Could not finish: {items}', { n: result.created, items: result.failed.join(', ') })
        : t('Created {n} Elements.', { n: result.created });
      setNotice(toStart.length
        ? `${created} ${t('Started {n} AI runs.', { n: toStart.length - notStarted })}${notStarted ? ` ${t('{n} runs could not start.', { n: notStarted })}` : ''}`
        : created);
      ctx.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };


  const runReady = async () => {
    if (!await appDialog.confirm(t('Start AI runs for {n} actions? Each run spends from this Space\'s AI budget.', { n: ready.length }))) return;
    setBusy('all'); setNotice(null);
    const failed = await start(ready.map((e) => e.elementId!));
    setBusy(null);
    if (failed) setNotice(t('{n} runs could not start.', { n: failed }));
    ctx.refetch();
  };

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

  // Where each action stands: a written Element by its Status, its action and
  // its latest AI run, as on a Domain's Flow board; a draft task is not
  // created yet, so it waits in the first column.
  const chain = useMemo(() => {
    const latest = new Map<string, AgentRunStatus>();
    for (const r of [...ctx.mission.runs].sort((a, b) => a.created_at.localeCompare(b.created_at))) latest.set(r.element_id, r.status);
    const columns = Object.fromEntries(FLOW_COLUMNS.map((c) => [c, [] as { element: FleetElement; object: FleetObject }[]])) as Record<FlowColumn, { element: FleetElement; object: FleetObject }[]>;
    for (const o of fleet) {
      for (const e of o.elements) {
        const written = e.elementId ? details.get(e.elementId) : undefined;
        const column = written ? flowColumnOf(written, latest.get(written.id) ?? null) : e.draft ? 'todo' : null;
        if (column) columns[column].push({ element: e, object: o });
      }
    }
    // The draft's tasks first in their column: they are what is new.
    columns.todo.sort((a, b) => Number(b.element.draft) - Number(a.element.draft));
    return columns;
  }, [fleet, details, ctx.mission.runs]);

  const cardFor = (e: FleetElement) => (
e.elementId && details.get(e.elementId) ? (
                    <ElementCard element={details.get(e.elementId)!} onRefresh={ctx.refetch}
                      onOpen={() => ctx.onOpenElement(e.elementId!)}
                      // The Element's Status, as every list shows it: the mark
                      // opens the status menu, so work an agent left for
                      // review is approved (Done) right from its card.
                      lead={ctx.canEdit ? (
                        <span onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => ev.stopPropagation()} className="flex">
                          <StatusPicker element={details.get(e.elementId)!}
                            onChanged={(s) => { if (s === 'done' || s === 'cancelled') void advanceFromElement(e.elementId!).then(() => ctx.refetch()); else ctx.refetch(); }} />
                        </span>
                      ) : (
                        <ElementProgressMark status={details.get(e.elementId)!.status} progress={getElementProgress(details.get(e.elementId)!)} size={16} />
                      )}
                      // Only what the Status cannot say: an AI run that is
                      // going, waiting on someone, or has failed.
                      // What it asks someone to do, then only what the Status
                      // cannot say: an AI run going, waiting or failed.
                      badge={(e.action || runOnlyState(e.state, details.get(e.elementId)!.status)) ? (
                        <span className="flex shrink-0 items-center gap-1.5">
                          {e.action && <ActionTag action={e.action} className="mt-0.5" />}
                          {runOnlyState(e.state, details.get(e.elementId)!.status) && <StateBadge state={e.state} />}
                        </span>
                      ) : undefined}
                      extra={<MissionLines element={e} rounds={rounds.get(e.elementId)} busy={busy !== null && (busy === 'all' || busy === e.elementId)}
                        pickSet={!!details.get(e.elementId)?.definition_id || (e.assignee === 'ai' && isAiWeight(details.get(e.elementId)?.ai_weight) && details.get(e.elementId)?.ai_weight !== 'standard')}
                        definitionPick={ctx.canEdit ? (
                          <>
                            <DefinitionPick value={details.get(e.elementId)?.definition_id ?? null} definitions={definitions.data}
                              onChange={(id) => void setElementDefinition(e.elementId!, id).then(() => ctx.refetch())} />
                            {e.assignee === 'ai' && (
                              <WeightPick value={isAiWeight(details.get(e.elementId)?.ai_weight) ? details.get(e.elementId)!.ai_weight as AiWeight : null}
                                onChange={(w) => void setElementAiWeight(e.elementId!, w).then(() => ctx.refetch())} />
                            )}
                          </>
                        ) : undefined}
                        onHandOver={!draft && e.handable ? () => void handOver([e.elementId!]) : undefined} />} />
                  ) : (
                    <DraftCard element={e} />
                  )
  );

  const draftTasks = draft?.tasks.length ?? 0;
  const draftNewObjects = draft?.objects.filter((o) => !o.objectId).length ?? 0;
  const unplaced = fleet.some((o) => o.key === UNPLACED);
  const domainless = draft?.objects.some((o) => !o.objectId && !o.domainId) ?? false;
  const startNow = draft ? startableTasks(draft).length : 0;
  const canApply = (!unplaced || !!placeIn) && (!domainless || !!newObjectsIn);

  return (
    <PageSection title={t('Execution')} action={!draft && (ready.length > 0 || handable.length > 0) ? (
      <>
        {handable.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => void handOver(handable.map((e) => e.elementId!))} disabled={busy !== null}>
            {t('Hand {n} to Claude Code', { n: handable.length })}
          </Button>
        )}
        {ready.length > 0 && (
          <Button variant="primary" size="sm" onClick={() => void runReady()} disabled={busy !== null}>
            {t('Run {n} ready with AI', { n: ready.length })}
          </Button>
        )}
      </>
    ) : undefined}>
      <div className="space-y-3">
        {/* How it stands: how far along, large; then the counts that may ask
            for something, each number over its label; what the AI has used
            sits apart and quieter — it is bookkeeping, not the work. */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <span className="flex flex-col">
              <span className="text-[28px] font-semibold leading-8 tracking-tight tabular-nums text-foreground">{summary.progress}%</span>
              <span className="text-[11px] leading-4 text-muted-foreground">{t('{done} of {all} actions', { done: summary.done, all: summary.actions })}</span>
            </span>
            <span className="flex items-end gap-6">
              <Fact label={t('Running')} n={summary.running} />
              <Fact label={t('Waiting on a person')} n={summary.waiting} tone="warning" />
              <Fact label={t('Blocked or failed')} n={summary.blocked + summary.failed} tone="danger" />
            </span>
            <span className="ml-auto flex flex-col items-end text-[11px] leading-4 tabular-nums text-muted-foreground/80"
              title={t('in {input} · out {output}', { input: compact(summary.inputTokens), output: compact(summary.outputTokens) })}>
              <span>{t('AI cost')} ${summary.costUsd.toFixed(2)}</span>
              <span>{t('{n} tokens', { n: compact(summary.inputTokens + summary.outputTokens) })}</span>
            </span>
          </div>
          <SegmentedProgress value={summary.progress} />
        </div>

        {/* What the work is judged on: each success condition, its actual
            against its target. Work done is not the same as the Strategy won. */}
        {ctx.measures.length > 0 && (
          <div className="space-y-1">
            <p className="text-[12px] text-muted-foreground">
              {t('Success conditions')} <span className="tabular-nums">{summary.measuresMet} / {summary.measures}</span>
            </p>
            <ul className="space-y-1">
              {ctx.measures.map((m) => {
                const state = measureStateOf(m);
                return (
                  <li key={m.id} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-foreground">{m.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {m.actual_value ?? '—'}{m.target_value != null ? ` / ${m.target_value}` : ''}{m.unit ?? ''}
                    </span>
                    <span className="w-24 shrink-0 text-right text-[11px]"
                      style={{ color: state === 'met' ? 'var(--status-success)' : state === 'missed' ? 'var(--status-danger)' : 'var(--muted-foreground)' }}>
                      {measureStateLabel(state)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {ctx.missionLoaded && (
          <YourTurnTray items={turns} canEdit={ctx.canEdit} onOpen={ctx.onOpenElement} onChanged={ctx.refetch} />
        )}

        {/* How the AI works here: two settings, each one line. */}
        <div className="space-y-1 text-[12px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="w-36 shrink-0">{t('When an AI finishes')}</span>
            <OptionMenu label={t('When an AI finishes')} value={ctx.delegation} disabled={!ctx.canEdit}
              onChange={(v) => void ctx.setDelegation(v)}
              options={[
                { value: 'manual' as StrategyDelegation, label: t('A person reviews each result'), hint: t('Nothing starts until you approve the result.') },
                { value: 'auto' as StrategyDelegation, label: t('Verified results go on to the next step'), hint: t("Stops at a person's Element, an approval or a blocked run.") },
              ]} />
          </div>
          <DefinitionPanel spaceId={ctx.spaceId} definitionId={ctx.definitionId} canEdit={ctx.canEdit} onChange={ctx.setDefinition} />
        </div>

        {/* Breaking it down: the Planner drafts Objects and Elements, and
            nothing is created until the draft is approved. Guidance is
            optional, so its field waits behind a link. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={draft ? 'secondary' : 'primary'} size="sm" onClick={() => void plan()} disabled={planning || applying || !!questions}
              title={t('The Planner reads this Strategy and breaks it down into Objects and Elements. Nothing is created until you approve the draft.')}>
              {planning ? t('Planning…') : draft ? t('Plan again') : t('Break down with AI')}
            </Button>
            {ctx.onTalk && (
              <Button variant="ghost" size="sm" onClick={ctx.onTalk} title={t('Settle the purpose, success conditions and premises by talking first')}>
                {t('Talk it through')}
              </Button>
            )}
            {!guidanceOpen && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setGuidanceOpen(true)}>
                {t('Add guidance')}
              </Button>
            )}
          </div>
          {guidanceOpen && (
            <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} rows={2} autoFocus
              placeholder={t('Guidance for the Planner (optional): scope, constraints, what to leave out…')}
              className="min-h-[52px] w-full resize-y rounded-md border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:bg-muted/30" />
          )}
        </div>
        {questions && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
            <div>
              <p className="text-[13px] font-medium text-foreground">{t('Before breaking this down, the Planner needs to know')}</p>
              {questions.reason && <p className="mt-0.5 text-[12px] text-muted-foreground">{questions.reason}</p>}
            </div>
            {questions.items.map((q) => (
              <div key={q.key} className="space-y-1.5">
                <p className="text-[13px] text-foreground">{q.question}</p>
                {q.options.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((o) => (
                      <button key={o} type="button" onClick={() => setAnswers((a) => ({ ...a, [q.key]: a[q.key] === o ? '' : o }))}
                        className={cn('rounded-md border px-2 py-1 text-[12px] transition-colors',
                          answers[q.key] === o ? 'border-[var(--accent-default)] bg-[var(--accent-default)]/10 text-foreground' : 'border-border/60 text-muted-foreground hover:bg-muted/40')}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                <input value={q.options.includes(answers[q.key] ?? '') ? '' : (answers[q.key] ?? '')}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                  placeholder={q.options.length > 0 ? t('Or write your own') : t('Your answer')}
                  className="w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-[12px] outline-none focus:bg-muted/30" />
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setQuestions(null); void plan({ noQuestions: true }); }} disabled={planning}>
                {t('Skip and break down')}
              </Button>
              <Button variant="primary" size="sm" onClick={() => void answerAndPlan()} disabled={planning}>
                {planning ? t('Planning…') : t('Answer and break down')}
              </Button>
            </div>
          </div>
        )}

        {draft && (
          <div className="space-y-2 rounded-lg border border-dashed border-border px-3 py-2.5">
            {draft.summary && <MarkdownLite text={draft.summary} className="text-[13px] leading-relaxed text-foreground" />}
            {sources && <PlannerSources sources={sources} />}
            <p className="text-[12px] text-muted-foreground">
              {t('{tasks} Elements in {objects} Objects, {fresh} of them new. Dashed cards are not created yet.', {
                tasks: draftTasks, objects: new Set(draft.tasks.map((x) => x.object).filter(Boolean)).size, fresh: draftNewObjects,
              })}
            </p>
            {ctx.canEdit ? (
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="flex items-center gap-0.5 text-muted-foreground">
                  {t('AI actions go to')}
                  <OptionMenu label={t('AI actions go to')} value={aiWorker} onChange={setAiWorkerId}
                    options={[{ value: '', label: t('Nobody (assign later)') }, ...aiWorkers.map((w) => ({ value: w.id, label: w.name }))]} />
                </span>
                {unplaced && (
                  <span className="flex items-center gap-0.5 text-muted-foreground">
                    {t('Unplaced work goes to')}
                    <OptionMenu label={t('Unplaced work goes to')} value={placeIn} onChange={setFallbackObjectId}
                      options={objects.length === 0 ? [{ value: '', label: t('No Objects yet') }] : objects.map((o) => ({ value: o.id, label: o.name }))} />
                  </span>
                )}
                {domainless && (
                  <span className="flex items-center gap-0.5 text-muted-foreground">
                    {t('New Objects go to')}
                    <OptionMenu label={t('New Objects go to')} value={newObjectsIn} onChange={setFallbackDomainId}
                      options={domains.map((d) => ({ value: d.id, label: d.name }))} />
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={applying}>{t('Discard')}</Button>
                  <Button variant="secondary" size="sm" onClick={() => void apply(false)} disabled={applying || !canApply}>
                    {applying ? t('Creating…') : t('Create')}
                  </Button>
                  {startNow > 0 && (
                    <Button variant="primary" size="sm" onClick={() => void apply(true)} disabled={applying || !canApply}>
                      {t('Create and run {n} with AI', { n: startNow })}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">{t("Only the Strategy's owner can turn the draft into Elements.")}</p>
            )}
          </div>
        )}

        {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
        {notice && <p role="status" className="text-[12px] text-muted-foreground">{notice}</p>}

        {fleet.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t('No Objects yet. Break the Strategy down with AI, or add Objects on the Overview.')}</p>
        ) : (
          // The chain: every action in the column for where it stands, left
          // to right. The draft's actions wait, dashed, in the first.
          <div className="flex gap-3 overflow-x-auto pb-2">
            {FLOW_COLUMNS.map((column) => {
              const waiting = column === 'waiting';
              const items = chain[column];
              return (
                <section key={column} aria-label={t(FLOW_COLUMN_LABEL[column])}
                  className={cn('flex w-[272px] shrink-0 flex-col rounded-lg border', waiting ? '' : 'border-transparent bg-muted/40')}
                  style={waiting ? { borderColor: 'color-mix(in srgb, var(--status-warning) 45%, transparent)', background: 'color-mix(in srgb, var(--status-warning) 8%, transparent)' } : undefined}>
                  <header className="flex items-center gap-2 px-3 pb-2 pt-2.5 text-[12px] font-medium">
                    <span className={waiting ? '' : 'text-foreground'} style={waiting ? { color: 'var(--status-warning)' } : undefined}>{t(FLOW_COLUMN_LABEL[column])}</span>
                    <span className="tabular-nums text-muted-foreground">{items.length}</span>
                  </header>
                  <div className="flex flex-col gap-2 px-2 pb-2">
                    {items.length === 0 ? (
                      <p className="px-1 py-2 text-[12px] text-muted-foreground">{t('No Elements')}</p>
                    ) : items.map(({ element: e, object: o }) => (
                      <div key={e.key} className="min-w-0">
                        <p className="mb-1 flex items-center gap-1 truncate px-0.5 text-[11px] text-muted-foreground">
                          <ItemIcon icon={o.icon ?? null} color={o.color ?? null} size={11} fallback={<ObjectIcon size={11} />} />
                          <span className="truncate">{o.name}</span>
                          {o.draft && <span className="shrink-0">· {t('new')}</span>}
                        </p>
                        {cardFor(e)}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </PageSection>
  );
}

/** Which of the Strategy's files the draft was made from, and how each was read. */
function PlannerSources({ sources }: { sources: PlannerSource[] }) {
  const { t } = useI18n();
  if (sources.length === 0) return <p className="text-[12px] text-muted-foreground">{t('No files are attached to this Strategy; the draft is made from what is recorded.')}</p>;
  const read = sources.filter((x) => x.mode !== 'unread');
  const unread = sources.filter((x) => x.mode === 'unread');
  const readLine = (x: PlannerSource) => x.chars === 0
    ? t(x.mode === 'digest' ? '{name} (all of it in parts)' : '{name} (whole)', { name: x.name })
    : t(x.mode === 'digest' ? '{name} ({n} characters, all of it in parts)' : '{name} ({n} characters, whole)', { name: x.name, n: x.chars.toLocaleString() });
  return (
    <div className="space-y-0.5 text-[12px]">
      {read.length > 0 && <p className="text-muted-foreground">{t('Files read: {list}', { list: read.map(readLine).join(' / ') })}</p>}
      {unread.length > 0 && (
        <p className="text-[var(--status-warning)]">
          {t('Not read: {list}', { list: unread.map((x) => t('{name} ({reason})', { name: x.name, reason: x.reason ?? '' })).join(' / ') })}
        </p>
      )}
    </div>
  );
}
