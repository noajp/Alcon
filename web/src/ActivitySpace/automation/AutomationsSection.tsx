'use client';

import { formatError } from '@/Function/shared/formatError';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { formatRelative } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useObjects } from '@/Function/sync/explorerData';
import { CopyField } from '@/AIP/connectors/CopyField';
import { describeCron, parseCron, nextCronRun } from '@/AIP/automation/cron';
import { useDefinitions } from '@/hooks/definitionData';
import {
  createAutomation, deleteAutomation, issueWebhookToken, runAutomationNow, runWaitingOnApproval, setAutomationEnabled, updateAutomation,
  useAutomationEvents, useAutomations, webhookUrl, type Automation, type AutomationKind,
} from '@/hooks/automationData';
import { ApprovalDecisionCard } from '@/Function/shared/ApprovalDecisionCard';
import { workflowOf } from '@/Function/shared/flowEdit';
import { graphFromWorkflow, parseWorkflowGraph, workflowFromGraph, type WorkflowGraph } from '@/Function/shared/workflowGraph';
import { WorkflowCanvas } from './WorkflowCanvas';
import { ViewTabs } from '@/Function/shared/ViewTabs';
import { decideAgentActionById, usePendingAgentAction } from '@/AIP/ai/agentData';
import { useIsSpaceOwner } from '@/AIP/connectors/data';

// Automations: work that starts by itself, when, and where it goes. A
// schedule starts at the times its cron names; a webhook starts when an
// outside service posts to its URL. Each start makes one Element in the
// chosen Object and runs it, as the person who set it up, along the
// workflow written on the automation itself.

const PRESETS: { cron: string; label: string }[] = [
  { cron: '0 9 * * *', label: 'Every day at 9:00' },
  { cron: '0 9 * * 1-5', label: 'Weekdays at 9:00' },
  { cron: '0 * * * *', label: 'Every hour' },
  { cron: '0 9 * * 1', label: 'Mondays at 9:00' },
];
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';

/** A workflow that can be picked: a harness's procedure, or another
 *  automation's workflow. Picking copies its steps; they are this
 *  automation's from then on. */
interface WorkflowSource { id: string; label: string; graph: WorkflowGraph }

/** An automation's drawing; one not drawn yet shows its text as a line. */
function graphOf(a: Pick<Automation, 'workflow' | 'workflow_graph'>): WorkflowGraph {
  return parseWorkflowGraph(a.workflow_graph) ?? graphFromWorkflow(a.workflow ?? '');
}
const PICK = '__pick';
const NEW_WORKFLOW = '__new';

function workflowSources(
  harnesses: { id: string; name: string; body: string; enabled: boolean }[],
  automations: Automation[],
  except: string | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
): WorkflowSource[] {
  return [
    ...automations.filter((a) => a.id !== except).map((a) => ({ id: `a:${a.id}`, label: a.name, graph: graphOf(a) })),
    ...harnesses.filter((d) => d.enabled).map((d) => ({ id: `h:${d.id}`, label: t('Harness: {name}', { name: d.name }), graph: graphFromWorkflow(workflowOf(d.body ?? '')) })),
  ].filter((s) => s.graph.nodes.length > 0);
}

function cronProblem(cron: string): string | null {
  try { parseCron(cron); return null; } catch (e) { return formatError(e); }
}

/** The Automations, one row each; a row opens the automation on its own
 *  page, with its Overview and its Flow. */
