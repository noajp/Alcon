'use client';

import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, FlaskConical, RefreshCw } from 'lucide-react';
import { Button } from '@/ui/button';
import { formatElementDate, parseDateOnly } from '@/alcon/shared/dateUtils';
import type { AlconObject } from '@/types/database';
import { compareDecisionLab, type DecisionLabInput, type DecisionLabComparison, type DecisionLabScenario } from './decisionLabModel';
import { displayIdOf } from '@/alcon/element/displayId';

type Plan = 'focus' | 'defer' | 'reassign';
const PLAN_LABEL: Record<Plan, string> = { focus: 'Focus first', defer: 'Start 7 days later', reassign: 'Change assignee' };
const dateLabel = (day: string | null) => formatElementDate(parseDateOnly(day)) ?? 'Not estimated';

export interface DecisionLabChoice {
  input: DecisionLabInput;
  comparison: DecisionLabComparison;
  scenario: DecisionLabScenario;
  label: string;
  reason: string;
}

/** The interactive reading. Data access and the existing Element editor belong to the host. */
export function DecisionLab({ input, objects, refreshing, canRecord = true, onRefresh, onOpenElement, onRecord }: {
  input: DecisionLabInput;
  objects: AlconObject[];
  refreshing: boolean;
  canRecord?: boolean;
  onRefresh: () => Promise<unknown>;
  onOpenElement: (id: string) => void;
  onRecord: (choice: DecisionLabChoice) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(() => input.elements.find((element) => input.scopeElementIds.includes(element.id) && !['done', 'cancelled', 'backlog'].includes(element.status ?? ''))?.id ?? '');
  const [plan, setPlan] = useState<Plan>('focus');
  const [workerId, setWorkerId] = useState('');
  const [search, setSearch] = useState('');
  const [workweek, setWorkweek] = useState<'weekdays' | 'everyday'>('weekdays');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const reason = reasons[selectedId] ?? '';
  const [saving, setSaving] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const writing = useRef(false);
  const scopeIds = useMemo(() => new Set(input.scopeElementIds), [input.scopeElementIds]);
  const candidates = useMemo(() => input.elements.filter((element) => scopeIds.has(element.id) && !['done', 'cancelled', 'backlog'].includes(element.status ?? '')), [input.elements, scopeIds]);
  const target = candidates.find((element) => element.id === selectedId);
  const availableWorkers = useMemo(() => input.workers.filter((worker) => worker.status !== 'inactive'), [input.workers]);
  const replacementId = availableWorkers.some((worker) => worker.id === workerId) ? workerId : availableWorkers.find((worker) => !target?.assignees?.some((assignee) => assignee.worker_id === worker.id))?.id ?? '';
  const calculationInput = useMemo(() => ({ ...input, workweek }), [input, workweek]);
  const targetId = target?.id;
  const scenarios: Record<Plan, DecisionLabScenario> = {
    focus: { focusElementId: targetId },
    defer: { deferElementId: targetId, deferDays: 7 },
    reassign: { reassignElementId: targetId, workerId: replacementId },
  };
  const comparisons = useMemo(() => ({
    focus: compareDecisionLab(calculationInput, { focusElementId: targetId }),
    defer: compareDecisionLab(calculationInput, { deferElementId: targetId, deferDays: 7 }),
    reassign: compareDecisionLab(calculationInput, { reassignElementId: targetId, workerId: replacementId }),
  }), [calculationInput, targetId, replacementId]);
  const comparison = comparisons[plan];
  const result = comparison.scenario;
  const baseline = comparison.baseline;
  const changes = comparison.changes.filter((change) => change.before.start !== change.after.start || change.before.finish !== change.after.finish || change.before.reason !== change.after.reason);
  const outside = changes.filter((change) => !change.after.inScope);
  const inside = changes.filter((change) => change.after.inScope);
  const unknown = result.elements.filter((element) => element.inScope && element.reason && !['closed', 'backlog'].includes(element.reason));
  const undated = candidates.filter((element) => !element.due_date).length;
  const query = search.trim().toLocaleLowerCase();
  const visibleCandidates = candidates.filter((element) => !query || `${element.title} ${element.display_id ?? ''}`.toLocaleLowerCase().includes(query));
  const recordKey = JSON.stringify([comparison.fingerprint, reason]);
  const saved = savedKey === recordKey;
  const resetResult = () => { setSavedKey(null); setFailure(null); };
  const cannotRecord = !canRecord || !target || (plan === 'reassign' && !replacementId) || !reason.trim() || saving || refreshing || saved;

  async function record() {
    if (cannotRecord || writing.current) return;
    writing.current = true;
    setSaving(true);
    setFailure(null);
    try {
      await onRecord({ input: calculationInput, comparison, scenario: scenarios[plan], label: PLAN_LABEL[plan], reason });
      setSavedKey(recordKey);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not record the decision. Try again.');
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }

  if (!candidates.length) return (
    <div className="space-y-2 py-2 text-sm text-muted-foreground">
      <p>Link an Object with active Elements to compare ways to deliver this Initiative.</p>
      <p className="text-xs">Start with an estimate, an assignee and a due date. Backlog and closed Elements are excluded from the plan.</p>
    </div>
  );

  if (!target) return <div className="space-y-2 py-2">
    <p role="status" className="text-sm">The selected Element is no longer active in this Initiative. Choose an Element to compare.</p>
    <select aria-label="Choose another Element" value="" onChange={(event) => { setSelectedId(event.target.value); resetResult(); }} className="h-8 w-full rounded-md border-0 bg-muted/40 px-2 text-sm focus:bg-muted/60">
      <option value="" disabled>Choose an Element…</option>
      {candidates.map((element) => <option key={element.id} value={element.id}>{element.title}</option>)}
    </select>
  </div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-medium">Protect a commitment. See what it costs.</p>
          <p className="text-xs text-muted-foreground">Compare a change against shared capacity, dependencies and other work in this Space.</p>
        </div>
        <Button variant="ghost" size="xs" disabled={refreshing || saving} onClick={() => { resetResult(); void onRefresh().catch(() => setFailure('Could not refresh the plan. Try again.')); }}>
          <RefreshCw className={refreshing ? 'size-3 animate-spin' : 'size-3'} /> Refresh
        </Button>
      </div>

      <fieldset disabled={saving} className="min-w-0 space-y-3">
        <legend className="sr-only">Choose an Element and a planning assumption</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <label htmlFor="decision-lab-search" className="text-xs text-muted-foreground">Explore an Element</label>
            <input id="decision-lab-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an Element…" className="h-8 w-full rounded-md border-0 bg-muted/40 px-2 text-sm placeholder:text-muted-foreground focus:bg-muted/60" />
            <select aria-label="Element to simulate" value={target.id} onChange={(event) => { setSelectedId(event.target.value); resetResult(); }} className="h-8 w-full rounded-md border-0 bg-muted/40 px-2 text-sm focus:bg-muted/60">
              {!visibleCandidates.some((element) => element.id === target.id) && <option value={target.id}>{target.title}</option>}
              {visibleCandidates.map((element) => <option key={element.id} value={element.id}>{displayIdOf(element) ? `${displayIdOf(element)} · ` : ''}{element.title}</option>)}
            </select>
            {query && !visibleCandidates.length && <p className="text-xs text-muted-foreground">No matches. The current selection is retained.</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="decision-lab-week" className="text-xs text-muted-foreground">Human working days</label>
            <select id="decision-lab-week" value={workweek} onChange={(event) => { setWorkweek(event.target.value as 'weekdays' | 'everyday'); resetResult(); }} className="h-8 w-full rounded-md border-0 bg-muted/40 px-2 text-sm focus:bg-muted/60">
              <option value="weekdays">Monday–Friday</option><option value="everyday">Every day</option>
            </select>
            <p className="text-xs text-muted-foreground">From {dateLabel(input.today)} · up to {dateLabel(result.horizonEnd)}. AI and robots use daily capacity.</p>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-3" aria-label="Compare plans">
          {(Object.keys(PLAN_LABEL) as Plan[]).map((option) => {
            const read = comparisons[option];
            const targetResult = read.scenario.byId[target.id];
            const cost = read.changes.filter((change) => change.elementId !== target.id && change.change === 'worsened').length;
            return <Button key={option} variant="ghost" size="sm" align="start" aria-pressed={plan === option}
              disabled={option === 'reassign' && !replacementId}
              onClick={() => { setPlan(option); resetResult(); }}
              className={`h-auto min-w-0 items-start whitespace-normal p-3 active:bg-muted ${plan === option ? 'bg-[var(--accent-subtle)] text-foreground' : 'bg-muted/30'}`}>
              <span className="min-w-0 space-y-1 text-left">
                <span className="flex items-center gap-2 text-sm font-medium">{plan === option ? <Check className="size-4" /> : <FlaskConical className="size-4" />}{PLAN_LABEL[option]}</span>
                <span className="block text-xs text-muted-foreground">Finish {dateLabel(targetResult?.finish ?? null)}</span>
                <span className={`block text-xs ${cost ? 'text-[var(--status-warning)]' : 'text-muted-foreground'}`}>{cost} other Elements finish later</span>
              </span>
            </Button>;
          })}
        </div>

        {plan === 'reassign' && <div className="space-y-1">
          <label htmlFor="decision-lab-worker" className="text-xs text-muted-foreground">Try one Worker in place of the current assignment</label>
          <select id="decision-lab-worker" value={replacementId} onChange={(event) => { setWorkerId(event.target.value); resetResult(); }} className="h-8 w-full rounded-md border-0 bg-muted/40 px-2 text-sm focus:bg-muted/60">
            {!replacementId && <option value="">No available Worker</option>}
            {availableWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Capacity is checked across their visible work. Skills and permission to take over still need your judgment.</p>
        </div>}
        {plan === 'focus' && <p className="text-xs text-muted-foreground">Reserve capacity for this Element and its prerequisites first. Existing start dates and dependencies still apply.</p>}
        {plan === 'defer' && <p className="text-xs text-muted-foreground">Move the earliest start seven calendar days later. Keep the promised due date to reveal the cost.</p>}
      </fieldset>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Current plan and proposed plan comparison</caption>
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-2 font-medium">Conditional schedule</th><th className="p-2 font-medium">Current</th><th className="p-2 font-medium">This plan</th></tr></thead>
          <tbody>
            <Metric label="Initiative finish" before={dateLabel(baseline.scope.finish)} after={dateLabel(result.scope.finish)} />
            <Metric label="Initiative · late Elements" before={baseline.scope.late} after={result.scope.late} />
            <Metric label="Other work · late Elements" before={baseline.outside.late} after={result.outside.late} />
            <Metric label="Not estimated · Initiative / other work" before={`${baseline.scope.unknown} / ${baseline.outside.unknown}`} after={`${result.scope.unknown} / ${result.outside.unknown}`} />
          </tbody>
        </table>
      </div>

      {(baseline.scope.unknown + baseline.outside.unknown > 0 || undated > 0) && <p className="text-xs text-[var(--status-warning)]">
        {baseline.scope.unknown + baseline.outside.unknown > 0 ? `${baseline.scope.unknown + baseline.outside.unknown} Elements have no calculated schedule. Dates shown assume that unknown work consumes no additional capacity. ` : ''}
        {undated > 0 ? `${undated} active Initiative Elements have no due date, so their deadline risk is not measured.` : ''}
      </p>}

      <div className="space-y-3" aria-live="polite">
        <ImpactRows label="What changes in this Initiative" changes={inside} input={input} objects={objects} onOpen={onOpenElement} />
        <ImpactRows label="Effects on other work" changes={outside} input={input} objects={objects} onOpen={onOpenElement} />
        {unknown.length > 0 && <details className="text-sm">
          <summary className="cursor-pointer rounded-md py-1 font-medium focus-visible:bg-muted">{unknown.length} Initiative Elements cannot be estimated</summary>
          <div className="mt-1 space-y-1">{unknown.map((row) => <div key={row.elementId} className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenElement(row.elementId)} className="max-w-full justify-start"><span className="truncate">{input.elements.find((element) => element.id === row.elementId)?.title}</span></Button>
            <span className="text-xs text-[var(--status-warning)]">{row.reason?.replaceAll('_', ' ')}</span>
          </div>)}</div>
        </details>}
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer rounded-md py-1 focus-visible:bg-muted">Calculation assumptions and coverage</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">{result.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
          <li>{baseline.scope.total} Initiative Elements and {baseline.outside.total} other Elements considered. {baseline.excludedBacklogCount} backlog Elements excluded.</li>
          <li>Only work you can see in this Activity Space is included. Hidden work can consume additional capacity.</li>
          <li>These are conditional dates, not a probability or proof of achieving the Initiative&apos;s success conditions.</li>
        </ul>
      </details>

      <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
        <label htmlFor="decision-lab-reason" className="text-sm font-medium">Why choose this plan?</label>
        <textarea id="decision-lab-reason" value={reason} disabled={saving || !canRecord} onChange={(event) => { setReasons((previous) => ({ ...previous, [selectedId]: event.target.value })); resetResult(); }} rows={2} maxLength={4000} placeholder="The commitment to protect, and the tradeoff you accept…" className="w-full resize-y rounded-md border-0 bg-muted/40 p-2 text-sm placeholder:text-muted-foreground focus:bg-muted/60" />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" disabled={cannotRecord} onClick={() => void record()}>{saving ? 'Recording…' : saved ? 'Decision recorded' : 'Record decision'}</Button>
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => onOpenElement(target.id)}>Open Element <ArrowRight className="size-3" /></Button>
        </div>
        <p className="text-xs text-muted-foreground">Saves the reason, tradeoffs and calculation in Decisions. Open the Element to put the plan into action.</p>
        {!canRecord && <p className="text-xs text-muted-foreground">You can compare plans. Only the Initiative owner can record decisions.</p>}
        {saved && <p role="status" className="text-xs text-[var(--status-success)]">Recorded in this Initiative&apos;s Decisions. Live dates and assignees are unchanged.</p>}
        {failure && <p role="alert" className="text-sm text-[var(--status-danger)]">{failure}</p>}
      </div>
    </div>
  );
}

function Metric({ label, before, after }: { label: string; before: string | number; after: string | number }) {
  return <tr className="border-b border-[var(--border-subtle)]"><th className="p-2 font-normal">{label}</th><td className="p-2 tabular-nums text-muted-foreground">{before}</td><td className="p-2 tabular-nums font-medium">{after}</td></tr>;
}

function ImpactRows({ label, changes, input, objects, onOpen }: {
  label: string;
  changes: DecisionLabComparison['changes'];
  input: DecisionLabInput;
  objects: AlconObject[];
  onOpen: (id: string) => void;
}) {
  return <div className="space-y-1">
    <p className="text-xs font-medium text-muted-foreground">{label}</p>
    {!changes.length ? <p className="py-1 text-sm text-muted-foreground">No calculated finish dates change.</p> : <div className="max-h-64 overflow-y-auto">
      {changes.map((change) => {
        const element = input.elements.find((item) => item.id === change.elementId);
        const object = objects.find((item) => item.id === element?.object_id || element?.objectIds?.includes(item.id));
        return <div key={change.elementId} className="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border-subtle)] py-2">
          <Button variant="ghost" size="sm" align="start" className="h-auto min-w-0 max-w-full flex-1 justify-start whitespace-normal py-1" onClick={() => onOpen(change.elementId)}>
            <span className="min-w-0 text-left"><span className="block break-words">{element?.title ?? 'Element unavailable'}</span><span className="block text-xs text-muted-foreground">{object?.name ?? 'Element'}{change.newlyLate ? ' · Newly late' : change.recovered ? ' · Due date recovered' : ''}</span></span>
          </Button>
          <span className={`shrink-0 px-2 text-xs tabular-nums ${change.change === 'worsened' ? 'text-[var(--status-warning)]' : change.change === 'improved' ? 'text-[var(--status-success)]' : 'text-muted-foreground'}`}>{dateLabel(change.before.finish)} → {dateLabel(change.after.finish)}</span>
        </div>;
      })}
    </div>}
  </div>;
}
