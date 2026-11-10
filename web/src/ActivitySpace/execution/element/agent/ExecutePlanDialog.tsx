'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import { useAgentRun } from '@/hooks/useSupabase';
import type { ElementWithDetails } from '@/types/database';
import { getActiveDomainId } from '@/Function/space/domainsStore';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useDefinitions } from '@/hooks/definitionData';
import { traceFromRunSteps } from '@/Function/shared/workTrace';
import { TraceCompletion, TraceHeadline, TraceStepList } from '@/Function/shared/workTraceView';
import { ApprovalDecisionCard } from '@/Function/shared/ApprovalDecisionCard';
import { CRITICAL_CLASS_LABELS } from '@/AIP/connectors/catalog';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { displayIdOf } from '@/Function/shared/element/displayId';
import { describeBlocker } from '@/Function/shared/element/dependencyReadiness';
import {
  objectExecuteManifest,
  type ManifestDisposition, type ObjectManifestInput,
} from '@/Function/shared/element/objectExecuteManifest';
import { startElementRun, type AgentStartOutcome } from '@/AIP/ai/agentData';
import { planCallsFromAction, planPopupState, procedureLines, type PlanPopupCall } from './planPopupState';

// The board-level plan surface (card hover-execute, PR1): a surface over
// the existing B8 plan machinery, never a second execution path. Opening
// it IS the request to plan — a plan run starts at once through
// useAgentRun (startAgentRun underneath), the rehearsal is watched live,
// the sealed plan is listed from the plan action the machinery built,
// Execute decides that action through the same decideAgentAction path
// the run panel and the Inbox use, and Dismiss cancels the undecided
// plan run so no plan rests on the Element undecided. The server is
// untouched: no new endpoint, record shape or run kind.

type Agent = ReturnType<typeof useAgentRun>;

/** One recorded call of a sealed plan: what it is, the fields the
 *  approval machinery itself chose to show, its critical mark, and the
 *  machinery's own verdict lines — the verify read-back it promises, the
 *  policy refusal that no approval can cover, the assembly problem. */
function PlanCallRow({ call, index }: { call: PlanPopupCall; index: number }) {
  const { t } = useI18n();
  return (
    <div className={cn(
      'rounded-md px-2 py-1.5',
      call.deniedNote
        ? 'border border-[var(--status-danger)]/40 bg-[var(--status-danger)]/10'
        : 'bg-muted/50',
      call.problem && !call.deniedNote && 'opacity-75',
    )}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="shrink-0 text-[12px] text-muted-foreground">{index + 1}.</span>
        <span className="text-[12.5px] font-medium text-foreground">{call.title}</span>
        <span className="text-[10.5px] text-muted-foreground">{call.integration}</span>
        {call.critical && (
          <span className="rounded border border-[var(--status-danger)]/40 px-1 py-px text-[10.5px] text-[var(--status-danger)]">
            {t('Critical · {class}', { class: t(CRITICAL_CLASS_LABELS[call.critical]) })}
          </span>
        )}
      </div>
      {call.fields.length > 0 && (
        <div className="mt-1 space-y-px">
          {call.fields.map(([label, value]) => (
            <div key={label} className="flex min-w-0 gap-1.5 text-[12px]">
              <span className="shrink-0 text-muted-foreground">{label}</span>
              <span className="min-w-0 break-words text-foreground/90">{value}</span>
            </div>
          ))}
        </div>
      )}
      {call.preview && (
        <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 text-[12px] leading-relaxed text-foreground/90">{call.preview}</pre>
      )}
      {call.expectedNote && <p className="mt-1 text-[11.5px] text-muted-foreground">{call.expectedNote}</p>}
      {call.deniedNote && <p className="mt-1 text-[11.5px] text-[var(--status-danger)]">{call.deniedNote}</p>}
      {call.problem && <p className="mt-1 text-[11.5px] text-muted-foreground">{call.problem}</p>}
    </div>
  );
}

