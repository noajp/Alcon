'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/ui/button';
import { ChevronLeft } from '@/ui/icons';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { formatError } from '@/Function/shared/formatError';
import { formatRelative } from '@/Function/shared/dateUtils';
import { NavAutomationIcon } from '@/Frame/sidebar/NavIcons';
import { SETTINGS_ISLAND } from '@/shared/designTokens';
import { CopyField } from '@/AIP/connectors/CopyField';
import { describeCron } from '@/AIP/automation/cron';
import { parseDefinition } from '@/AIP/harness/harnessDefinition';
import { DefinitionFlow } from '@/AIP/harness/DefinitionFlow';
import {
  deleteAutomation, issueWebhookToken, runAutomationNow, runWaitingOnApproval, setAutomationEnabled, updateAutomation,
  useAutomationEvents, webhookUrl, type Automation,
} from '@/hooks/automationData';
import { ApprovalDecisionCard } from '@/Function/shared/ApprovalDecisionCard';
import { flowStepTitles } from '@/Function/shared/flowEdit';
import { workflowFromGraph, type WorkflowGraph } from '@/Function/shared/workflowGraph';
import {
  automationStatusOf, inputBlocksOf, outputBlocksOf, workflowGraphOf,
  type InputBlock, type OutputBlock,
} from '@/Function/shared/automationZones';
import { WorkflowCanvas } from './WorkflowCanvas';
import { ViewTabs } from '@/Function/shared/ViewTabs';
import { decideAgentActionById, usePendingAgentAction } from '@/AIP/ai/agentData';
import { useIsSpaceOwner } from '@/AIP/connectors/data';

// The Automation builder shell (Automation builder design §4.2, PR1):
// one automation open as Input → Athena → Output. The side zones are
// read-only projections of the row and the steps (automationZones) —
// they edit nothing; the middle zone IS the automation's own canvas
// from the 837 piece (WorkflowCanvas over workflowGraph, whose edits write the
// workflow text exactly as the Flow tab did before), with the harness's
// DefinitionFlow beside it when the automation still follows a harness.
// Everything the old inline detail held lives here: the enable switch,
// Run now, the webhook token, the target Object, the recent starts with
// their approvals, and Delete — in the header, the Output zone and
// below the zones, as the design's layout names them.

/** A workflow that can be picked, as the list surface computes them. */
export interface BuilderWorkflowSource { id: string; label: string; graph: WorkflowGraph }

const PICK = '__pick';
type AthenaTab = 'flow' | 'text';

const INPUT_LABEL: Record<InputBlock['kind'], string> = {
  trigger: 'Trigger', mail: 'Mail', files: 'Files', source: 'Source',
};
const OUTPUT_LABEL: Record<OutputBlock['kind'], string> = {
  target: 'Element target', artifact: 'Output shape', tickets: 'Tickets', files: 'Files',
  sends: 'Sends', 'marks-processed': 'Marks processed', strategy: 'Strategy',
};

