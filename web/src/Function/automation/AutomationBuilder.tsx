'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { ChevronLeft } from '@/ui/icons';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { Switch } from '@/Function/settings/SettingsControls';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { formatError } from '@/Function/shared/formatError';
import { formatRelative } from '@/Function/shared/dateUtils';
import { NavAutomationIcon } from '@/Frame/sidebar/NavIcons';
import { SETTINGS_ISLAND } from '@/shared/designTokens';
import { CopyField } from '@/AIP/connectors/CopyField';
import { describeCron, nextCronRun, parseCron } from '@/AIP/automation/cron';
import { parseDefinition, type SectionKey } from '@/AIP/harness/harnessDefinition';
import { DefinitionFlow } from '@/AIP/harness/DefinitionFlow';
import { Textarea } from '@/ui/textarea';
import {
  builderUpdateBindingOf, createBuilderDraft, reviseDraftBody, revisePromotionDraftBody,
  usePromotionDrafts,
} from '@/AIP/harness/promotionData';
import { PromotionReviewDialogForDraft } from '@/AIP/harness/PromotionDrafts';
import type { Definition } from '@/hooks/definitionData';
import type { PromotionDraft } from '@/types/database';
import {
  deleteAutomation, issueWebhookToken, runAutomationNow, runWaitingOnApproval, setAutomationEnabled,
  updateAutomation, updateAutomationBinding,
  useAutomationEvents, webhookUrl, type Automation, type AutomationBindingInput, type AutomationKind,
} from '@/hooks/automationData';
import { ApprovalDecisionCard } from '@/Function/shared/ApprovalDecisionCard';
import { deleteFlowStep, editFlowStepLine, flowStepTitles, moveFlowStep } from '@/Function/shared/flowEdit';
import {
  SECTION_HEADINGS, addSectionBullet, removeSectionBullet, replaceOutputFence, replaceSectionBullet, sectionBullets,
} from '@/Function/shared/flowEditSection';
import { workflowFromGraph, type WorkflowGraph } from '@/Function/shared/workflowGraph';
import {
  AUTOMATION_CRON_PRESETS, automationStatusOf, bindingInputOf, inputBlocksOf, outputBlocksOf, workflowGraphOf,
  type InputBlock, type OutputBlock,
} from '@/Function/shared/automationZones';
import { WorkflowCanvas } from './WorkflowCanvas';
import { ViewTabs } from '@/Function/shared/ViewTabs';
import { decideAgentActionById, usePendingAgentAction } from '@/AIP/ai/agentData';
import { useIsSpaceOwner } from '@/AIP/connectors/data';

// The Automation builder shell (Automation builder design §4.2, PR1):
// one automation open as Input → Athena → Output. The side zones are
// projections of the row and the steps (automationZones); the middle
// zone IS the automation's own canvas from the 837 piece
// (WorkflowCanvas over workflowGraph, whose edits write the workflow
// text exactly as the Flow tab did before), with the harness's
// DefinitionFlow beside it when the automation still follows a harness.
// Everything the old inline detail held lives here: the enable switch,
// Run now, the webhook token, the target Object, the recent starts with
// their approvals, and Delete — in the header, the Output zone and
// below the zones, as the design's layout names them.
//
// PR2 makes the row-owned facts editable in place: the trigger (kind,
// cron, timezone) in the Input zone and the target Object in the
// Output zone write the automations row through
// `updateAutomationBinding` — the one binding seam — and the enable
// switch in the header writes through `setAutomationEnabled`, as it
// always has.
//
// PR4 adds body editing, on drafts only (design §5.2/§5.4, decision
// D3): Edit opens (or creates) a promotion update draft against the
// automation's definition — trigger-less binding, so activation
// updates the definition in place and creates no second automation —
// and every zone edit lands in ONE working body held here, through
// the byte-preserving section editor (flowEditSection) for section
// bullets and the output fence, and flowEdit's step ops on the
// canvas. Save is the guarded revision write for the draft's stage
// (reviseDraftBody while drafting, revisePromotionDraftBody from
// review), which clears the tested record; Publish opens the
// standing promotion review on the draft. The builder never saves a
// body directly — there is no direct-save call in this file.

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

const DRAFT_OPEN_STATUSES = ['drafting', 'awaiting_input', 'rehearsing', 'awaiting_review'];