function ExecutePlanBody({ element, domainId, onRequestClose, registerCloseAction, onFinished }: {
  element: ElementWithDetails;
  domainId?: string | null;
  /** Close the popup, running the registered close action first (an
   *  undecided plan of the viewer's own is cancelled, never left resting). */
  onRequestClose: () => Promise<void>;
  registerCloseAction: (fn: () => Promise<void>) => void;
  onFinished?: () => void;
}) {
  const { t } = useI18n();
  const agent: Agent = useAgentRun(element.id);
  const { run, pending, steps, isMine } = agent;
  const { state, readOnly } = planPopupState(run, pending, isMine);

  // The declared outline: the Element's OWN definition only (a Strategy's
  // definition is direction the engine resolves, not this Element's
  // declaration), read through the same parse the flow projection uses.
  const spaceId = useActiveSpaceId();
  const definitions = useDefinitions(spaceId);
  const outline = useMemo(() => {
    const definition = element.definition_id
      ? definitions.data.find((d) => d.id === element.definition_id && d.enabled) ?? null
      : null;
    if (!definition) return null;
    const lines = procedureLines(definition.body);
    return lines.length ? { name: definition.name, lines } : null;
  }, [definitions.data, element.definition_id]);

  // Opening the popup starts the plan run immediately (design D3): the
  // popup is a planning surface, not a confirmation of whether to plan.
  // startAgentRun itself refuses a second open run, so an Element that
  // already has one simply shows that run instead.
  const startedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (startedForRef.current === element.id) return;
    startedForRef.current = element.id;
    void agent.start({ planMode: true, triggeredFrom: 'board', domainId: domainId ?? getActiveDomainId() });
  }, [agent, element.id, domainId]);

  // What closing must do first, kept current: while the viewer's own plan
  // is undecided (still rehearsing, or resting on its plan), Dismiss —
  // and every other close path — cancels the plan run. An apply run, a
  // resting ordinary approval and another person's run are never
  // cancelled by closing a popup.
  useEffect(() => {
    registerCloseAction(async () => {
      if ((state === 'planning' || state === 'plan-ready') && run?.plan_mode && isMine) {
        await agent.cancel();
      }
    });
  }, [registerCloseAction, state, run, isMine, agent]);

  // A run that finishes while the popup is open moves the board too.
  const finishedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!run || !['completed', 'failed', 'cancelled', 'awaiting_review'].includes(run.status)) return;
    if (finishedRef.current === run.id) return;
    finishedRef.current = run.id;
    onFinished?.();
  }, [run, onFinished]);

  const trace = useMemo(
    () => traceFromRunSteps(run ? { ...run, pendingSummary: pending?.summary ?? null } : null, steps),
    [run, steps, pending],
  );
  const planCalls = useMemo(
    () => (state === 'plan-ready' && pending ? planCallsFromAction(pending) : []),
    [state, pending],
  );
  const criticalCount = planCalls.filter((c) => c.critical).length;

  const outlineBlock = outline && (state === 'planning' || state === 'plan-ready') ? (
    <div>
      <p className="text-[12px] font-medium text-foreground">{outline.name}</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[12px] leading-relaxed text-muted-foreground">
        {outline.lines.map((line, i) => <li key={i}>{line}</li>)}
      </ol>
    </div>
  ) : null;

  const traceBlock = (
    <>
      <TraceHeadline trace={trace} />
      <div className="px-1">
        <TraceStepList steps={trace.steps} foldAfter={5} fromEnd />
      </div>
    </>
  );

  return (
    <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
      {agent.error && <p className="text-[12px] text-[var(--status-danger)]">{agent.error}</p>}
      {readOnly && state !== 'plan-ready' && (
        <p className="text-[12px] text-muted-foreground">{t('This run was started by someone else. You can watch it here; deciding it is theirs.')}</p>
      )}
      {outlineBlock}

      {state === 'idle' && (
        <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
      )}

      {state === 'planning' && (
        <>
          <div>
            {traceBlock}
            <p className="mt-1 px-1 text-[12px] text-muted-foreground">
              {t('Reads are happening for real; writes are being recorded, not executed.')}
            </p>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => void onRequestClose()}>{t('Dismiss')}</Button>
          </div>
        </>
      )}

      {state === 'plan-ready' && pending && (
        <>
          <div className="space-y-2">
            {planCalls.length === 0
              ? <p className="text-[13px] text-foreground">{t('No writes were recorded.')}</p>
              : planCalls.map((call, i) => <PlanCallRow key={call.id} call={call} index={i} />)}
          </div>
          <div className="space-y-1 text-[12px] text-muted-foreground">
            <p>
              {t('{n} writes', { n: planCalls.length })}
              {criticalCount > 0 && <> · {t('{n} critical', { n: criticalCount })}</>}
            </p>
            <p>{t('Only the calls listed here, with exactly these arguments, are covered by this one approval.')}</p>
            {!outline && (
              <p>{t('This plan is what the rehearsal recorded. Anything beyond the listed calls asks on its own at apply time, as usual.')}</p>
            )}
          </div>
          {readOnly ? (
            <>
              <p className="text-[12px] text-muted-foreground">{t('Waiting for the person who started this run to approve.')}</p>
              <div className="flex items-center justify-end gap-1.5">
                <Button variant="secondary" size="sm" onClick={() => void onRequestClose()}>{t('Dismiss')}</Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-end gap-1.5">
              <Button variant="secondary" size="sm" disabled={agent.deciding} onClick={() => void onRequestClose()}>{t('Dismiss')}</Button>
              <Button variant="primary" size="sm" disabled={agent.deciding} onClick={() => void agent.decide(true)}>
                {t('Execute')}
              </Button>
            </div>
          )}
        </>
      )}

      {state === 'applying' && (
        <>
          {traceBlock}
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => void onRequestClose()}>{t('Close')}</Button>
          </div>
        </>
      )}

      {state === 'resting' && pending && (
        <>
          <ApprovalDecisionCard action={pending} surface="panel"
            canDecide={isMine} deciding={agent.deciding}
            onDecide={async (approve, opts) => { await agent.decide(approve, opts.note, opts.remember); }} />
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => void onRequestClose()}>{t('Close')}</Button>
          </div>
        </>
      )}

      {state === 'done' && (
        <>
          <div>
            {traceBlock}
            <TraceCompletion trace={trace} />
            {run?.plan_mode && (
              <p className="mt-1 px-1 text-[12px] text-muted-foreground">{t('No writes were recorded.')}</p>
            )}
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => void onRequestClose()}>{t('Close')}</Button>
          </div>
        </>
      )}
    </div>
  );
}

