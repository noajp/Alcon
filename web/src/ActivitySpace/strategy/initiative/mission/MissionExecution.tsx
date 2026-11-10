'use client';

import { formatError } from '@/Function/shared/formatError';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { ElementIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { startElementRun } from '@/AIP/ai/agentData';
import { runsInClaudeCode } from '@/Function/team/agentModel';
import { updateElement } from '@/hooks/useSupabase';
import { applyInitiativePlan, requestInitiativePlan } from '@/hooks/initiativeMissionData';
import { createIntent } from '@/hooks/strategyData';
import { type ElementWithDetails, type Worker } from '@/types/database';
import { ExecutionChain, chainStatusOf, emptyChain, type ChainStatus } from '@/ActivitySpace/execution/chain/ExecutionChain';
import { ObjectBoard } from '@/ActivitySpace/execution/chain/ObjectBoard';
import type { BoardOrientation } from '@/Function/shared/boardOrientation';
import { ChainCard, ChainLines } from '@/ActivitySpace/execution/chain/ChainCard';
import { ExecutePlanDialog, type ExecuteTarget, type ObjectExecuteTarget } from '@/ActivitySpace/execution/element/agent';
import { waitingReasonsByElement, type WaitingReason } from '@/ActivitySpace/execution/chain/waiting';
import { CARD_FLAT } from '@/shared/designTokens';
import { Chip } from '@/ActivitySpace/execution/element/board/BoardColumn';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { ActionTag } from '@/Function/shared/elementAction';
import {
  answeredQuestions, buildFleet, draftFleet, handOverLabels, latestRuns, normalizePlan, normalizeQuestions, plannerSources,
  startableTasks, UNPLACED,
  type FleetElement, type FleetObject, type FleetObjectRow, type PlanDraft, type PlannerSource, type PlanQuestion,
} from './missionModel';
import { type MissionContext } from './MissionPanels';
import { listenForPlanRequests } from './plannerRequest';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { useDefinitions, useRunRounds } from '@/hooks/definitionData';

// The Strategy's Board: its Objects in the Status columns their Elements
// put them in. While the Planner's draft is open, the board shows actions
// instead — the written ones and the draft's, dashed, in To Do until the
// person creates them.

function DraftTag() {
  const { t } = useI18n();
  return <span className="shrink-0 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{t('Draft')}</span>;
}


/** A task of the Planner's draft, drawn as the Element card it will become —
 *  dashed, and not editable until it is created. */
function DraftCard({ element, object }: { element: FleetElement; object: FleetObject }) {
  const { t } = useI18n();
  return (
    <div className={cn(CARD_FLAT, 'border-dashed px-3 py-2.5')}>
      <div className="flex items-start gap-2">
        {/* Where a written card has its Status mark: not created yet. */}
        <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 rounded-full border border-dashed border-muted-foreground/60" />
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-foreground line-clamp-2 break-words">{element.title}</p>
        {element.action && <Chip className="mt-px"><ActionTag action={element.action} /></Chip>}
        <DraftTag />
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
        <Chip title={object.name} className="max-w-full">
          <ItemIcon icon={object.icon ?? null} color={object.color ?? null} size={11} fallback={<ObjectIcon size={11} />} />
          <span className="truncate">{object.name}</span>
          {object.draft && <span className="shrink-0 text-muted-foreground/70">· {t('new')}</span>}
        </Chip>
      </div>
      <ChainLines element={element} busy={false} />
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[12px] text-muted-foreground">
        {element.assignee === 'human' ? <span className="truncate">{element.assigneeName ?? t('A person')}</span> : t('AI')}
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border">
          <ElementIcon size={11} />
        </span>
      </div>
    </div>
  );
}


export function MissionExecutionPanel({ ctx, objects, details, domains, aiWorkers, people, ensureRoot, orientation, via, onOpenObject }: {
  ctx: MissionContext;
  /** The board's orientation, from the page's tabs-row toggle. */
  orientation: BoardOrientation;
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
  /** Objects a Strategy under this one holds, by id, with that Strategy. */
  via?: ReadonlyMap<string, { id: string; name: string }>;
  /** Open one of the board's Objects. */
  onOpenObject?: (objectId: string) => void;
}) {
  const { t } = useI18n();
  const [guidance, setGuidance] = useState('');
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
  // The one Execute popup for this board (card hover-execute, PR1/PR2):
  // a card's rail names its Element, its Object chip's segment names
  // the Object, the dialog does the rest.
  const [executeTarget, setExecuteTarget] = useState<ExecuteTarget | null>(null);
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
  const latestRunRows = useMemo(() => latestRuns(ctx.mission.runs), [ctx.mission.runs]);
  // Each written Element's waiting reason — the cards' chips read it.
  const reasonMap = useMemo(() => waitingReasonsByElement(current, ctx.mission.runs), [current, ctx.mission.runs]);

  const handable = current.flatMap((o) => o.elements.filter((e) => e.handable));
  const rounds = useRunRounds(ctx.elements.map((e) => e.id));
  const definitions = useDefinitions(ctx.spaceId);

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
        definitionIds: new Set(definitions.data.filter((d) => d.enabled).map((d) => d.id)),
        workerIds: new Set(personName.keys()),
      });
      if (next.tasks.length === 0) setError(t('The Planner returned no tasks. Add guidance and try again.'));
      else setDraft(next);
    } catch (e) {
      setError(formatError(e));
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
      setError(formatError(e));
    } finally {
      setApplying(false);
    }
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
  // created yet, so it waits in the first column. Why a card waits comes
  // from the same waitingReason map its chip reads.
  const chain = useMemo(() => {
    const columns = emptyChain<{ element: FleetElement; object: FleetObject; reason: WaitingReason | null }>();
    for (const o of fleet) {
      for (const e of o.elements) {
        const written = e.elementId ? details.get(e.elementId) : undefined;
        // A written Element by its Status, as on the Board; a draft task is not created yet.
        const column: ChainStatus | null = written ? chainStatusOf(written.status) : e.draft ? 'todo' : null;
        if (!column) continue;
        const reason = e.elementId ? reasonMap.get(e.elementId) ?? null : null;
        columns[column].push({ element: e, object: o, reason });
      }
    }
    // The draft's tasks first in their column: they are what is new.
    columns.todo.sort((a, b) => Number(b.element.draft) - Number(a.element.draft));
    return columns;
  }, [fleet, details, reasonMap]);

  // The Object popup's target, built at the press from what this board
  // already reads: the Strategy's written Elements of the Object, every
  // written Element as the blocker lookup's upstreams, the mission's
  // edges and runs, and the same waiting map the cards' chips read.
  // The Domain's name is this host's to know, from its Domains list.
  const objectTargetFor = (objectId: string): ObjectExecuteTarget | null => {
    const object = objects.find((x) => x.id === objectId);
    if (!object) return null;
    return {
      id: object.id, name: object.name, icon: object.icon ?? null, color: object.color ?? null,
      domainName: object.domain_id ? domains.find((d) => d.id === object.domain_id)?.name ?? null : null,
      manifest: {
        elements: ctx.elements.filter((e) => e.object_id === objectId),
        upstreams: ctx.elements, edges: ctx.mission.edges, runs: ctx.mission.runs, waiting: reasonMap,
      },
    };
  };

  const cardFor = (e: FleetElement, o: FleetObject, reason: WaitingReason | null = null) => (
    e.elementId && details.get(e.elementId) ? (
      <ChainCard element={e} detail={details.get(e.elementId)!}
        object={{ id: o.objectId ?? undefined, name: o.name, icon: o.icon ?? null, color: o.color ?? null, isNew: o.draft, via: o.objectId ? via?.get(o.objectId)?.name : undefined }}
        busy={busy !== null && (busy === 'all' || busy === e.elementId)}
        reason={reason}
        rounds={rounds.get(e.elementId)}
        latestRun={latestRunRows.get(e.elementId) ?? null}
        onRefresh={ctx.refetch}
        onOpen={() => ctx.onOpenElement(e.elementId!)}
        onOpenElement={ctx.onOpenElement}
        onExecute={(el) => setExecuteTarget({ kind: 'element', element: el })}
        onExecuteObject={(objectId) => { const target = objectTargetFor(objectId); if (target) setExecuteTarget({ kind: 'object', object: target }); }}
        onHandOver={!draft && e.handable ? () => void handOver([e.elementId!]) : undefined} />
    ) : (
      <DraftCard element={e} object={o} />
    )
  );

  const draftTasks = draft?.tasks.length ?? 0;
  const draftNewObjects = draft?.objects.filter((o) => !o.objectId).length ?? 0;
  const unplaced = fleet.some((o) => o.key === UNPLACED);
  const domainless = draft?.objects.some((o) => !o.objectId && !o.domainId) ?? false;
  const startNow = draft ? startableTasks(draft).length : 0;
  const canApply = (!unplaced || !!placeIn) && (!domainless || !!newObjectsIn);

  return (
    // A column of its own: the controls, strip and index take their
    // height, and the chain takes what is left — the Board's arrangement
    // (a bounded board whose columns scroll inside themselves), reached
    // through the tab's h-full wrapper instead of a page that grows.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Work a person can hand to Claude Code, handed over from here.
            Breaking the Strategy down is the conversation's work — the
            Planner's requests land here as the questions and the draft
            below. */}
        {!draft && handable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="ml-auto flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void handOver(handable.map((e) => e.elementId!))} disabled={busy !== null}>
                {t('Hand {n} to Claude Code', { n: handable.length })}
              </Button>
            </span>
          </div>
        )}
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

        {/* The board: the Strategy's Objects — its own and its descendants' —
            each in the column its Elements put it in. While the Planner's
            draft is open, the board shows the draft's actions instead,
            dashed, beside the written ones, so the draft is read in place. */}
        {draft ? (
          <ExecutionChain orientation={orientation}
            className={orientation === 'horizontal' ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2' : 'flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2'}
            columns={Object.fromEntries((Object.keys(chain) as ChainStatus[]).map((c) => [c, chain[c].map(({ element: e, object: o, reason }) => ({ key: e.key, node: cardFor(e, o, reason) }))])) as Record<ChainStatus, { key: string; node: React.ReactNode }[]>} />
        ) : (
          <ObjectBoard objects={objects} elements={ctx.elements} via={via} orientation={orientation} onOpenObject={onOpenObject}
            className={orientation === 'horizontal' ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2' : 'flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2'} />
        )}
        <ExecutePlanDialog target={executeTarget} open={executeTarget !== null}
          onOpenChange={(next) => { if (!next) setExecuteTarget(null); }}
          onFinished={ctx.refetch} />
      </div>
    </div>
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