export function AutomationsSection({ spaceId, creating, onCreatingChange, openId, onOpen, onOpenElement }: {
  spaceId: string | null;
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
  /** The automation open on its own page (Overview / Flow), or null for the list. */
  openId: string | null;
  onOpen: (id: string | null) => void;
  onOpenElement?: (id: string) => void;
}) {
  const { t } = useI18n();
  const automations = useAutomations(spaceId);
  const harnesses = useDefinitions(spaceId);
  const { data: explorer } = useObjects(null);
  const objects = explorer.objects;
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<{ id: string; value: string } | null>(null);

  const opened = openId ? automations.data.find((a) => a.id === openId) ?? null : null;
  if (opened) {
    return (
      <AutomationRow key={opened.id} mode="detail" a={opened} spaceId={spaceId} onOpen={() => onOpen(null)}
        harnesses={harnesses.data} objects={objects} sources={workflowSources(harnesses.data, automations.data, opened.id, t)}
        token={token?.id === opened.id ? token.value : null}
        onToken={(value) => setToken({ id: opened.id, value })}
        onChanged={automations.refetch} onDeleted={() => onOpen(null)} onOpenElement={onOpenElement} />
    );
  }

  return (
    <div>
      {error && <p role="alert" className="px-6 py-2 text-[12px] text-[var(--status-danger)]">{error}</p>}
      {creating && spaceId && (
        <div className="border-b border-border/60 px-6 py-4">
          <NewAutomation spaceId={spaceId} objects={objects} sources={workflowSources(harnesses.data, automations.data, null, t)}
            onCancel={() => onCreatingChange(false)}
            onCreated={async (a) => {
              onCreatingChange(false); onOpen(a.id); automations.refetch();
              if (a.kind === 'webhook') {
                try { setToken({ id: a.id, value: await issueWebhookToken(a.id) }); automations.refetch(); }
                catch (e) { setError(formatError(e)); }
              }
            }} />
        </div>
      )}
      {automations.loading ? (
        <p role="status" className="px-6 py-4 text-[13px] text-muted-foreground">{t('Loading…')}</p>
      ) : automations.data.length === 0 && !creating ? (
        <p className="px-6 py-4 text-[13px] text-muted-foreground">{t('No automations yet.')}</p>
      ) : (
        <ul>
          {automations.data.map((a) => (
            <AutomationRow key={a.id} mode="row" a={a} spaceId={spaceId} onOpen={() => onOpen(a.id)}
              harnesses={harnesses.data} objects={objects} sources={workflowSources(harnesses.data, automations.data, a.id, t)}
              token={token?.id === a.id ? token.value : null}
              onToken={(value) => setToken({ id: a.id, value })}
              onChanged={automations.refetch} onOpenElement={onOpenElement} />
          ))}
        </ul>
      )}
    </div>
  );
}

type DetailTab = 'overview' | 'flow';

/** An automation as a list row (`mode="row"`), or open on its own page
 *  (`mode="detail"`): an Overview of what it runs with and its starts, and
 *  its Flow — the workflow canvas. */
