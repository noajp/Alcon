'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Clock, Flag, Hand, Pause } from '@/ui/icons';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { ElementIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { PageSection } from '@/Function/shared/PageHead';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { advanceFromElement, startElementRun } from '@/Function/copilot/agentData';
import { runsInClaudeCode } from '@/Function/team/agentModel';
import { updateElement } from '@/hooks/useSupabase';
import { applyInitiativePlan, requestInitiativePlan } from '@/hooks/initiativeMissionData';
import { createIntent } from '@/hooks/strategyData';
import type { ElementWithDetails, StrategyDelegation, Worker } from '@/types/database';
import { ElementCard } from '@/ActivitySpace/execution/element/board/ElementCard';
import { StatusPicker } from '@/Function/shared/StatusPicker';
import {
  answeredQuestions, buildFleet, draftFleet, handOverLabels, missionSummary, moveDraftTask, normalizePlan, normalizeQuestions,
  startableTasks, UNPLACED, yourTurn,
  type ActionState, type FleetElement, type FleetObject, type FleetObjectRow, type PlanDraft, type PlanQuestion,
} from './missionModel';
import { STATE_LABEL, Stat, compact, stateColor, type MissionContext } from './MissionPanels';
import { YourTurnTray } from './YourTurnTray';
import { DefinitionPanel } from './DefinitionPanel';
import { setElementDefinition, useDefinitions, useRunRounds, type Definition, type RoundSummary } from '@/hooks/definitionData';

// The Execution tab's mission: the Strategy's Objects in one column and the
// Elements of the chosen Object in the next, joined by lines from the chosen
// Object, each card saying where it stands, who carries it out, its status
// and due date, what it delivers and what it waits on. The Planner's draft is
// laid over the same columns — the Objects and Elements it would add drawn
// dashed — so the person reads how the Strategy breaks down, moves an
// Element to another Object by dragging its card onto that Object, approves
// the draft, and starts the work here.

/** The card ground, as the Board's Element cards draw it. */
const CARD = 'rounded-lg border border-[var(--border-subtle)] bg-card dark:bg-muted shadow-[var(--shadow-island)]';
/** The drag payload: a card's key in the Element column. */
const DRAG_TYPE = 'application/x-alcon-mission-element';
/** What a written Element card carries when dragged (ElementCard). */
const ELEMENT_DRAG_TYPE = 'text/id';

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

function DraftTag() {
  const { t } = useI18n();
  return <span className="shrink-0 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{t('Draft')}</span>;
}

function ObjectCard({ object, domainName, selected, dropTarget, onSelect, onDragOver, onDragLeave, onDrop }: {
  object: FleetObject;
  domainName: string | null;
  selected: boolean;
  /** An Element card is being dragged over it and may land here. */
  dropTarget: boolean;
  onSelect: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const { t } = useI18n();
  const { tally } = object;
  const unplaced = object.key === UNPLACED;
  const footer = tally.total === 0 ? t('No Elements')
    : tally.done === tally.total ? t('All {n} done', { n: tally.total })
    : tally.stopped > 0 ? t('{n} stopped', { n: tally.stopped })
    : tally.running > 0 ? t('{n}/{all} running', { n: tally.running, all: tally.total })
    : t('{done}/{all} done', { done: tally.done, all: tally.total });
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      className={cn(
        CARD, 'relative block w-full px-3.5 py-3 text-left transition-[opacity,box-shadow]',
        object.draft && 'border-dashed border-border',
        selected ? 'opacity-100' : 'opacity-55 hover:opacity-90',
        dropTarget && 'opacity-100 ring-2 ring-[var(--accent-default)]',
      )}>
      <div className="flex items-start gap-2.5">
        <ObjectIcon size={14} className="mt-[3px] shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold leading-5 text-foreground">
            {unplaced ? t('Not placed in an Object') : object.name}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {unplaced ? t('Drag each card onto an Object, or choose one above') : domainName ?? t('No Domain')}
          </div>
        </div>
        {object.draft ? <DraftTag /> : <StateBadge state={object.state} />}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 text-[12px] tabular-nums text-muted-foreground">
        <Clock size={12} className="shrink-0" />
        <span style={tally.stopped > 0 ? { color: 'var(--status-danger)' } : undefined}>{footer}</span>
        <span className="ml-auto text-foreground">${object.costUsd.toFixed(2)}</span>
      </div>
      {selected && (
        <span aria-hidden className="absolute -right-[5px] top-1/2 hidden h-2.5 w-2.5 -translate-y-1/2 rounded-full border-[1.5px] border-[var(--accent-default)] bg-card md:block" />
      )}
    </button>
  );
}

