'use client';

import { formatError } from '@/Function/shared/formatError';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { formatRelative } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useObjects } from '@/Function/sync/explorerData';
import { describeCron, parseCron, nextCronRun } from '@/AIP/automation/cron';
import { useDefinitions } from '@/hooks/definitionData';
import {
  createAutomation, issueWebhookToken,
  useAutomations, type Automation, type AutomationKind,
} from '@/hooks/automationData';
import { workflowOf } from '@/Function/shared/flowEdit';
import { builderSeedBodyOf, createBuilderDraft } from '@/AIP/harness/promotionData';
import { PromotionReviewDialogForDraft } from '@/AIP/harness/PromotionDrafts';
import { graphFromWorkflow, workflowFromGraph, type WorkflowGraph } from '@/Function/shared/workflowGraph';
import { AUTOMATION_CRON_PRESETS, automationStatusOf, workflowGraphOf } from '@/Function/shared/automationZones';
import { NavAutomationIcon } from '@/Frame/sidebar/NavIcons';
import { AutomationBuilder } from './AutomationBuilder';

// Automations: work that starts by itself, when, and where it goes. A
// schedule starts at the times its cron names; a webhook starts when an
// outside service posts to its URL. Each start makes one Element in the
// chosen Object and runs it, as the person who set it up, along the
// workflow written on the automation itself.
//
// The list is the Object list's shape (Automation builder design §4.1):
// the Automation glyph leading, the name, when it starts and where its
// work lands as the quiet subline, and the minimum status on the right.
// A row is only that — clicking it opens the builder (AutomationBuilder),
// which holds the zones, the starts, the token and the verbs.

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
const NEW_WORKFLOW = '__new';

/** A workflow that can be picked: a harness's procedure, or another
 *  automation's workflow. Picking copies its steps; they are this
 *  automation's from then on. */
interface WorkflowSource { id: string; label: string; graph: WorkflowGraph }

function workflowSources(
  harnesses: { id: string; name: string; body: string; enabled: boolean }[],
  automations: Automation[],
  except: string | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
): WorkflowSource[] {
  return [
    ...automations.filter((a) => a.id !== except).map((a) => ({ id: `a:${a.id}`, label: a.name, graph: workflowGraphOf(a) })),
    ...harnesses.filter((d) => d.enabled).map((d) => ({ id: `h:${d.id}`, label: t('Harness: {name}', { name: d.name }), graph: graphFromWorkflow(workflowOf(d.body ?? '')) })),
  ].filter((s) => s.graph.nodes.length > 0);
}

function cronProblem(cron: string): string | null {
  try { parseCron(cron); return null; } catch (e) { return formatError(e); }
}

/** The Automations, one row each; a row opens the automation in the
 *  builder, with its Input / Athena / Output zones. */