/** What the popup is opened on for an Object (PR2): the Object's face
 *  for the header, and the board readings the manifest is computed
 *  from — data the host's board already reads, handed over at the
 *  moment the popup opens. */
export interface ObjectExecuteTarget {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  /** The Object's quotable prefix (its display_id read through
   *  displayIdOf, or its raw prefix), where the host knows it. */
  prefixLabel?: string | null;
  /** Where the Object sits, where the host knows the Domain's name. */
  domainName?: string | null;
  manifest: ObjectManifestInput;
}

/** The popup's one target: an Element (its plan, PR1) or an Object
 *  (its manifest, PR2). */
export type ExecuteTarget =
  | { kind: 'element'; element: ElementWithDetails }
  | { kind: 'object'; object: ObjectExecuteTarget };

type Translate = ReturnType<typeof useI18n>['t'];

/** A manifest row's disposition word — the design's §6.1 words, in the
 *  chain vocabulary that already stands in the dictionary (the waiting
 *  words are the WaitingChip's own). */
function dispositionLabel(disposition: ManifestDisposition, t: Translate): string {
  switch (disposition.kind) {
    case 'done': return t('Done');
    case 'cancelled': return t('Cancelled');
    case 'running':
      if (disposition.runStatus === 'awaiting_approval') return t('Waiting: approval');
      if (disposition.runStatus === 'awaiting_input') return t('Waiting: your answer');
      if (disposition.runStatus === 'paused') return t('Paused');
      return t('Running');
    case 'blocked': {
      const first = disposition.blockers[0];
      if (!first) return t('Waiting on work');
      const word = t('Waiting on {title}', { title: describeBlocker(first) });
      return disposition.blockers.length > 1 ? `${word} +${disposition.blockers.length - 1}` : word;
    }
    case 'waiting':
      switch (disposition.waiting.kind) {
        case 'approval': return t('Waiting: approval');
        case 'answer': return t('Waiting: your answer');
        case 'review': return t('Waiting: review');
        case 'readings': return t('Accept to record {n} readings', { n: disposition.waiting.heldReadings ?? 0 });
        case 'blocked': return t('Blocked');
        case 'paused': return t('Paused');
        default: return t('Waiting on you');
      }
    case 'with-person': return t('With {name}', { name: disposition.name ?? t('A person') });
    case 'will-start': return t('Will start');
  }
}

/** What one start came back as, in the popup's words: a start is a run
 *  the board now shows; a busy is a run that opened between the
 *  manifest and the press; a failure reads plainly here, with its
 *  detail kept on its run row, never in the popup (§4.3). */
function outcomeLabel(outcome: AgentStartOutcome, t: Translate): string {
  if (outcome === 'started') return t('Running');
  if (outcome === 'busy') return t('Already running');
  return t('Could not start the run.');
}

/**
 * The Object popup (PR2): a manifest, not a plan — no plan unit exists
 * for a set and none is invented (§5.2). The rows are the pure
 * manifest's: what would start, what would not, and why. Execute is a
 * start gesture, not an approval: it runs the sequential
 * `startElementRun` loop — the MissionExecution pattern — over the
 * startable set in dependency order, and each started run then lives
 * under the full ordinary governance. Waiting Elements are not chained
 * when their blockers finish (§6.3). Closing the popup at any point
 * loses nothing: the starts are ordinary runs, tracked by the board
 * and the Inbox, not by the popup.
 */