function AutomationRow({ mode, a, spaceId, onOpen, harnesses, objects, sources, token, onToken, onChanged, onDeleted, onOpenElement }: {
  mode: 'row' | 'detail';
  sources: WorkflowSource[];
  a: Automation;
  spaceId: string | null;
  onOpen: () => void;
  onDeleted?: () => void;
  harnesses: { id: string; name: string; body: string; enabled: boolean }[];
  objects: { id: string; name: string }[];
  token: string | null;
  onToken: (value: string) => void;
  onChanged: () => void;
  onOpenElement?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The drawing as last saved here; `drawing` remounts the canvas when a
  // picked workflow replaces it.
  const [graph, setGraph] = useState(() => graphOf(a));
  const [drawing, setDrawing] = useState(0);
  const [tab, setTab] = useState<DetailTab>('overview');
  const harness = harnesses.find((d) => d.id === a.definition_id) ?? null;
  const objectName = objects.find((o) => o.id === a.object_id)?.name ?? t('Unknown Object');
  const when = a.kind === 'schedule' ? describeCron(a.cron ?? '') : t('When an outside service posts');
  const stepCount = graph.nodes.length;

  const act = async (f: () => Promise<void>, done?: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await f(); if (done) setNotice(done); onChanged(); }
    catch (e) { setError(formatError(e)); }
    finally { setBusy(false); }
  };
  const saveGraph = (next: WorkflowGraph) => {
    setGraph(next);
    updateAutomation(a.id, { workflow_graph: next, workflow: workflowFromGraph(next) }).then(onChanged, (e) => setError(formatError(e)));
  };
  const trigger = a.kind === 'schedule' ? describeCron(a.cron ?? '') : t('When an outside service posts');

  const status = !a.enabled ? t('Off')
    : a.last_status === 'failed' ? <span className="text-[var(--status-danger)]">{t('Last start failed')}</span>
    : a.kind === 'schedule' && a.next_run_at ? t('Next {when}', { when: new Date(a.next_run_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })
    : a.last_fired_at ? t('Last {when}', { when: formatRelative(a.last_fired_at) }) : '';

  if (mode === 'row') {
    return (
      <li className="border-b border-border/50">
        <div className="group flex h-11 items-center gap-3 pl-6 pr-3 transition-colors hover:bg-muted/30">
          <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <span aria-hidden className={`size-2 shrink-0 rounded-full ${a.enabled ? 'bg-[var(--status-success)]' : 'bg-muted-foreground/40'}`} />
            <span className="min-w-[8rem] flex-1 truncate text-[13px] font-medium text-foreground">{a.name}</span>
            <span className="hidden w-44 min-w-0 shrink truncate text-[12px] text-muted-foreground md:block">{when}</span>
            <span className="hidden w-20 min-w-0 shrink truncate text-[12px] text-muted-foreground lg:block">
              {t('{n} steps', { n: stepCount })}
            </span>
            <span className="hidden w-40 min-w-0 shrink truncate text-[12px] text-muted-foreground lg:block">{objectName}</span>
            <span className="hidden w-36 min-w-0 shrink truncate text-right text-[11px] tabular-nums text-muted-foreground sm:block">{status}</span>
          </button>
          <Button size="xs" variant="ghost" disabled={busy}
            onClick={() => void act(() => setAutomationEnabled(a, !a.enabled))}>{a.enabled ? t('Turn off') : t('Turn on')}</Button>
        </div>
      </li>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewTabs tabs={[{ id: 'overview' as const, label: 'Overview' }, { id: 'flow' as const, label: 'Flow' }]} active={tab} onSelect={setTab}
        label={t('Automation sections')}
        actions={tab === 'flow' && sources.length > 0 ? (
          <OptionMenu label={t('Choose a workflow')} value={PICK} className="text-muted-foreground"
            onChange={(v) => { const src = sources.find((x) => x.id === v); if (src) { saveGraph(src.graph); setDrawing((d) => d + 1); } }}
            options={[{ value: PICK, label: t('Choose a workflow') }, ...sources.map((x) => ({ value: x.id, label: x.label }))]} />
        ) : null} />
      {(error || notice) && (
        <div className="px-6 pb-1">
          {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
          {notice && <p role="status" className="text-[12px] text-muted-foreground">{notice}</p>}
        </div>
      )}
      {tab === 'flow' ? (
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
          <WorkflowCanvas key={drawing} graph={graph} trigger={trigger} onChange={saveGraph} className="min-h-[320px] flex-1" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-4">
          <section className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <span className="flex items-center gap-2">
              <span aria-hidden className={`size-2 rounded-full ${a.enabled ? 'bg-[var(--status-success)]' : 'bg-muted-foreground/40'}`} />
              <span className="text-foreground">{a.enabled ? t('On') : t('Off')}</span>
            </span>
            <span className="text-muted-foreground">{when}</span>
            <span className="text-muted-foreground">{status}</span>
            <span className="text-muted-foreground">{t('{n} steps', { n: stepCount })}</span>
            <span className="ml-auto flex items-center gap-1">
              <Button size="xs" variant="secondary" disabled={busy}
                onClick={() => void act(() => runAutomationNow(a.id), t('Started “{name}”.', { name: a.name }))}>{t('Run now')}</Button>
              <Button size="xs" variant="ghost" disabled={busy}
                onClick={() => void act(() => setAutomationEnabled(a, !a.enabled))}>{a.enabled ? t('Turn off') : t('Turn on')}</Button>
            </span>
          </section>
          {a.last_status === 'failed' && a.last_error && <p className="text-[12px] text-[var(--status-danger)]">{a.last_error}</p>}
          {/* An automation made before workflows lived here may still name a
              harness; it keeps running under it until that is cleared. */}
          {harness && (
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              {t('Also follows the harness “{name}”.', { name: harness.name })}
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => void act(() => updateAutomation(a.id, { definition_id: null }))}>{t('Remove')}</Button>
            </p>
          )}
          <section className="max-w-sm">
            <div>
              <span className="mb-1 block text-[12px] text-muted-foreground">{t('Put the work in')}</span>
              <OptionMenu label={t('Put the work in')} value={a.object_id} disabled={busy}
                onChange={(v) => void act(() => updateAutomation(a.id, { object_id: v }))}
                options={objects.map((o) => ({ value: o.id, label: o.name }))} />
            </div>
          </section>

          {a.kind === 'webhook' && (
            <section className="max-w-2xl space-y-1.5">
              <p className="text-[12px] text-muted-foreground">{t('POST JSON to this URL with the token in the x-alcon-token header. The body becomes the input of the Element it makes.')}</p>
              <CopyField value={webhookUrl(a.id)} label={t('URL')} />
              {token ? (
                <>
                  <CopyField value={token} label={t('Token')} />
                  <p className="text-[11px] text-muted-foreground">{t('Copy the token now. It is not shown again.')}</p>
                </>
              ) : (
                <Button size="xs" variant="ghost" disabled={busy}
                  onClick={() => void act(async () => onToken(await issueWebhookToken(a.id)))}>
                  {a.has_token ? t('Replace the token') : t('Issue a token')}
                </Button>
              )}
            </section>
          )}

          <RecentStarts automationId={a.id} spaceId={spaceId} onOpenElement={onOpenElement} />
          <Button size="xs" variant="ghost" className="text-[var(--status-danger)]" disabled={busy}
            onClick={() => void act(async () => { await deleteAutomation(a.id); onDeleted?.(); })}>{t('Delete')}</Button>
        </div>
      )}
    </div>
  );
}

function RecentStarts({ automationId, spaceId, onOpenElement }: { automationId: string; spaceId: string | null; onOpenElement?: (id: string) => void }) {
  const { t } = useI18n();
  const events = useAutomationEvents(automationId);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  if (events.loading) return <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>;
  if (events.data.length === 0) return <p className="text-[12px] text-muted-foreground">{t('It has not started yet.')}</p>;
  const label: Record<string, string> = { schedule: 'On schedule', webhook: 'From outside', manual: 'Run now' };
  const latestWaiting = events.data.length > 0 && runWaitingOnApproval(events.data[0].run_status);
  return (
    <div>
      <p className="mb-1 text-[12px] font-medium text-foreground">{t('Recent starts')}</p>
      <ul className="space-y-1">
        {events.data.map((e) => (
          <li key={e.id} className="text-[12px]">
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatRelative(e.created_at)}</span>
              <span className="w-24 shrink-0 text-muted-foreground">{t(label[e.source])}</span>
              {e.status === 'failed'
                ? <span className="min-w-0 flex-1 truncate text-[var(--status-danger)]" title={e.error ?? ''}>{e.error ?? t('Failed')}</span>
                : e.element_id && onOpenElement
                  ? <button type="button" onClick={() => onOpenElement(e.element_id!)} className="min-w-0 flex-1 truncate text-left text-foreground hover:underline">{t('Open the Element')}</button>
                  : <span className="min-w-0 flex-1 text-muted-foreground">{t(e.status === 'started' ? 'Started' : 'Received')}</span>}
              {runWaitingOnApproval(e.run_status) && (e.run_id ? (
                <button type="button" aria-expanded={openRunId === e.run_id}
                  onClick={() => setOpenRunId((o) => (o === e.run_id ? null : e.run_id))}
                  className="shrink-0 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-[var(--status-warning)] hover:bg-muted/40">
                  {t('Waiting for approval')}
                </button>
              ) : (
                <span className="shrink-0 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-[var(--status-warning)]">
                  {t('Waiting for approval')}
                </span>
              ))}
            </div>
            {openRunId === e.run_id && e.run_id && (
              <WaitingApproval runId={e.run_id} spaceId={spaceId}
                onSettled={() => { setOpenRunId(null); void events.refetch(); }} />
            )}
          </li>
        ))}
      </ul>
      {latestWaiting && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          {t('The latest run stopped at an approval on its Element, as the approval mode specifies. It continues as soon as someone approves — under Free action, unattended runs go to the end.')}
        </p>
      )}
    </div>
  );
}

