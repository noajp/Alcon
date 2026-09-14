'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, RotateCcw } from 'lucide-react';
import { Button } from '@/ui/button';
import { useGeneratedApp } from '@/hooks/useGeneratedApp';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
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
      {app?.current_app && <Button variant="ghost" size="sm" disabled={locked} onClick={() => setEditing(v => !v)}><Sparkles size={13} />{showEditor ? 'Close editor' : 'Edit with AI'}</Button>}
    </WidgetHeaderAction>
    {showEditor && <div className="space-y-3">
      {!app?.current_app && !app?.draft_app && <div className="space-y-1">
        <p className="text-sm font-medium">A small app for this Object</p>
        <p className="text-xs text-muted-foreground">Describe a calculator, checklist or form. The app and its saved inputs stay here when you return. Private to you.</p>
      </div>}
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); void run(() => store.generate(prompt)); }}>
        <textarea aria-label="Describe your app" placeholder="例：人数・単価・割引率で見積もりを計算して、採用案を保存したい" rows={3} maxLength={8000} value={prompt} disabled={locked} onChange={e => setPrompt(e.target.value)} className="w-full resize-y rounded-md border-0 bg-muted/30 p-3 text-sm placeholder:text-muted-foreground focus:bg-muted/60" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={locked || !prompt.trim()}><Sparkles size={14} />{busy ? 'Working…' : source ? 'Generate revision' : 'Generate app'}</Button>
          {app?.previous_app && <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => void run(async () => { await store.restore(); setEpoch(n => n + 1); })}><RotateCcw size={13} />Previous version</Button>}
          <span className="text-xs text-muted-foreground">Uses AI when you generate</span>
        </div>
      </form>
      {!source && <div className="flex flex-wrap gap-1">
        {['見積もり計算と案の保存', '納品前のチェックリスト', '議題と決定事項の記録フォーム'].map(example => <Button key={example} variant="ghost" size="sm" disabled={locked} onClick={() => setPrompt(example)}>{example}</Button>)}
      </div>}
    </div>}
    {app?.draft_app && <div className="flex flex-wrap items-center gap-2">
      <p className="mr-auto text-xs text-muted-foreground">Preview · try it before replacing your saved app.</p>
      <Button size="sm" disabled={locked || !ready || store.saving} onClick={() => void run(async () => { await store.adopt(); setEditing(false); setPrompt(''); latestPrompt.current = ''; setEpoch(n => n + 1); })}>Use this app</Button>
      <Button variant="ghost" size="sm" disabled={locked} onClick={() => void run(() => store.discard())}>Discard preview</Button>
    </div>}
    {source && <AppRuntime key={`${epoch}:${app?.draft_app ? 'draft' : 'live'}:${JSON.stringify(source)}`} source={source} state={store.state} objectId={host.subject.id ?? ''} objectName={host.object?.name ?? ''} preview={!!app?.draft_app} readOnly={!!host.readOnly || !!store.error} onSave={async value => { try { await store.saveState(value); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save app data.'); throw e; } }} onReady={setReady} />}
    {(error || store.error) && <div role="alert" className="space-y-1 text-sm text-destructive"><p>{error ?? store.error}</p><Button variant="ghost" size="sm" disabled={busy || store.saving} onClick={() => void run(async () => { const result = await store.reload(); if (result.error) throw result.error; setEpoch(n => n + 1); })}>Reload saved app</Button></div>}
    {host.readOnly && <p className="text-xs text-muted-foreground">Reconnect to edit or save this app.</p>}
  </div>;
}