export function AutomationBuilder({ a, spaceId, harnesses, objects, sources, token, onToken, onBack, onChanged, onDeleted, onOpenElement, sharedDefinitionNames = [] }: {
  a: Automation;
  spaceId: string | null;
  harnesses: { id: string; name: string; body: string; enabled: boolean }[];
  objects: { id: string; name: string }[];
  /** Names of other automations bound to the same harness: an update
   *  draft is definition-scoped, so editing this body reaches them
   *  too — surfaced at the Edit entry, never hidden (design §11). */
  sharedDefinitionNames?: string[];
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

  // The draft this builder is editing, and its one working body
  // (design §5.2): zone edits, canvas step edits and the text tab are
  // views/writers of this body, keyed to the draft and live only
  // while the draft is open — the P4 state pattern. The live harness
  // body is never the working body; it is what the draft was seeded
  // from and what keeps firing until activation.
  const isOwner = useIsSpaceOwner(spaceId) === true;
  const drafts = usePromotionDrafts(spaceId);
  const [draftId, setDraftId] = useState<string | null>(null);
  const draft: PromotionDraft | null = draftId ? drafts.data.find((d) => d.id === draftId) ?? null : null;
  const [editState, setEditState] = useState<{ draftId: string; body: string } | null>(null);
  const workingBody = draft
    ? (editState && editState.draftId === draft.id ? editState.body : draft.body ?? null)
    : null;
  const dirty = !!draft && workingBody !== null && workingBody !== (draft.body ?? null);
  const [publishId, setPublishId] = useState<string | null>(null);

  // The steps Athena follows, in the order the run reads them: the
  // drawing's own order, or the harness's procedure when the drawing
  // is still empty.
  const steps = useMemo(() => {
    const fromGraph = flowStepTitles(workflowFromGraph(graph));
    return fromGraph.length > 0 || !harness ? fromGraph : flowStepTitles(workingBody ?? harness.body ?? '');
  }, [graph, harness, workingBody]);
  const parsed = useMemo(
    () => (harness ? parseDefinition(workingBody ?? harness.body ?? '') : null),
    [harness, workingBody],
  );
  const inputs = useMemo(() => inputBlocksOf(a, steps, parsed), [a, steps, parsed]);
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

  // ── Draft editing (PR4): the working body and its two writes ─────
  const applyBodyEdit = (next: string | null) => {
    if (!draft || next === null) return;
    // Edited back to the draft's text exactly: no revision is owed.
    setEditState(next === (draft.body ?? null) ? null : { draftId: draft.id, body: next });
  };
  const flowEdit = draft && workingBody !== null ? {
    onEditStepLine: (index: number, text: string) => applyBodyEdit(editFlowStepLine(workingBody, index, text)),
    onMoveStep: (index: number, dir: -1 | 1) => applyBodyEdit(moveFlowStep(workingBody, index, dir)),
    onDeleteStep: (index: number) => applyBodyEdit(deleteFlowStep(workingBody, index)),
  } : undefined;
  const openDraftEditor = () => void act(async () => {
    if (!harness || !spaceId) return;
    const existing = drafts.data.find(
      (d) => d.target_definition_id === harness.id && DRAFT_OPEN_STATUSES.includes(d.status),
    );
    const d = existing ?? await createBuilderDraft(spaceId, {
      targetDefinitionId: harness.id,
      seedName: harness.name,
      seedBody: harness.body ?? '',
      binding: builderUpdateBindingOf({
        objectId: a.object_id, titleTemplate: a.title_template, descriptionTemplate: a.description_template,
      }),
    });
    setDraftId(d.id);
    setEditState(null);
    await drafts.refetch();
  });
  const saveDraftEdits = () => void act(async () => {
    if (!draft || workingBody === null) return;
    if (draft.status === 'awaiting_review') await revisePromotionDraftBody(draft, workingBody);
    else if (draft.status === 'drafting') await reviseDraftBody(draft, workingBody);
    else throw new Error(t('This draft is no longer at a stage where the builder can edit it.'));
    setEditState(null);
    await drafts.refetch();
  }, t('Edits saved to the draft.'));

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
          <span className="flex items-center gap-1.5 px-1 text-[12px] text-muted-foreground">
            {t('Enabled')}
            <Switch label={t('Enabled')} value={a.enabled} disabled={busy}
              onChange={(v) => void act(() => setAutomationEnabled(a, v))} />
          </span>
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
                  <TriggerEditor key={`${a.kind}|${a.cron ?? ''}|${a.timezone}`} a={a} busy={busy}
                    onSave={(input) => void act(() => updateAutomationBinding(a.id, input))}>
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
                  </TriggerEditor>
                ) : (
                  <p className="mt-0.5 line-clamp-3 text-[12px] text-muted-foreground" title={b.detail}>{b.detail}</p>
                )}
              </li>
            ))}
          </ul>
          {draft && workingBody !== null && (
            <div className="mt-3 border-t border-border/50 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground"># {SECTION_HEADINGS.input}</p>
              <SectionBulletsEditor body={workingBody} section="input" busy={busy} onEdit={applyBodyEdit} />
            </div>
          )}
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
                  {draft ? (
                    <div className="mb-2 space-y-1.5">
                      <p className="text-[12px] text-muted-foreground">
                        {t('Editing a draft of this harness — the live automation keeps running on the current body until the draft is reviewed and activated.')}
                      </p>
                      {sharedDefinitionNames.length > 0 && (
                        <p className="text-[11px] text-[var(--status-warning)]">
                          {t('This harness is also used by {names}.', { names: sharedDefinitionNames.join(', ') })}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button size="xs" variant="primary" disabled={busy || !dirty} onClick={saveDraftEdits}>{t('Save edits')}</Button>
                        {dirty && <Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditState(null)}>{t('Discard edits')}</Button>}
                        <Button size="xs" variant="secondary" disabled={busy} onClick={() => setPublishId(draft.id)}>{t('Review')}</Button>
                      </div>
                    </div>
                  ) : isOwner ? (
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Button size="xs" variant="secondary" disabled={busy} onClick={openDraftEditor}>{t('Edit the harness')}</Button>
                      {sharedDefinitionNames.length > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                          {t('This harness is also used by {names}.', { names: sharedDefinitionNames.join(', ') })}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="mb-2 text-[11px] text-muted-foreground">{t('Only a Space owner can edit this harness.')}</p>
                  )}
                  <DefinitionFlow body={workingBody ?? harness.body ?? ''}
                    context={{
                      trigger: a.kind === 'schedule' ? { kind: 'schedule', cron: a.cron ?? '', timezone: a.timezone } : { kind: 'webhook' },
                      objectName,
                    }}
                    edit={flowEdit} />
                </div>
              )}
            </div>
          ) : (
            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap pt-3 text-[12px] leading-relaxed text-foreground">
              {(workingBody ?? harness?.body ?? '').trim() || workflowFromGraph(graph)}
            </pre>
          )}
          {draft && workingBody !== null && (
            <div className="space-y-3 pt-3">
              {(['connectors', 'checks', 'stop'] as SectionKey[]).map((section) => (
                <div key={section}>
                  <p className="text-[11px] font-medium text-muted-foreground"># {SECTION_HEADINGS[section]}</p>
                  <SectionBulletsEditor body={workingBody} section={section} busy={busy} onEdit={applyBodyEdit} />
                </div>
              ))}
            </div>
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
                      onChange={(v) => void act(() => updateAutomationBinding(a.id, { ...bindingInputOf(a), objectId: v }))}
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
          {draft && workingBody !== null && parsed?.output && (
            <div className="mt-3 border-t border-border/50 pt-2">
              <p className="text-[11px] font-medium text-muted-foreground"># {SECTION_HEADINGS.output}</p>
              <OutputFenceEditor key={`${draft.id}:${parsed.output.body}`} body={workingBody}
                format={parsed.output.format} initial={parsed.output.body} busy={busy} onEdit={applyBodyEdit} />
            </div>
          )}
        </section>
      </div>

      <div className="px-6 pb-6">
        <RecentStarts automationId={a.id} spaceId={spaceId} onOpenElement={onOpenElement} />
      </div>

      {publishId && (
        <PromotionReviewDialogForDraft draftId={publishId} spaceId={spaceId}
          definitions={harnesses as unknown as Definition[]}
          onClose={() => setPublishId(null)}
          onChanged={() => { void drafts.refetch(); onChanged(); }} />
      )}
    </div>
  );
}

