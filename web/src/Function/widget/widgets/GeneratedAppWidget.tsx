'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from '@/ui/icons';
import { SendIcon } from '@/Function/shared/SendIcon';
import { Button } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { useGeneratedApp } from '@/hooks/useGeneratedApp';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import { CANVAS_TEMPLATES } from '../generated/templates';
import { AthenaControls } from '@/Function/shared/AthenaControls';
import { CanvasSkillsDialog } from '../generated/CanvasSkills';
import { libraryCode } from '../generated/skills';
import { AppRuntime } from '../generated/AppRuntime';
import type { WidgetProps } from '../types';
import { useI18n } from '@/Function/i18n/I18nProvider';

export function GeneratedAppWidget({ host, instanceId }: WidgetProps) {
  const { t } = useI18n();
  const store = useGeneratedApp(host.subject.id ?? '', instanceId ?? '');
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const loaded = useRef(false);
  const latestPrompt = useRef('');
  const app = store.app;
  const [skillsOpen, setSkillsOpen] = useState(false);
  useWidgetMeta(app?.draft_app?.title ?? app?.current_app?.title ?? null);
  useEffect(() => {
    if (!store.loading && !loaded.current) { loaded.current = true; setPrompt(app?.prompt ?? ''); latestPrompt.current = app?.prompt ?? ''; }
  }, [store.loading, app?.prompt]);
  const savePrompt = useRef(store.savePrompt);
  useEffect(() => { savePrompt.current = store.savePrompt; }, [store.savePrompt]);
  useEffect(() => {
    if (!loaded.current || prompt === latestPrompt.current || host.readOnly) return;
    const timer = setTimeout(() => {
      latestPrompt.current = prompt;
      void savePrompt.current(prompt).catch(e => setError(e instanceof Error ? e.message : t('Could not save request.')));
    }, 500);
    return () => clearTimeout(timer);
  }, [prompt, host.readOnly, t]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : t('Could not save the app.')); }
    finally { setBusy(false); }
  }
  // A canvas's libraries are fetched here: its frame has no network.
  const libraryList = (app?.draft_app ?? app?.current_app)?.libraries;
  const libraryKey = (libraryList ?? []).join('\n');
  const libsQuery = useQuery({
    queryKey: ['canvas-libraries', libraryKey], enabled: !!libraryKey, staleTime: Infinity, retry: 1,
    queryFn: () => Promise.all(libraryKey.split('\n').map(libraryCode)),
  });
  const libs = { code: libraryKey ? libsQuery.data ?? null : [], error: libraryKey && libsQuery.error ? (libsQuery.error instanceof Error ? libsQuery.error.message : 'Could not load a library.') : null };
  const showEditor = editing || !app?.current_app || !!app?.draft_app;
  const source = app?.draft_app ?? app?.current_app;
  const locked = busy || !!host.readOnly || !!store.error || store.loading;
  if (store.loading) return <p className="text-sm text-muted-foreground">{t('Loading your app…')}</p>;
  return <div className="space-y-3">
    <WidgetHeaderAction>
      {!host.readOnly && <Button variant="ghost" size="sm" onClick={() => setSkillsOpen(true)}>{t('Skills')}</Button>}
      {app?.current_app && <Button variant="ghost" size="sm" disabled={locked} onClick={() => setEditing(v => !v)}>{showEditor ? t('Close editor') : t('Edit with Athena')}</Button>}
    </WidgetHeaderAction>
    {showEditor && <div className="space-y-3">
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); void run(() => store.generate(prompt)); }}>
        <TextComposer aria-label={t('Describe your canvas')} placeholder={t('Example: Compare social security spending across countries as a chart. Or: a dashboard of this Object’s progress.')} rows={3} maxLength={8000} value={prompt} disabled={locked} onChange={e => setPrompt(e.target.value)}
          hint={<AthenaControls disabled={locked} />}
          action={<Button type="submit" variant="primary" size="xs" className="rounded-md px-2" title={t('Send')} aria-label={t('Send')} disabled={locked || !prompt.trim()}><SendIcon size={13} /></Button>}
          secondaryAction={app?.previous_app && <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => void run(async () => { await store.restore(); setEpoch(n => n + 1); })}><RotateCcw size={13} />{t('Previous version')}</Button>}
        />
      </form>
      {/* Ready-made canvases: known code, in place at once, no AI. */}
      {!source && <div className="flex flex-wrap gap-1.5">
        {CANVAS_TEMPLATES.map((tpl) => (
          <Button key={tpl.id} variant="secondary" size="sm" disabled={locked}
            onClick={() => void run(async () => { await store.useTemplate(tpl.source); setPrompt(''); latestPrompt.current = ''; })}>{t(tpl.label)}</Button>
        ))}
      </div>}
    </div>}
    {app?.draft_app && <div className="flex flex-wrap items-center gap-2">
      <p className="mr-auto text-xs text-muted-foreground">{t('Preview · only you see this until you use it. It then replaces the app for everyone.')}</p>
      <Button variant="primary" size="sm" disabled={locked || !ready || store.saving} onClick={() => void run(async () => { await store.adopt(); setEditing(false); setPrompt(''); latestPrompt.current = ''; setEpoch(n => n + 1); })}>{t('Use this app')}</Button>
      <Button variant="ghost" size="sm" disabled={locked} onClick={() => void run(() => store.discard())}>{t('Discard preview')}</Button>
    </div>}
    {(source?.usesObjectData || source?.usesSpaceData) && (app?.draft_app || store.dataConnected
      ? store.knownTemplate ? null : <p className="text-xs text-muted-foreground">{t('Object data connected · Reads this Object’s Elements, related Strategies and Intents with your access permissions. Data reflects the time it was fetched.')}</p>
      : <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">{source?.usesSpaceData ? t('Space data not connected · Once connected, this version reads everything you can see in this Space — Domains, Objects, Elements, Strategies and people — with your access, and can save what it reads where everyone on this canvas sees it.') : t('Object data not connected · Once connected, this version reads this Object’s Elements, related Strategies and Intents with your access, and can save what it reads where everyone on this widget sees it.')}</p>
        <Button variant="secondary" size="sm" disabled={locked} onClick={() => void run(() => store.connectData())}>{source?.usesSpaceData ? t('Connect Space data') : t('Connect Object data')}</Button>
      </div>)}
    <CanvasSkillsDialog open={skillsOpen} onOpenChange={setSkillsOpen} />
    {source && libs.error && <p role="alert" className="text-sm text-destructive">{libs.error}</p>}
    {source && libs.code && <AppRuntime key={`${epoch}:${app?.draft_app ? 'draft' : store.dataConnected ? 'live' : 'unconnected'}:${JSON.stringify(source)}`} libraryCode={libs.code} onReadSpace={source.usesSpaceData && (app?.draft_app || store.dataConnected) ? store.readSpace : undefined} source={source} state={store.state} objectId={host.subject.id ?? ''} objectName={host.object?.name ?? ''} preview={!!app?.draft_app} readOnly={!!host.readOnly || !!store.error} onSave={async (value, base) => { try { return await store.saveState(value, base); } catch (e) { setError(e instanceof Error ? e.message : t('Could not save app data.')); throw e; } }} onReadContext={source.usesObjectData && (app?.draft_app || store.dataConnected) ? store.readContext : undefined} onReady={setReady} />}
    {(error || store.error) && <div role="alert" className="space-y-1 text-sm text-destructive"><p>{error ?? store.error}</p><Button variant="ghost" size="sm" disabled={busy || store.saving} onClick={() => void run(async () => { const result = await store.reload(); if (result.error) throw result.error; setEpoch(n => n + 1); })}>{t('Reload saved app')}</Button></div>}
    {host.readOnly && <p className="text-xs text-muted-foreground">{t('Reconnect to edit or save this app.')}</p>}
  </div>;
}