export function AutomationBuilder({ a, spaceId, harnesses, objects, sources, token, onToken, onBack, onChanged, onDeleted, onOpenElement }: {
  a: Automation;
  spaceId: string | null;
  harnesses: { id: string; name: string; body: string; enabled: boolean }[];
  objects: { id: string; name: string }[];
  sources: BuilderWorkflowSource[];
  token: string | null;
  onToken: (value: string) => void;
  onBack: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onOpenElement?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The drawing as last saved here; `drawing` remounts the canvas when a
  // picked workflow replaces it (the 837 Flow tab's own discipline).
  const [graph, setGraph] = useState(() => workflowGraphOf(a));
  const [drawing, setDrawing] = useState(0);
  const [tab, setTab] = useState<AthenaTab>('flow');
  const harness = harnesses.find((d) => d.id === a.definition_id) ?? null;
  const objectName = objects.find((o) => o.id === a.object_id)?.name ?? null;

  // The steps Athena follows, in the order the run reads them: the
  // drawing's own order, or the harness's procedure when the drawing
  // is still empty.
  const steps = useMemo(() => {
    const fromGraph = flowStepTitles(workflowFromGraph(graph));
    return fromGraph.length > 0 || !harness ? fromGraph : flowStepTitles(harness.body ?? '');
  }, [graph, harness]);
  const parsed = useMemo(() => (harness ? parseDefinition(harness.body ?? '') : null), [harness]);
  const inputs = useMemo(() => inputBlocksOf(a, steps), [a, steps]);
  const outputs = useMemo(() => outputBlocksOf(a, parsed, steps, objectName), [a, parsed, steps, objectName]);
  const status = automationStatusOf(a);
  const trigger = a.kind === 'schedule' ? describeCron(a.cron ?? '') : t('When an outside service posts');
  const statusText = status.kind === 'off' ? t('Off')
    : status.kind === 'failed' ? t('Last start failed')
    : status.kind === 'next' ? t('Next {when}', { when: new Date(status.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })
    : status.kind === 'last' ? t('Last {when}', { when: formatRelative(status.at) }) : '';

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The builder header: back, the automation, and its verbs. */}
      <div className="flex flex-wrap items-center gap-2 px-6 pt-3">
        <button type="button" onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md px-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ChevronLeft size={14} />{t('Automations')}
        </button>
        <span className="flex min-w-0 items-center gap-2">
          <NavAutomationIcon size={16} />
          <span className="truncate text-[14px] font-medium text-foreground">{a.name}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span aria-hidden className={`size-2 rounded-full ${a.enabled ? 'bg-[var(--status-success)]' : 'bg-muted-foreground/40'}`} />
          {statusText}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="secondary" disabled={busy}
            onClick={() => void act(() => runAutomationNow(a.id), t('Started “{name}”.', { name: a.name }))}>{t('Run now')}</Button>
          <Button size="xs" variant="ghost" disabled={busy}
            onClick={() => void act(() => setAutomationEnabled(a, !a.enabled))}>{a.enabled ? t('Turn off') : t('Turn on')}</Button>
          <Button size="xs" variant="ghost" className="text-[var(--status-danger)]" disabled={busy}
            onClick={() => void act(async () => { await deleteAutomation(a.id); onDeleted(); })}>{t('Delete')}</Button>
        </span>
      </div>
      {(error || notice) && (
        <div className="px-6 pt-1">
          {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
          {notice && <p role="status" className="text-[12px] text-muted-foreground">{notice}</p>}
        </div>
      )}
      {a.last_status === 'failed' && a.last_error && <p className="px-6 pt-1 text-[12px] text-[var(--status-danger)]">{a.last_error}</p>}

      <div className="grid items-start gap-4 px-6 py-4 xl:grid-cols-[minmax(220px,280px)_minmax(0,1fr)_minmax(220px,280px)]">
        {/* ── Input: the trigger, then what a firing reads. ── */}
        <section aria-label={t('Input')} className={`${SETTINGS_ISLAND} p-3`}>
          <h4 className="mb-2 text-[12px] font-medium text-muted-foreground">{t('Input')}</h4>
          <ul className="space-y-2">
            {inputs.map((b, i) => (
              <li key={i} className="rounded-md border border-border/50 px-2.5 py-2">
                <p className="text-[12px] font-medium text-foreground">
                  {b.kind === 'source' ? b.connector : t(INPUT_LABEL[b.kind])}
                </p>
                {b.kind === 'trigger' ? (
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {b.triggerKind === 'schedule' ? `${b.detail} · ${a.timezone}` : t('When an outside service posts')}
                  </p>
                ) : (
                  <p className="mt-0.5 line-clamp-3 text-[12px] text-muted-foreground" title={b.detail}>{b.detail}</p>
                )}
                {b.kind === 'trigger' && b.triggerKind === 'webhook' && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">{t('POST JSON to this URL with the token in the x-alcon-token header. The body becomes the input of the Element it makes.')}</p>
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
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* ── Athena: the work itself — the automation's own canvas,
            and the harness's flow when it still follows one. ── */}
        <section aria-label={t('Athena')} className={`${SETTINGS_ISLAND} min-w-0 p-3`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-[12px] font-medium text-muted-foreground">{t('Athena')}</h4>
            {sources.length > 0 && tab === 'flow' && (
              <OptionMenu label={t('Choose a workflow')} value={PICK} className="text-muted-foreground"
                onChange={(v) => { const src = sources.find((x) => x.id === v); if (src) { saveGraph(src.graph); setDrawing((d) => d + 1); } }}
                options={[{ value: PICK, label: t('Choose a workflow') }, ...sources.map((x) => ({ value: x.id, label: x.label }))]} />
            )}
          </div>
          <ViewTabs tabs={[{ id: 'flow' as const, label: 'Flow diagram' }, { id: 'text' as const, label: 'Definition text' }]}
            active={tab} onSelect={setTab} label={t('Automation sections')} />
          {tab === 'flow' ? (
            <div className="pt-3">
              <WorkflowCanvas key={drawing} graph={graph} trigger={trigger} onChange={saveGraph} className="h-[480px]" />
              {harness && (
                <div className="pt-4">
                  <p className="mb-2 flex items-center gap-2 text-[12px] text-muted-foreground">
                    {t('Also follows the harness “{name}”.', { name: harness.name })}
                    <Button size="xs" variant="ghost" disabled={busy} onClick={() => void act(() => updateAutomation(a.id, { definition_id: null }))}>{t('Remove')}</Button>
                  </p>
                  <DefinitionFlow body={harness.body ?? ''}
                    context={{
                      trigger: a.kind === 'schedule' ? { kind: 'schedule', cron: a.cron ?? '', timezone: a.timezone } : { kind: 'webhook' },
                      objectName,
                    }} />
                </div>
              )}
            </div>
          ) : (
            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap pt-3 text-[12px] leading-relaxed text-foreground">
              {(harness?.body ?? '').trim() || workflowFromGraph(graph)}
            </pre>
          )}
        </section>

        {/* ── Output: where the work lands, and the effects its steps
            carry — views onto the binding and the steps, never records
            of their own. ── */}
        <section aria-label={t('Output')} className={`${SETTINGS_ISLAND} p-3`}>
          <h4 className="mb-2 text-[12px] font-medium text-muted-foreground">{t('Output')}</h4>
          <ul className="space-y-2">
            {outputs.map((b, i) => (
              <li key={i} className="rounded-md border border-border/50 px-2.5 py-2">
                <p className="text-[12px] font-medium text-foreground">{t(OUTPUT_LABEL[b.kind])}</p>
                {b.kind === 'target' ? (
                  <div className="mt-1">
                    <OptionMenu label={t('Put the work in')} value={a.object_id} disabled={busy}
                      onChange={(v) => void act(() => updateAutomation(a.id, { object_id: v }))}
                      options={objects.map((o) => ({ value: o.id, label: o.name }))} />
                  </div>
                ) : b.kind === 'artifact' ? (
                  <p className="mt-0.5 line-clamp-3 text-[12px] text-muted-foreground" title={b.detail}>
                    <span className="mr-1 rounded bg-muted/50 px-1 text-[11px]">{b.format}</span>{b.detail}
                  </p>
                ) : (
                  <>
                    <p className="mt-0.5 line-clamp-3 text-[12px] text-muted-foreground" title={b.detail}>{b.detail}</p>
                    {b.gated && <p className="mt-0.5 text-[11px] text-[var(--status-warning)]">{t('Proposes a change — a person approves')}</p>}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="px-6 pb-6">
        <RecentStarts automationId={a.id} spaceId={spaceId} onOpenElement={onOpenElement} />
      </div>
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