function ObjectExecuteBody({ target, onRequestClose, registerCloseAction, onFinished }: {
  target: ObjectExecuteTarget;
  onRequestClose: () => Promise<void>;
  registerCloseAction: (fn: () => Promise<void>) => void;
  onFinished?: () => void;
}) {
  const { t } = useI18n();
  const manifest = useMemo(() => objectExecuteManifest(target.manifest), [target.manifest]);
  const [phase, setPhase] = useState<'ready' | 'starting' | 'done'>('ready');
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, AgentStartOutcome>>(new Map());

  // Closing an Object popup cancels nothing — it holds no run of its
  // own — so it clears whatever close action an Element body on this
  // same dialog instance registered before it.
  useEffect(() => { registerCloseAction(async () => {}); }, [registerCloseAction]);

  const execute = async () => {
    setPhase('starting');
    const next = new Map<string, AgentStartOutcome>();
    for (const row of manifest.startable) {
      next.set(row.element.id, await startElementRun(row.element.id));
      setOutcomes(new Map(next));
    }
    setPhase('done');
    onFinished?.();
  };

  return (
    <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
      <div className="flex min-w-0 items-center gap-2">
        <ItemIcon icon={target.icon ?? null} color={target.color ?? null} size={14} fallback={<ObjectIcon size={14} />} />
        <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{target.name}</span>
        {target.prefixLabel && <span className="shrink-0 text-[12px] text-muted-foreground">{target.prefixLabel}</span>}
        {target.domainName && <span className="ml-auto shrink-0 truncate text-[12px] text-muted-foreground">{target.domainName}</span>}
      </div>

      {manifest.rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t('This Object has no Elements yet.')}</p>
      ) : (
        <div className="space-y-1">
          {manifest.rows.map((row) => {
            const outcome = outcomes.get(row.element.id);
            const displayId = displayIdOf(row.element);
            return (
              <div key={row.element.id} className="flex min-w-0 items-baseline gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground" title={row.element.title}>
                  {row.element.title}
                </span>
                {displayId && <span className="shrink-0 text-[11px] text-muted-foreground">{displayId}</span>}
                <span className={cn(
                  'shrink-0 text-[12px]',
                  outcome === 'failed' ? 'text-[var(--status-danger)]' : 'text-muted-foreground',
                )}>
                  {outcome ? outcomeLabel(outcome, t) : dispositionLabel(row.disposition, t)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-1 text-[12px] text-muted-foreground">
        <p>{t('{n} to start · {m} skipped', { n: manifest.toStart, m: manifest.skipped })}</p>
        <p>{t('Runs that later need an approval deliver it to the Inbox, as always.')}</p>
      </div>

      {phase === 'done' ? (
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="primary" size="sm" onClick={() => void onRequestClose()}>{t('Done')}</Button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="secondary" size="sm" disabled={phase === 'starting'} onClick={() => void onRequestClose()}>{t('Dismiss')}</Button>
          <Button variant="primary" size="sm" disabled={phase === 'starting' || manifest.toStart === 0}
            onClick={() => void execute()}>
            {t('Execute')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The one Execute popup: an Element target opens its B8 plan (PR1), an
 * Object target opens its manifest (PR2). Hosts own the single mounted
 * instance and hand it the target while it is open. The `element` prop
 * is PR1's shape, kept as the element-kind shorthand.
 */
export function ExecutePlanDialog({ target, element, open, onOpenChange, domainId, onFinished }: {
  target?: ExecuteTarget | null;
  element?: ElementWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Domain the run belongs to; defaults to the active Domain. */
  domainId?: string | null;
  /** A run finishing while the popup is open refreshes the host's board. */
  onFinished?: () => void;
}) {
  const { t } = useI18n();
  const closeActionRef = useRef<(() => Promise<void>) | null>(null);
  const registerCloseAction = useCallback((fn: () => Promise<void>) => { closeActionRef.current = fn; }, []);
  const requestClose = useCallback(async () => {
    const action = closeActionRef.current;
    closeActionRef.current = null;
    if (action) {
      try { await action(); } catch { /* closing must never trap the person in the popup */ }
    }
    onOpenChange(false);
  }, [onOpenChange]);

  const effective: ExecuteTarget | null = target ?? (element ? { kind: 'element', element } : null);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) onOpenChange(true); else void requestClose(); }}>
      <DialogContent className="max-w-lg">
        {effective?.kind === 'element' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('Execution plan')}</DialogTitle>
              <DialogDescription className="truncate">{effective.element.title}</DialogDescription>
            </DialogHeader>
            {open && (
              <ExecutePlanBody key={effective.element.id} element={effective.element} domainId={domainId}
                onRequestClose={requestClose} registerCloseAction={registerCloseAction}
                onFinished={onFinished} />
            )}
          </>
        )}
        {effective?.kind === 'object' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('Execute Object')}</DialogTitle>
              <DialogDescription className="truncate">{effective.object.name}</DialogDescription>
            </DialogHeader>
            {open && (
              <ObjectExecuteBody key={effective.object.id} target={effective.object}
                onRequestClose={requestClose} registerCloseAction={registerCloseAction}
                onFinished={onFinished} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