export function AutomationsSection({ spaceId, creating, onCreatingChange, builderCreating, onBuilderCreatingChange, openId, onOpen, onOpenElement }: {
  spaceId: string | null;
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
  /** The "Build with Athena" door is open: a builder draft form
   *  (PR4), beside the direct-bind form the `creating` door opens. */
  builderCreating: boolean;
  onBuilderCreatingChange: (creating: boolean) => void;
  /** The automation open in the builder, or null for the list. */
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
  const [publishDraftId, setPublishDraftId] = useState<string | null>(null);

  const opened = openId ? automations.data.find((a) => a.id === openId) ?? null : null;
  if (opened) {
    return (
      <AutomationBuilder key={opened.id} a={opened} spaceId={spaceId} onBack={() => onOpen(null)}
        harnesses={harnesses.data} objects={objects} sources={workflowSources(harnesses.data, automations.data, opened.id, t)}
        sharedDefinitionNames={opened.definition_id
          ? automations.data.filter((x) => x.id !== opened.id && x.definition_id === opened.definition_id).map((x) => x.name)
          : []}
        token={token?.id === opened.id ? token.value : null}
        onToken={(value) => setToken({ id: opened.id, value })}
        onChanged={automations.refetch} onDeleted={() => onOpen(null)} onOpenElement={onOpenElement} />
    );
  }

  return (
    <div>
      {error && <p role="alert" className="px-6 py-2 text-[12px] text-[var(--status-danger)]">{error}</p>}
      {builderCreating && spaceId && (
        <div className="border-b border-border/60 px-6 py-4">
          <BuilderDraftStart spaceId={spaceId} objects={objects}
            onCancel={() => onBuilderCreatingChange(false)}
            onCreated={(draftId) => { onBuilderCreatingChange(false); setPublishDraftId(draftId); }} />
        </div>
      )}
      {publishDraftId && (
        <PromotionReviewDialogForDraft draftId={publishDraftId} spaceId={spaceId}
          definitions={harnesses.data}
          onClose={() => setPublishDraftId(null)}
          onChanged={automations.refetch} />
      )}
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
            <AutomationListRow key={a.id} a={a} objects={objects} onOpen={() => onOpen(a.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One automation as the Object list shows an Object: the Automation
 *  glyph in the icon slot, the name, when it starts and where its work
 *  lands underneath, and its status — off, failed, next or last — on
 *  the right. Nothing else; the builder behind the click holds the rest. */
function AutomationListRow({ a, objects, onOpen }: {
  a: Automation;
  objects: { id: string; name: string }[];
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const objectName = objects.find((o) => o.id === a.object_id)?.name ?? t('Unknown Object');
  const when = a.kind === 'schedule' ? describeCron(a.cron ?? '') : t('When an outside service posts');
  const status = automationStatusOf(a);
  const statusText = status.kind === 'off' ? t('Off')
    : status.kind === 'failed' ? <span className="text-[var(--status-danger)]">{t('Last start failed')}</span>
    : status.kind === 'next' ? t('Next {when}', { when: new Date(status.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })
    : status.kind === 'last' ? t('Last {when}', { when: formatRelative(status.at) }) : '';
  return (
    <li className="border-b border-border/50">
      <button type="button" onClick={onOpen}
        className="group flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-muted/30">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/40 text-muted-foreground">
          <NavAutomationIcon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">{a.name}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{when} → {objectName}</span>
        </span>
        <span className="hidden w-36 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground sm:block">{statusText}</span>
      </button>
    </li>
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
  const [cron, setCron] = useState(AUTOMATION_CRON_PRESETS[0].cron);
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
            {AUTOMATION_CRON_PRESETS.map((p) => (
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

/**
 * The "Build with Athena" door (Automation builder design §5.4,
 * PR4): the second way a new automation begins. The picks here —
 * a name, the Object its Elements land in, a schedule — seed a
 * promotion draft (source_kind 'builder', body skeleton + binding
 * with the trigger), and the draft goes through the standing path:
 * the drafting driver refines it, it is rehearsed, and the owner
 * activates it from the review this form opens on the draft. No
 * automation row exists until that activation; the direct-bind
 * form above remains the other door, for binding an existing
 * harness unchanged. Promotion bindings carry schedule triggers
 * only, so this door offers schedules — a webhook automation is
 * bound directly, as before.
 */
function BuilderDraftStart({ spaceId, objects, onCancel, onCreated }: {
  spaceId: string;
  objects: { id: string; name: string }[];
  onCancel: () => void;
  onCreated: (draftId: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [objectId, setObjectId] = useState(objects[0]?.id ?? '');
  const [cron, setCron] = useState(AUTOMATION_CRON_PRESETS[0].cron);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = cronProblem(cron);
  const ready = !!name.trim() && !!objectId && !problem;

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const draft = await createBuilderDraft(spaceId, {
        seedName: name.trim(),
        seedBody: builderSeedBodyOf(name.trim()),
        binding: {
          objectId, titleTemplate: '', descriptionTemplate: '',
          trigger: { kind: 'schedule', cron: cron.trim(), timezone: TIMEZONE },
        },
      });
      onCreated(draft.id);
    } catch (e) { setError(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-3 rounded-md border border-[var(--border-default)] p-3">
      <p className="text-[12px] text-muted-foreground">
        {t('Athena drafts the harness from these picks. It goes live only after rehearsal and your review — nothing runs before that.')}
      </p>
      <label className="block">
        <span className="mb-1 block text-[12px] text-muted-foreground">{t('Name')}</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Morning inquiry digest')} autoFocus />
      </label>
      <div>
        <span className="mb-1 block text-[12px] text-muted-foreground">{t('Put the work in')}</span>
        <OptionMenu label={t('Put the work in')} value={objectId} onChange={setObjectId}
          options={objects.map((o) => ({ value: o.id, label: o.name }))} />
      </div>
      <div className="space-y-1.5">
        <span className="mb-1 block text-[12px] text-muted-foreground">{t('Starts')}</span>
        <div className="flex flex-wrap gap-1">
          {AUTOMATION_CRON_PRESETS.map((p) => (
            <Button key={p.cron} size="xs" shape="tab" variant={cron === p.cron ? 'secondary' : 'ghost'} onClick={() => setCron(p.cron)}>{t(p.label)}</Button>
          ))}
        </div>
        <Input value={cron} onChange={(e) => setCron(e.target.value)} aria-label={t('Cron expression')} className="font-mono" />
        {problem && <p className="text-[12px] text-[var(--status-danger)]">{problem}</p>}
      </div>
      {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>{t('Cancel')}</Button>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={!ready || saving}>{t('Start the draft')}</Button>
      </div>
    </div>
  );
}
