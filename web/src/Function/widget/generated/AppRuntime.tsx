'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { appDocument } from './runtime';
import { parseAppState, stableJson, type AppSource, type AppState } from './model';

// The frame takes its content's height, within these bounds; past the upper
// one the app scrolls inside. A page that sizes itself to the frame cannot
// grow it without end.
const MIN_FRAME_HEIGHT = 120;
const MAX_FRAME_HEIGHT = 2400;

export function AppRuntime({ source, state, objectId, objectName, preview, readOnly, onSave, onReady, onReadContext }: {
  source: AppSource; state: AppState; objectId: string; objectName: string; preview: boolean; readOnly: boolean;
  onReadContext?: () => Promise<unknown>;
  /** Saves what changed since `base`; resolves to the state everyone now has. */
  onSave: (state: AppState, base: AppState) => Promise<AppState>; onReady: (ready: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const channelId = useId();
  const [document] = useState(() => {
    const channel = channelId;
    return { channel, html: appDocument(source, state, { objectId, objectName }, channel, {}) };
  });
  const sendTheme = useCallback((type: 'start' | 'theme') => {
    const styles = getComputedStyle(window.document.documentElement);
    const theme: Record<string, string> = {};
    // Include referenced tokens too: custom property values can contain var().
    for (let index = 0; index < styles.length; index++) {
      const name = styles.item(index);
      if (name.startsWith('--')) theme[name] = styles.getPropertyValue(name);
    }
    frame.current?.contentWindow?.postMessage({ channel: document.channel, type, theme }, '*');
  }, [document.channel]);
  useEffect(() => {
    const observer = new MutationObserver(() => sendTheme('theme'));
    observer.observe(window.document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, [sendTheme]);
  const callbacks = useRef({ onSave, onReady, readOnly, onReadContext });
  useEffect(() => { callbacks.current = { onSave, onReady, readOnly, onReadContext }; }, [onSave, onReady, readOnly, onReadContext]);
  // The state last handed to the app, to tell whether the saved one has moved on.
  const handed = useRef(state);
  const latest = useRef(state);
  const started = useRef(false);
  const saving = useRef(0);
  const pushState = useCallback((value: AppState) => {
    handed.current = value;
    frame.current?.contentWindow?.postMessage({ channel: document.channel, type: 'state', value }, '*');
  }, [document.channel]);
  // Someone else saved: hand the running app the new state. Not before the app
  // has started — it would not be listening — and not while a save of our own
  // is in flight, whose answer already carries their change.
  const pushIfMoved = useCallback(() => {
    if (preview || !started.current || saving.current > 0) return;
    if (stableJson(latest.current) !== stableJson(handed.current)) pushState(latest.current);
  }, [preview, pushState]);
  useEffect(() => { latest.current = state; pushIfMoved(); }, [state, pushIfMoved]);
  const [height, setHeight] = useState(240);
  const growth = useRef({ step: 0, repeats: 0 });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(preview ? 'Preview · inputs here are not saved' : 'Loading app…');
  useEffect(() => {
    callbacks.current.onReady(false);
    let alive = true;
    let ready = false;
    let lastId = 0;
    let reading = false;
    let lastRead = 0;
    const timer = setTimeout(() => { if (!ready) { setError('The app did not start. Use AI to fix it.'); callbacks.current.onReady(false); } }, source.usesObjectData ? 40000 : 12000);
    async function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== document.channel) return;
      const message = event.data;
      if (message.type === 'boot') sendTheme('start');
      if (message.type === 'ready') { setError(null); ready = true; clearTimeout(timer); callbacks.current.onReady(true); if (!preview) setStatus('Saved app'); started.current = true; pushIfMoved(); }
      if (message.type === 'size' && Number.isFinite(message.height)) {
        const next = Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.ceil(message.height)));
        setHeight(current => {
          // Content sized to the frame (100vh) grows by the same step every
          // time the frame grows. Three equal steps in a row is that loop, not
          // content: stop growing and let it scroll inside.
          const step = next - current;
          if (step > 0) {
            growth.current = step === growth.current.step ? { step, repeats: growth.current.repeats + 1 } : { step, repeats: 1 };
            if (growth.current.repeats >= 3) return current;
          } else growth.current = { step: 0, repeats: 0 };
          return next;
        });
        return;
      }
      if (message.type === 'error') { setError(String(message.message).slice(0, 400)); callbacks.current.onReady(false); }
      if (!['save', 'read-context'].includes(message.type)) return;
      if (!Number.isSafeInteger(message.id) || message.id <= lastId) return;
      lastId = message.id;
      if (message.type === 'read-context') {
        let value: unknown;
        let failure: string | undefined;
        const allowed = !reading && Date.now() - lastRead >= 1000;
        try {
          if (!source.usesObjectData || !callbacks.current.onReadContext) throw new Error('Object data is not connected to this app.');
          if (!allowed) throw new Error('An Object data request is already running. Try again shortly.');
          reading = true; lastRead = Date.now();
          value = await callbacks.current.onReadContext();
        } catch (e) { failure = e instanceof Error ? e.message : 'Could not read Object data.'; }
        finally { if (allowed) reading = false; }
        if (alive) frame.current?.contentWindow?.postMessage({ channel: document.channel, type: 'context', id: message.id, value, error: failure }, '*');
        return;
      }
      let failure: string | undefined;
      let merged: AppState | undefined;
      saving.current += 1;
      try {
        if (callbacks.current.readOnly) throw new Error('This app is read-only.');
        const next = parseAppState(message.value);
        if (!preview) {
          setStatus('Saving…');
          // Against the state the app says it started from, not one the host
          // assumes: a save sent before the last answer arrived starts earlier.
          merged = await callbacks.current.onSave(next, message.base === undefined ? handed.current : parseAppState(message.base));
          // Both move together: the saved state reaches `state` a tick later, and
          // until then the pre-save value must not look like news to hand over.
          handed.current = merged;
          latest.current = merged;
        }
        if (alive) { setError(null); setStatus(preview ? 'Preview · inputs here are not saved' : 'All changes saved'); }
      } catch (e) { failure = e instanceof Error ? e.message : 'Save failed.'; if (alive) { setError(failure); setStatus('Not saved'); } }
      finally { saving.current -= 1; }
      if (!alive) return;
      frame.current?.contentWindow?.postMessage({ channel: document.channel, type: 'saved', id: message.id, value: merged, error: failure }, '*');
      // The merged state differs from what the app sent when someone else changed another key meanwhile.
      if (merged && stableJson(merged) !== stableJson(message.value)) pushState(merged);
      pushIfMoved();
    }
    window.addEventListener('message', receive);
    sendTheme('start');
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [document, preview, source.usesObjectData, sendTheme, pushState, pushIfMoved]);
  return <div className="space-y-2">
    <iframe ref={frame} title={`${preview ? 'Preview: ' : ''}${source.title}`} srcDoc={document.html} onLoad={() => sendTheme('start')} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{ height }} className="w-full rounded-md border-0 bg-background" />
    <p role="status" className="text-xs text-muted-foreground">{status}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