/**
 * A waiting run's approval, expanded in place in its start row: the
 * shared decision card for the run's pending action, decidable by the
 * run's starter exactly as in the run panel — no new decision path.
 * Settling collapses the row and re-reads the starts, whose run status
 * then says what happened next.
 */
function WaitingApproval({ runId, spaceId, onSettled }: { runId: string; spaceId: string | null; onSettled: () => void }) {
  const { t } = useI18n();
  const { action, canDecide, loading, error } = usePendingAgentAction(runId);
  const canRemember = useIsSpaceOwner(spaceId) === true;
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  if (error) return <p role="alert" className="mt-1 text-[12px] text-[var(--status-danger)]">{t('Could not read the approval.')}</p>;
  if (loading && !action) return <p className="mt-1 text-[12px] text-muted-foreground">{t('Opening…')}</p>;
  if (!action) return <p className="mt-1 text-[12px] text-muted-foreground">{t('This approval is no longer available.')}</p>;

  const decide = async (approve: boolean, opts: { note?: string; remember?: string[] }) => {
    setFailed(false);
    setWorking(true);
    try {
      await decideAgentActionById({
        runId, actionId: action.id, inputHash: action.input_hash, approve,
        note: opts.note, remember: opts.remember,
      });
      onSettled();
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="mt-1 rounded-md border border-border/60 bg-card p-2">
      <ApprovalDecisionCard action={action} surface="automation"
        canDecide={canDecide} deciding={working} canRemember={canRemember}
        onDecide={decide} />
      {failed && <p role="alert" className="px-1 pt-1 text-[12px] text-[var(--status-danger)]">{t('Could not record the decision.')}</p>}
    </div>
  );
}

function NewAutomation({ spaceId, objects, sources, onCancel, onCreated }: {
  spaceId: string;
  sources: WorkflowSource[];
  objects: { id: string; name: string }[];
  onCancel: () => void;
  onCreated: (a: Automation) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [objectId, setObjectId] = useState(objects[0]?.id ?? '');
  const [source, setSource] = useState(NEW_WORKFLOW);
  const [kind, setKind] = useState<AutomationKind>('schedule');
  const [cron, setCron] = useState(PRESETS[0].cron);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = kind === 'schedule' ? cronProblem(cron) : null;
  const next = kind === 'schedule' && !problem ? nextCronRun(cron, new Date(), TIMEZONE) : null;
  const ready = !!name.trim() && !!objectId && !problem;

  const save = async () => {
    setSaving(true); setError(null);
    try { onCreated(await createAutomation({ spaceId, name, definitionId: null, ...(() => { const g = sources.find((x) => x.id === source)?.graph; return g ? { workflow: workflowFromGraph(g), workflowGraph: g } : {}; })(), objectId, kind, cron: kind === 'schedule' ? cron : null, timezone: TIMEZONE })); }
    catch (e) { setError(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-3 rounded-md border border-[var(--border-default)] p-3">
      <label className="block">
        <span className="mb-1 block text-[12px] text-muted-foreground">{t('Name')}</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Morning inquiry digest')} autoFocus />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-[12px] text-muted-foreground">{t('Workflow')}</span>
          <OptionMenu label={t('Workflow')} value={source} onChange={setSource}
            options={[{ value: NEW_WORKFLOW, label: t('New workflow') }, ...sources.map((x) => ({ value: x.id, label: x.label }))]} />
          <p className="mt-1 text-[11px] text-muted-foreground">{t('Pick one to start from its steps, or start empty and draw it after creating it.')}</p>
        </div>
        <div>
          <span className="mb-1 block text-[12px] text-muted-foreground">{t('Put the work in')}</span>
          <OptionMenu label={t('Put the work in')} value={objectId} onChange={setObjectId}
            options={objects.map((o) => ({ value: o.id, label: o.name }))} />
          <p className="mt-1 text-[11px] text-muted-foreground">{t('Choose an Object that belongs to a Strategy, so the AI can keep records in its Tables.')}</p>
        </div>
      </div>
      <div>
        <span className="mb-1 block text-[12px] text-muted-foreground">{t('Starts')}</span>
        <OptionMenu label={t('Starts')} value={kind} onChange={(v) => setKind(v as AutomationKind)}
          options={[{ value: 'schedule', label: t('At set times') }, { value: 'webhook', label: t('When an outside service posts') }]} />
      </div>
      {kind === 'schedule' && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <Button key={p.cron} size="xs" shape="tab" variant={cron === p.cron ? 'secondary' : 'ghost'} onClick={() => setCron(p.cron)}>{t(p.label)}</Button>
            ))}
          </div>
          <Input value={cron} onChange={(e) => setCron(e.target.value)} aria-label={t('Cron expression')} className="font-mono" />
          <p className={`text-[12px] ${problem ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>
            {problem ?? (next ? t('{when} — next {at} ({zone})', { when: describeCron(cron), at: next.toLocaleString(), zone: TIMEZONE }) : t('This never runs.'))}
          </p>
        </div>
      )}
      {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>{t('Cancel')}</Button>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={!ready || saving}>{t('Create')}</Button>
      </div>
    </div>
  );
}