/**
 * One bullet section of the working body, as a list editor (PR4):
 * each row is one bullet of the section — rewrite its line, or
 * remove its block — and the field under the list appends one. Every
 * act is a flowEditSection op on the working body, so an edit here
 * touches exactly this section and nothing else; the section is
 * named by its own heading in the body, because that heading is
 * what the edit writes under.
 */
function SectionBulletsEditor({ body, section, busy, onEdit }: {
  body: string;
  section: SectionKey;
  busy: boolean;
  onEdit: (next: string | null) => void;
}) {
  const { t } = useI18n();
  const bullets = sectionBullets(body, section);
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  return (
    <div className="mt-1.5 space-y-1">
      {bullets.map((b, i) => (
        <div key={i} className="flex items-center gap-1">
          {editing && editing.index === i ? (
            <>
              <Input value={editing.text} onChange={(e) => setEditing({ index: i, text: e.target.value })}
                aria-label={t('Edit')} className="min-w-0 flex-1" disabled={busy} />
              <Button size="xs" variant="primary" disabled={busy || !editing.text.trim()}
                onClick={() => { onEdit(replaceSectionBullet(body, section, i, editing.text)); setEditing(null); }}>{t('Save')}</Button>
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>{t('Cancel')}</Button>
            </>
          ) : (
            <>
              <button type="button" className="min-w-0 flex-1 truncate text-left text-[12px] text-muted-foreground hover:text-foreground"
                title={b} disabled={busy} onClick={() => setEditing({ index: i, text: b })}>{b}</button>
              <Button size="xs" variant="ghost" disabled={busy}
                onClick={() => onEdit(removeSectionBullet(body, section, i))}>{t('Delete')}</Button>
            </>
          )}
        </div>
      ))}
      <div className="flex gap-1">
        <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t('Add a line')}
          aria-label={t('Add a line')} className="min-w-0 flex-1" disabled={busy} />
        <Button size="xs" variant="secondary" disabled={busy || !adding.trim()}
          onClick={() => { onEdit(addSectionBullet(body, section, adding)); setAdding(''); }}>{t('Add')}</Button>
      </div>
    </div>
  );
}

