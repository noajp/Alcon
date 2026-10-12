'use client';
import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { useGeneratedApp } from '@/hooks/useGeneratedApp';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import { summaryApp } from '../generated/summaryApp';
import { AppRuntime } from '../generated/AppRuntime';
import type { WidgetProps } from '../types';

export function GeneratedAppWidget({ host, instanceId }: WidgetProps) {
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
  useWidgetMeta(app?.draft_app?.title ?? app?.current_app?.title ?? 'Create your own tool');
  useEffect(() => {
    if (!store.loading && !loaded.current) { loaded.current = true; setPrompt(app?.prompt ?? ''); latestPrompt.current = app?.prompt ?? ''; }
  }, [store.loading, app?.prompt]);
  const savePrompt = useRef(store.savePrompt);
  useEffect(() => { savePrompt.current = store.savePrompt; }, [store.savePrompt]);
  useEffect(() => {
    if (!loaded.current || prompt === latestPrompt.current || host.readOnly) return;
    const timer = setTimeout(() => {
      latestPrompt.current = prompt;
      void savePrompt.current(prompt).catch(e => setError(e instanceof Error ? e.message : 'Could not save request.'));
    }, 500);
    return () => clearTimeout(timer);
  }, [prompt, host.readOnly]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the app.'); }
    finally { setBusy(false); }
  }
  const showEditor = editing || !app?.current_app || !!app?.draft_app;
  const source = app?.draft_app ?? app?.current_app;
  const locked = busy || !!host.readOnly || !!store.error || store.loading;
  if (store.loading) return <p className="text-sm text-muted-foreground">Loading your app…</p>;
  return <div className="space-y-3">
    <WidgetHeaderAction>
      {app?.current_app && <Button variant="ghost" size="sm" disabled={locked} onClick={() => setEditing(v => !v)}>{showEditor ? 'Close editor' : 'Edit with AI'}</Button>}
    </WidgetHeaderAction>
    {showEditor && <div className="space-y-3">
      {!app?.current_app && !app?.draft_app && <div className="space-y-1">
        <p className="text-sm font-medium">A small app for this Object</p>
        <p className="text-xs text-muted-foreground">Create a summary of this Object’s Strategy and Execution, a calculator, checklist or form. The app and its saved inputs are shared with everyone who can see this Object.</p>
      </div>}
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); void run(() => store.generate(prompt)); }}>
        <TextComposer aria-label="Describe your app" placeholder="Example: Calculate an estimate from headcount, unit price and discount, then save the chosen plan." rows={3} maxLength={8000} value={prompt} disabled={locked} onChange={e => setPrompt(e.target.value)}
          hint="Uses AI when you generate"
          action={<Button type="submit" variant="primary" size="sm" disabled={locked || !prompt.trim()}>{busy ? 'Working…' : source ? 'Generate revision' : 'Generate app'}</Button>}
          secondaryAction={app?.previous_app && <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => void run(async () => { await store.restore(); setEpoch(n => n + 1); })}><RotateCcw size={13} />Previous version</Button>}
        />
      </form>
      {!source && <Button variant="secondary" size="sm" disabled={locked} onClick={() => void run(() => store.useTemplate(summaryApp))}>Start with a project summary</Button>}
      {!source && <div className="flex flex-wrap gap-1">
        {['Summarize this Object’s Elements and related Initiatives', 'Calculate estimates and save plans', 'Create a delivery checklist', 'Track agendas and decisions'].map(example => <Button key={example} variant="ghost" size="sm" multiline disabled={locked} onClick={() => setPrompt(example)}>{example}</Button>)}
      </div>}
    </div>}
    {app?.draft_app && <div className="flex flex-wrap items-center gap-2">
      <p className="mr-auto text-xs text-muted-foreground">Preview · only you see this until you use it. It then replaces the app for everyone.</p>
      <Button size="sm" disabled={locked || !ready || store.saving} onClick={() => void run(async () => { await store.adopt(); setEditing(false); setPrompt(''); latestPrompt.current = ''; setEpoch(n => n + 1); })}>Use this app</Button>
      <Button variant="ghost" size="sm" disabled={locked} onClick={() => void run(() => store.discard())}>Discard preview</Button>
    </div>}
    {source?.usesObjectData && (app?.draft_app || store.dataConnected
      ? <p className="text-xs text-muted-foreground">Object data connected · Reads this Object’s Elements, related Initiatives and Intents with your access permissions. Data reflects the time it was fetched.</p>
      : <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">Object data not connected · Once connected, this version reads this Object’s Elements, related Initiatives and Intents with your access, and can save what it reads where everyone on this widget sees it.</p>
        <Button variant="secondary" size="sm" disabled={locked} onClick={() => void run(() => store.connectData())}>Connect Object data</Button>
      </div>)}
    {source && <AppRuntime key={`${epoch}:${app?.draft_app ? 'draft' : store.dataConnected ? 'live' : 'unconnected'}:${JSON.stringify(source)}`} source={source} state={store.state} objectId={host.subject.id ?? ''} objectName={host.object?.name ?? ''} preview={!!app?.draft_app} readOnly={!!host.readOnly || !!store.error} onSave={async (value, base) => { try { return await store.saveState(value, base); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save app data.'); throw e; } }} onReadContext={source.usesObjectData && (app?.draft_app || store.dataConnected) ? store.readContext : undefined} onReady={setReady} />}
    {(error || store.error) && <div role="alert" className="space-y-1 text-sm text-destructive"><p>{error ?? store.error}</p><Button variant="ghost" size="sm" disabled={busy || store.saving} onClick={() => void run(async () => { const result = await store.reload(); if (result.error) throw result.error; setEpoch(n => n + 1); })}>Reload saved app</Button></div>}
    {host.readOnly && <p className="text-xs text-muted-foreground">Reconnect to edit or save this app.</p>}
  </div>;
}
