'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { ChevronDown, ChevronRight } from '@/ui/icons';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { formatRelative } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useObjects } from '@/Function/sync/explorerData';
import { CopyField } from '@/AIP/connectors/CopyField';
import { describeCron, parseCron, nextCronRun } from '@/AIP/automation/cron';
import { useDefinitions } from '@/hooks/definitionData';
import { enabledDefinitions } from '@/AIP/harness/installState';
import {
  createAutomation, deleteAutomation, issueWebhookToken, runAutomationNow, setAutomationEnabled,
  useAutomationEvents, useAutomations, webhookUrl, type Automation, type AutomationKind,
} from '@/hooks/automationData';

// Automations: which harness starts by itself, when, and where its work goes.
// A schedule starts at the times its cron names; a webhook starts when an
// outside service posts to its URL. Each start makes one Element in the
// chosen Object and runs it with the harness, as the person who set it up.

const PRESETS: { cron: string; label: string }[] = [
  { cron: '0 9 * * *', label: 'Every day at 9:00' },
  { cron: '0 9 * * 1-5', label: 'Weekdays at 9:00' },
  { cron: '0 * * * *', label: 'Every hour' },
  { cron: '0 9 * * 1', label: 'Mondays at 9:00' },
];
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';

function cronProblem(cron: string): string | null {
  try { parseCron(cron); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

export function AutomationsSection({ spaceId, onOpenElement }: { spaceId: string | null; onOpenElement?: (id: string) => void }) {
  const { t } = useI18n();
  const automations = useAutomations(spaceId);
  const harnesses = useDefinitions(spaceId);
  const { data: explorer } = useObjects(null);
  const objects = explorer.objects;
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState<{ id: string; value: string } | null>(null);

  const harnessName = useMemo(() => new Map(harnesses.data.map((d) => [d.id, d.name])), [harnesses.data]);
  const objectName = useMemo(() => new Map(objects.map((o) => [o.id, o.name])), [objects]);

  const act = async (id: string, f: () => Promise<void>, done?: string) => {
    setBusy(id); setError(null); setNotice(null);
    try { await f(); if (done) setNotice(done); automations.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-foreground">{t('Automations')}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('A harness that starts by itself — at set times, or when an outside service sends something. Each start makes an Element and runs it with your authority.')}</p>
        </div>
        {!creating && <Button size="sm" variant="secondary" disabled={!spaceId} onClick={() => setCreating(true)}>{t('New automation')}</Button>}
      </div>

      {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
      {notice && <p role="status" className="text-[12px] text-muted-foreground">{notice}</p>}

      {creating && spaceId && (
        <NewAutomation spaceId={spaceId} harnesses={enabledDefinitions(harnesses.data)} objects={objects}
          onCancel={() => setCreating(false)}
          onCreated={async (a) => {
            setCreating(false); setOpen(a.id); automations.refetch();
            if (a.kind === 'webhook') {
              try { setToken({ id: a.id, value: await issueWebhookToken(a.id) }); automations.refetch(); }
              catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            }
          }} />
      )}

      {automations.loading ? (
        <p role="status" className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
      ) : automations.data.length === 0 && !creating ? (
        <p className="text-[12px] text-muted-foreground">{t('No automations yet.')}</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {automations.data.map((a) => {
            const expanded = open === a.id;
            const when = a.kind === 'schedule' ? describeCron(a.cron ?? '') : t('When an outside service posts');
            return (
              <li key={a.id} className="py-2">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setOpen(expanded ? null : a.id)} aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    {expanded ? <ChevronDown size={13} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={13} className="shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">{a.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {when} · {harnessName.get(a.definition_id) ?? t('Unknown harness')} → {objectName.get(a.object_id) ?? t('Unknown Object')}
                      </span>
                    </span>
                  </button>
                  <span className="hidden shrink-0 text-right text-[11px] tabular-nums text-muted-foreground sm:block">
                    {!a.enabled ? t('Off')
                      : a.last_status === 'failed' ? <span className="text-[var(--status-danger)]">{t('Last start failed')}</span>
                      : a.kind === 'schedule' && a.next_run_at ? t('Next {when}', { when: new Date(a.next_run_at).toLocaleString() })
                      : a.last_fired_at ? t('Last {when}', { when: formatRelative(a.last_fired_at) }) : ''}
                  </span>
                  <Button size="xs" variant="ghost" disabled={busy === a.id}
                    onClick={() => void act(a.id, () => runAutomationNow(a.id), t('Started “{name}”.', { name: a.name }))}>{t('Run now')}</Button>
                  <Button size="xs" variant="ghost" disabled={busy === a.id}
                    onClick={() => void act(a.id, () => setAutomationEnabled(a, !a.enabled))}>{a.enabled ? t('Turn off') : t('Turn on')}</Button>
                </div>
                {expanded && (
                  <div className="mt-2 space-y-3 pl-5">
                    {a.last_status === 'failed' && a.last_error && <p className="text-[12px] text-[var(--status-danger)]">{a.last_error}</p>}
                    {a.kind === 'webhook' && (
                      <div className="space-y-1.5">
                        <p className="text-[12px] text-muted-foreground">{t('POST JSON to this URL with the token in the x-alcon-token header. The body becomes the input of the Element it makes.')}</p>
                        <CopyField value={webhookUrl(a.id)} label={t('URL')} />
                        {token?.id === a.id ? (
                          <>
                            <CopyField value={token.value} label={t('Token')} />
                            <p className="text-[11px] text-muted-foreground">{t('Copy the token now. It is not shown again.')}</p>
                          </>
                        ) : (
                          <Button size="xs" variant="ghost" disabled={busy === a.id}
                            onClick={() => void act(a.id, async () => setToken({ id: a.id, value: await issueWebhookToken(a.id) }))}>
                            {a.has_token ? t('Replace the token') : t('Issue a token')}
                          </Button>
                        )}
                      </div>
                    )}
                    <RecentStarts automationId={a.id} onOpenElement={onOpenElement} />
                    <Button size="xs" variant="ghost" className="text-[var(--status-danger)]" disabled={busy === a.id}
                      onClick={() => void act(a.id, () => deleteAutomation(a.id))}>{t('Delete')}</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RecentStarts({ automationId, onOpenElement }: { automationId: string; onOpenElement?: (id: string) => void }) {
  const { t } = useI18n();
  const events = useAutomationEvents(automationId);
  if (events.loading) return <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>;
  if (events.data.length === 0) return <p className="text-[12px] text-muted-foreground">{t('It has not started yet.')}</p>;
  const label: Record<string, string> = { schedule: 'On schedule', webhook: 'From outside', manual: 'Run now' };
  return (
    <div>
      <p className="mb-1 text-[12px] font-medium text-foreground">{t('Recent starts')}</p>
      <ul className="space-y-1">
        {events.data.map((e) => (
          <li key={e.id} className="flex items-center gap-2 text-[12px]">
            <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatRelative(e.created_at)}</span>
            <span className="w-24 shrink-0 text-muted-foreground">{t(label[e.source])}</span>
            {e.status === 'failed'
              ? <span className="min-w-0 flex-1 truncate text-[var(--status-danger)]" title={e.error ?? ''}>{e.error ?? t('Failed')}</span>
              : e.element_id && onOpenElement
                ? <button type="button" onClick={() => onOpenElement(e.element_id!)} className="min-w-0 flex-1 truncate text-left text-foreground hover:underline">{t('Open the Element')}</button>
                : <span className="min-w-0 flex-1 text-muted-foreground">{t(e.status === 'started' ? 'Started' : 'Received')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewAutomation({ spaceId, harnesses, objects, onCancel, onCreated }: {
  spaceId: string;
  harnesses: { id: string; name: string }[];
  objects: { id: string; name: string }[];
  onCancel: () => void;
  onCreated: (a: Automation) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [definitionId, setDefinitionId] = useState(harnesses[0]?.id ?? '');
  const [objectId, setObjectId] = useState(objects[0]?.id ?? '');
  const [kind, setKind] = useState<AutomationKind>('schedule');
  const [cron, setCron] = useState(PRESETS[0].cron);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = kind === 'schedule' ? cronProblem(cron) : null;
  const next = kind === 'schedule' && !problem ? nextCronRun(cron, new Date(), TIMEZONE) : null;
  const ready = !!name.trim() && !!definitionId && !!objectId && !problem;

  const save = async () => {
    setSaving(true); setError(null);
    try { onCreated(await createAutomation({ spaceId, name, definitionId, objectId, kind, cron: kind === 'schedule' ? cron : null, timezone: TIMEZONE })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  if (harnesses.length === 0) {
    return <p className="rounded-md bg-[var(--surface-strong)] px-3 py-2 text-[12px] text-foreground">{t('Add a harness first (Settings › AI › Harnesses). An automation starts a harness.')}</p>;
  }

  return (
    <div className="space-y-3 rounded-md border border-[var(--border-default)] p-3">
      <label className="block">
        <span className="mb-1 block text-[12px] text-muted-foreground">{t('Name')}</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Morning inquiry digest')} autoFocus />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-[12px] text-muted-foreground">{t('Harness')}</span>
          <OptionMenu label={t('Harness')} value={definitionId} onChange={setDefinitionId}
            options={harnesses.map((d) => ({ value: d.id, label: d.name }))} />
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