/**
 * The output section's fence editor (PR4): the artifact shape as
 * text, applied as one span swap (replaceOutputFence) into the
 * working body — the fence is replaced where it stands, and the
 * rest of the body keeps its bytes.
 */
function OutputFenceEditor({ body, format, initial, busy, onEdit }: {
  body: string;
  format: string;
  initial: string;
  busy: boolean;
  onEdit: (next: string | null) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const changed = text.trim() !== initial.trim();
  return (
    <div className="mt-1.5 space-y-1.5">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
        aria-label={t('Output shape')} className="font-mono text-[12px]" disabled={busy} />
      <div className="flex justify-end">
        <Button size="xs" variant="primary" disabled={busy || !changed || !text.trim()}
          onClick={() => onEdit(replaceOutputFence(body, text, format))}>{t('Save')}</Button>
      </div>
    </div>
  );
}

function cronProblem(cron: string): string | null {
  try { parseCron(cron); return null; } catch (e) { return formatError(e); }
}

/**
 * The Input zone's trigger block as an editor (PR2): the kind picker
 * the new-automation form uses, the shared cron presets plus a free
 * cron field read by `cron.ts`, and a timezone picker over the IANA
 * zones the platform knows. The draft is local until Save, which
 * writes the whole binding — this trigger over the row's current
 * Object and templates — through `updateAutomationBinding`, so the
 * edit lands on the row at once and `next_run_at` is recomputed
 * there. "Run now" stays what it is: the manual start in the header,
 * never a stored kind. The webhook token block arrives as children
 * and shows only once the row itself is a webhook — a draft that
 * switches kinds shows it after the switch is saved.
 */
function TriggerEditor({ a, busy, onSave, children }: {
  a: Automation;
  busy: boolean;
  onSave: (input: AutomationBindingInput) => void;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<AutomationKind>(a.kind);
  const [cron, setCron] = useState(a.cron ?? AUTOMATION_CRON_PRESETS[0].cron);
  const [timezone, setTimezone] = useState(a.timezone);
  const timezones = useMemo(() => {
    const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return [...new Set([a.timezone, ...supported])];
  }, [a.timezone]);
  const problem = kind === 'schedule' ? cronProblem(cron) : null;
  const next = useMemo(() => {
    if (kind !== 'schedule' || problem) return null;
    try { return nextCronRun(cron, new Date(), timezone); } catch { return null; }
  }, [kind, cron, timezone, problem]);
  const dirty = kind !== a.kind
    || (kind === 'schedule' && (cron.trim() !== (a.cron ?? '') || timezone !== a.timezone));

  return (
    <div className="mt-1 space-y-2">
      <OptionMenu label={t('Starts')} value={kind} disabled={busy}
        onChange={(v) => setKind(v)}
        options={[{ value: 'schedule', label: t('At set times') }, { value: 'webhook', label: t('When an outside service posts') }]} />
      {kind === 'schedule' ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {AUTOMATION_CRON_PRESETS.map((p) => (
              <Button key={p.cron} size="xs" shape="tab" variant={cron === p.cron ? 'secondary' : 'ghost'} disabled={busy}
                onClick={() => setCron(p.cron)}>{t(p.label)}</Button>
            ))}
          </div>
          <Input value={cron} onChange={(e) => setCron(e.target.value)} aria-label={t('Cron expression')} className="font-mono" disabled={busy} />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">{t('Timezone')}</span>
            <OptionMenu label={t('Timezone')} value={timezone} disabled={busy} onChange={setTimezone}
              options={timezones.map((z) => ({ value: z, label: z }))} />
          </div>
          <p className={`text-[12px] ${problem ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>
            {problem ?? (next ? t('{when} — next {at} ({zone})', { when: describeCron(cron), at: next.toLocaleString(), zone: timezone }) : t('This never runs.'))}
          </p>
        </div>
      ) : a.kind === 'webhook' ? children : null}
      {dirty && (
        <div className="flex justify-end">
          <Button size="xs" variant="primary" disabled={busy || !!problem}
            onClick={() => onSave({ ...bindingInputOf(a), kind, cron: kind === 'schedule' ? cron : null, timezone })}>
            {t('Save changes')}
          </Button>
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
