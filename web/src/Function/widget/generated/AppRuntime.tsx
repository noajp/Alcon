'use client';
import { useEffect, useRef, useState } from 'react';
import { appDocument } from './runtime';
import { parseAppState, type AppSource, type AppState } from './model';

export function AppRuntime({ source, state, objectId, objectName, preview, readOnly, onSave, onReady }: {
  source: AppSource; state: AppState; objectId: string; objectName: string; preview: boolean; readOnly: boolean;
  onSave: (state: AppState) => Promise<void>; onReady: (ready: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [document] = useState(() => {
    const channel = crypto.randomUUID();
    const theme: Record<string, string> = {};
    const styles = getComputedStyle(window.document.documentElement);
    for (const name of ['background','foreground','muted','muted-foreground','primary','primary-foreground','border']) theme[`--${name}`] = styles.getPropertyValue(`--${name}`);
    return { channel, html: appDocument(source, state, { objectId, objectName }, channel, theme) };
  });
  const callbacks = useRef({ onSave, onReady, readOnly });
  useEffect(() => { callbacks.current = { onSave, onReady, readOnly }; }, [onSave, onReady, readOnly]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(preview ? 'Preview · inputs here are not saved' : 'Loading app…');
  useEffect(() => {
    callbacks.current.onReady(false);
    let alive = true;
    let ready = false;
    let lastId = 0;
    const timer = setTimeout(() => { if (!ready) { setError('The app did not start. Use AI to fix it.'); callbacks.current.onReady(false); } }, 12000);
    async function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== document.channel) return;
      const message = event.data;
      if (message.type === 'boot') frame.current?.contentWindow?.postMessage({ channel: document.channel, type: 'start' }, '*');
      if (message.type === 'ready') { ready = true; clearTimeout(timer); callbacks.current.onReady(true); if (!preview) setStatus('Saved app'); }
      if (message.type === 'error') { setError(String(message.message).slice(0, 400)); callbacks.current.onReady(false); }
      if (message.type !== 'save') return;
      if (!Number.isSafeInteger(message.id) || message.id <= lastId) return;
      lastId = message.id;
      let failure: string | undefined;
      try {
        if (callbacks.current.readOnly) throw new Error('This app is read-only.');
        const next = parseAppState(message.value);
        if (!preview) { setStatus('Saving…'); await callbacks.current.onSave(next); }
        if (alive) { setError(null); setStatus(preview ? 'Preview · inputs here are not saved' : 'All changes saved'); }
      } catch (e) { failure = e instanceof Error ? e.message : 'Save failed.'; if (alive) { setError(failure); setStatus('Not saved'); } }
      if (alive) frame.current?.contentWindow?.postMessage({ channel: document.channel, type: 'saved', id: message.id, error: failure }, '*');
    }
    window.addEventListener('message', receive);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [document, preview]);
  return <div className="space-y-2">
    <iframe ref={frame} title={`${preview ? 'Preview: ' : ''}${source.title}`} srcDoc={document.html} onLoad={() => frame.current?.contentWindow?.postMessage({ channel: document.channel, type: 'start' }, '*')} sandbox="allow-scripts" referrerPolicy="no-referrer" className="h-[420px] w-full rounded-md border-0 bg-background" />
    <p role="status" className="text-xs text-muted-foreground">{status}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