/** What the Execution tab adds under a card's title: what it delivers,
 *  what it waits on, the model that ran it and what that cost, and a hand-off
 *  to Claude Code. */
/** The Element's own definition, chosen on its card: its output shape and its
 *  loop are enforced for it (a Strategy's definition only directs). */
function DefinitionPick({ value, definitions, onChange }: { value: string | null; definitions: Definition[]; onChange: (id: string | null) => void }) {
  const { t } = useI18n();
  if (definitions.length === 0 && !value) return null;
  return (
    <label className="flex min-w-0 items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <span className="shrink-0">{t('Definition')}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}
        className="min-w-0 flex-1 truncate rounded border border-border/60 bg-transparent px-1 py-0.5 text-[12px] text-foreground">
        <option value="">{t('The Strategy\'s')}</option>
        {definitions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  );
}

function MissionLines({ element, busy, onHandOver, rounds, definitionPick }: { element: FleetElement; busy: boolean; onHandOver?: () => void; rounds?: RoundSummary; definitionPick?: React.ReactNode }) {
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
      {definitionPick}
      {(meta || onHandOver) && (
        <div className="flex items-center gap-2 tabular-nums">
          {meta && <span className="truncate">{meta}</span>}
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
function DraftCard({ element, draggable }: { element: FleetElement; draggable: boolean }) {
  const { t } = useI18n();
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, element.key); e.dataTransfer.effectAllowed = 'move'; }}
      className={cn(CARD, 'border-dashed border-border px-3 py-2.5', draggable && 'cursor-grab active:cursor-grabbing')}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-foreground line-clamp-3 break-words">{element.title}</p>
        <DraftTag />
      </div>
      <MissionLines element={element} busy={false} />
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[12px] text-muted-foreground">
        {element.assignee === 'human' ? t('A person') : t('AI')}
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border">
          <ElementIcon size={11} />
        </span>
      </div>
    </div>
  );
}

/** The lines from the chosen Object to each of its Element cards: out of the
 *  dot on its right edge, down a shared spine, into each card — blue to work
 *  still open, grey to work that is done, dashed to the draft's. Measured
 *  from the cards, so it follows them as they wrap and grow. */
function Connectors({ root, objectCards, fromKey, elementCards, elements }: {
  root: React.RefObject<HTMLDivElement | null>;
  objectCards: React.RefObject<Map<string, HTMLElement>>;
  fromKey: string | null;
  elementCards: React.RefObject<Map<string, HTMLElement>>;
  elements: readonly FleetElement[];
}) {
  const [drawing, setDrawing] = useState<{ paths: { d: string; open: boolean; draft: boolean }[]; w: number; h: number }>({ paths: [], w: 0, h: 0 });
  // Measured after every render (cards load, wrap, and are edited in place)
  // and whenever the columns resize; stored only when a line moved.
  const [resized, setResized] = useState(0);
  useLayoutEffect(() => {
    const box = root.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setResized((n) => n + 1));
    observer.observe(box);
    return () => observer.disconnect();
  }, [root]);
  useLayoutEffect(() => {
    const box = root.current;
    if (!box) return;
    const store = (next: typeof drawing) => {
      setDrawing((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const draw = () => {
      const from = fromKey ? objectCards.current.get(fromKey) : undefined;
      if (!from || window.matchMedia('(max-width: 767px)').matches) { store({ paths: [], w: 0, h: 0 }); return; }
      const b = box.getBoundingClientRect();
      const f = from.getBoundingClientRect();
      const sx = f.right - b.left;
      const sy = f.top + f.height / 2 - b.top;
      const next: { d: string; open: boolean; draft: boolean }[] = [];
      for (const e of elements) {
        const el = elementCards.current.get(e.key);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const ex = r.left - b.left;
        const ey = r.top + r.height / 2 - b.top;
        const spine = sx + (ex - sx) / 2;
        const dy = ey - sy;
        const radius = Math.min(10, Math.abs(dy) / 2, (ex - spine) / 2);
        const d = Math.abs(dy) < 1
          ? `M ${sx} ${sy} H ${ex}`
          : `M ${sx} ${sy} H ${spine - radius} Q ${spine} ${sy} ${spine} ${sy + Math.sign(dy) * radius}`
            + ` V ${ey - Math.sign(dy) * radius} Q ${spine} ${ey} ${spine + radius} ${ey} H ${ex}`;
        next.push({ d, open: e.state !== 'done' && e.state !== 'cancelled', draft: e.draft });
      }
      store({ paths: next, w: b.width, h: b.height });
    };
    draw();
  });
  void resized;
  if (drawing.paths.length === 0) return null;
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 hidden md:block" width={drawing.w} height={drawing.h}>
      {/* The open ones last, so they draw over the grey along the shared spine. */}
      {[...drawing.paths].sort((a, b) => Number(a.open) - Number(b.open)).map((p, i) => (
        <path key={i} d={p.d} fill="none" strokeWidth={1.5} strokeDasharray={p.draft ? '4 4' : undefined}
          stroke={p.open ? 'var(--accent-default)' : 'var(--border-default)'} opacity={p.open ? 0.75 : 1} />
      ))}
    </svg>
  );
}

export function MissionExecutionPanel({ ctx, objects, details, domains, aiWorkers, ensureRoot }: {
  ctx: MissionContext;
  /** The written Elements, by id, as the shared Element card reads them. */
  details: ReadonlyMap<string, ElementWithDetails>;
  /** The Strategy's Objects, in order. */
  objects: FleetObjectRow[];
  /** The Space's Domains — where a new Object can go. */
  domains: { id: string; name: string }[];
  aiWorkers: Worker[];
  /** The Strategy's root intent; new objectives hang under it. */
  ensureRoot: () => Promise<string>;
}) {
  const { t } = useI18n();
  const [guidance, setGuidance] = useState('');
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  // The Planner's questions, asked before it plans, and the answers typed.
  const [questions, setQuestions] = useState<{ reason: string; items: PlanQuestion[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const objectCards = useRef(new Map<string, HTMLElement>());
  const elementCards = useRef(new Map<string, HTMLElement>());
  const [aiWorkerId, setAiWorkerId] = useState('');
  const [fallbackObjectId, setFallbackObjectId] = useState('');
  const [fallbackDomainId, setFallbackDomainId] = useState('');
  const aiWorker = aiWorkerId || aiWorkers[0]?.id || '';
  const placeIn = fallbackObjectId || objects[0]?.id || '';
  const newObjectsIn = fallbackDomainId || objects.find((o) => o.domain_id)?.domain_id || domains[0]?.id || '';
  const domainName = useMemo(() => new Map(domains.map((d) => [d.id, d.name])), [domains]);

  const current = useMemo(() => buildFleet({
    objects, elements: ctx.elements, measures: ctx.measures, bindings: ctx.bindings,
    edges: ctx.mission.edges, runs: ctx.mission.runs,
  }), [objects, ctx.elements, ctx.measures, ctx.bindings, ctx.mission.edges, ctx.mission.runs]);
  const fleet = useMemo(() => (draft ? draftFleet(current, ctx.measures, draft) : current), [draft, current, ctx.measures]);
  // The column the person chose, else the first that needs a look, else the first.
  const focus = fleet.find((o) => o.key === selected)
    ?? fleet.find((o) => o.draft || o.tally.stopped > 0 || o.tally.waiting > 0)
    ?? fleet[0];

  const summary = missionSummary({ elements: ctx.elements, measures: ctx.measures, runs: ctx.mission.runs, artifacts: ctx.mission.artifacts });
  // Before the dependencies are read every AI Element would look ready.
  const ready = ctx.missionLoaded ? current.flatMap((o) => o.elements.filter((e) => e.ready)) : [];
  const handable = current.flatMap((o) => o.elements.filter((e) => e.handable));
  const rounds = useRunRounds(ctx.elements.map((e) => e.id));
  const definitions = useDefinitions(ctx.spaceId);
  const turns = useMemo(() => yourTurn({ fleet: current, elements: ctx.elements, runs: ctx.mission.runs, actions: ctx.mission.actions }),
    [current, ctx.elements, ctx.mission.runs, ctx.mission.actions]);

  const plan = async (opts: { answers?: { question: string; answer: string }[]; noQuestions?: boolean } = {}) => {
    setPlanning(true); setError(null); setNotice(null);
    try {
      const reply = await requestInitiativePlan(ctx.initiativeId, guidance, opts);
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
      });
      if (next.tasks.length === 0) setError(t('The Planner returned no tasks. Add guidance and try again.'));
      else { setDraft(next); setSelected(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  };

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
      setDraft(null); setSelected(null);
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

  // An Element card dropped on another Object card: a draft task changes
  // the Object it will be created in; a written Element moves there.
  const mayDrop = (o: FleetObject) => o.key !== focus?.key && (!!o.objectId || !!draft);
  const dragOver = (o: FleetObject) => (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (!(types.includes(DRAG_TYPE) || types.includes(ELEMENT_DRAG_TYPE)) || !mayDrop(o)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropKey !== o.key) setDropKey(o.key);
  };
  const drop = (o: FleetObject) => async (e: React.DragEvent) => {
    const key = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData(ELEMENT_DRAG_TYPE);
    setDropKey(null);
    if (!key || !mayDrop(o)) return;
    e.preventDefault();
    setError(null);
    if (key.startsWith('t:')) {
      if (!draft) return;
      setDraft(moveDraftTask(draft, key.slice(2), {
        objectId: o.objectId, name: o.name, draftKey: o.objectId || o.key === UNPLACED ? null : o.key.slice(2),
      }));
      return;
    }
    if (!o.objectId) return;
    try {
      await updateElement(key, { object_id: o.objectId });
      ctx.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  // Each card registers itself, so the lines can be measured from it.
  const track = (map: Map<string, HTMLElement>, key: string, el: HTMLElement | null) => {
    if (el) map.set(key, el); else map.delete(key);
  };

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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
          <Stat label={t('Progress')} value={`${summary.progress}%`} sub={t('{done} of {all} actions', { done: summary.done, all: summary.actions })} />
          <Stat label={t('Running')} value={String(summary.running)} />
          <Stat label={t('Waiting on a person')} value={String(summary.waiting)} />
          <Stat label={t('Blocked or failed')} value={String(summary.blocked + summary.failed)} />
          <Stat label={t('Tokens')} value={compact(summary.inputTokens + summary.outputTokens)}
            sub={t('in {input} · out {output}', { input: compact(summary.inputTokens), output: compact(summary.outputTokens) })} />
          <Stat label={t('AI cost')} value={`$${summary.costUsd.toFixed(2)}`} />
        </div>

        {ctx.missionLoaded && (
          <YourTurnTray items={turns} canEdit={ctx.canEdit} onOpen={ctx.onOpenElement} onChanged={ctx.refetch} />
        )}

        <label className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
          {t('When an AI finishes')}
          <select value={ctx.delegation} disabled={!ctx.canEdit}
            onChange={(e) => void ctx.setDelegation(e.target.value as StrategyDelegation)}
            className="rounded-md border border-border/60 bg-transparent px-1.5 py-1 text-foreground">
            <option value="manual">{t('A person reviews each result')}</option>
            <option value="auto">{t('Verified results go on to the next step')}</option>
          </select>
          <span>{ctx.delegation === 'auto'
            ? t("Stops at a person's Element, an approval or a blocked run.")
            : t('Nothing starts until you approve the result.')}</span>
        </label>

        <DefinitionPanel spaceId={ctx.spaceId} definitionId={ctx.definitionId} canEdit={ctx.canEdit} onChange={ctx.setDefinition} />

        <div className="flex items-start gap-2">
          <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} rows={2}
            placeholder={t('Guidance for the Planner (optional): scope, constraints, what to leave out…')}
            className="min-h-[52px] flex-1 resize-y rounded-md border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:bg-muted/30" />
          <Button variant={draft ? 'secondary' : 'primary'} size="sm" onClick={() => void plan()} disabled={planning || applying || !!questions}>
            {planning ? t('Planning…') : draft ? t('Plan again') : t('Break down with AI')}
          </Button>
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

        {!draft && !questions && (
          <p className="text-[12px] text-muted-foreground">
            {t('The Planner reads this Strategy and breaks it down into Objects and Elements. Nothing is created until you approve the draft.')}
          </p>
        )}

        {draft && (
          <div className="space-y-2 rounded-lg border border-dashed border-border px-3 py-2.5">
            {draft.summary && <p className="text-[13px] text-foreground">{draft.summary}</p>}
            <p className="text-[12px] text-muted-foreground">
              {t('{tasks} Elements in {objects} Objects, {fresh} of them new. Dashed cards are not created yet.', {
                tasks: draftTasks, objects: new Set(draft.tasks.map((x) => x.object).filter(Boolean)).size, fresh: draftNewObjects,
              })}
            </p>
            {ctx.canEdit ? (
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  {t('AI actions go to')}
                  <select value={aiWorker} onChange={(e) => setAiWorkerId(e.target.value)}
                    className="rounded-md border border-border/60 bg-transparent px-1.5 py-1 text-foreground">
                    <option value="">{t('Nobody (assign later)')}</option>
                    {aiWorkers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
                {unplaced && (
                  <label className="flex items-center gap-1.5 text-muted-foreground">
                    {t('Unplaced work goes to')}
                    <select value={placeIn} onChange={(e) => setFallbackObjectId(e.target.value)}
                      className="rounded-md border border-border/60 bg-transparent px-1.5 py-1 text-foreground">
                      {objects.length === 0 && <option value="">{t('No Objects yet')}</option>}
                      {objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>
                )}
                {domainless && (
                  <label className="flex items-center gap-1.5 text-muted-foreground">
                    {t('New Objects go to')}
                    <select value={newObjectsIn} onChange={(e) => setFallbackDomainId(e.target.value)}
                      className="rounded-md border border-border/60 bg-transparent px-1.5 py-1 text-foreground">
                      {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </label>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => { setDraft(null); setSelected(null); }} disabled={applying}>{t('Discard')}</Button>
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
          <p className="text-[12px] text-muted-foreground">{t('No Objects yet. Break the Strategy down with AI, or add Objects below.')}</p>
        ) : (
          <div ref={columnsRef} className="relative grid gap-3 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
            <div className="space-y-3">
              {fleet.map((o) => (
                <div key={o.key} ref={(el) => track(objectCards.current, o.key, el)}>
                  <ObjectCard object={o} selected={o.key === focus?.key} dropTarget={dropKey === o.key}
                    domainName={o.domainId ? domainName.get(o.domainId) ?? null : null}
                    onSelect={() => setSelected(o.key)}
                    onDragOver={dragOver(o)} onDragLeave={() => setDropKey(null)} onDrop={(e) => void drop(o)(e)} />
                </div>
              ))}
            </div>
            <div className="min-w-0 space-y-3">
              {focus && focus.elements.length > 0 ? focus.elements.map((e) => (
                <div key={e.key} ref={(el) => track(elementCards.current, e.key, el)}>
                  {e.elementId && details.get(e.elementId) ? (
                    <ElementCard element={details.get(e.elementId)!} onRefresh={ctx.refetch}
                      onOpen={() => ctx.onOpenElement(e.elementId!)}
                      badge={ctx.canEdit ? (
                        // The badge opens the status menu: work an agent left
                        // for review is approved (Done) right from its card.
                        <span onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => ev.stopPropagation()}>
                          <StatusPicker element={details.get(e.elementId)!}
                            onChanged={(s) => { if (s === 'done' || s === 'cancelled') void advanceFromElement(e.elementId!).then(() => ctx.refetch()); else ctx.refetch(); }}
                            trigger={<button type="button" className="cursor-pointer" aria-label={t('Change status')}><StateBadge state={e.state} /></button>} />
                        </span>
                      ) : <StateBadge state={e.state} />}
                      extra={<MissionLines element={e} rounds={rounds.get(e.elementId)} busy={busy !== null && (busy === 'all' || busy === e.elementId)}
                        definitionPick={ctx.canEdit ? (
                          <DefinitionPick value={details.get(e.elementId)?.definition_id ?? null} definitions={definitions.data}
                            onChange={(id) => void setElementDefinition(e.elementId!, id).then(() => ctx.refetch())} />
                        ) : undefined}
                        onHandOver={!draft && e.handable ? () => void handOver([e.elementId!]) : undefined} />} />
                  ) : (
                    <DraftCard element={e} draggable={ctx.canEdit} />
                  )}
                </div>
              )) : (
                <p className="px-1 py-2 text-[12px] text-muted-foreground">{t('No Elements in this Object yet.')}</p>
              )}
            </div>
            <Connectors root={columnsRef} objectCards={objectCards} fromKey={focus?.key ?? null}
              elementCards={elementCards} elements={focus?.elements ?? []} />
          </div>
        )}
      </div>
    </PageSection>
  );
}
