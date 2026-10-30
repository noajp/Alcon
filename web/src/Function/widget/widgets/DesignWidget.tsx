'use client';
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { TextComposer } from '@/ui/text-composer';
import { MenuShell } from '@/Function/shared/menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useDesign } from '@/hooks/useDesign';
import { DesignFrame } from '../design/DesignFrame';
import { designDocument, designHandoff, type DesignSource } from '../design/model';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';

function download(design: DesignSource) {
  const blob = new Blob([designDocument(design, window.location.origin)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${design.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'design'}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * A design on a board: one artboard in HTML, CSS and SVG, made and revised by
 * describing it. Everyone who can see the widget sees the same design; a
 * revision is the asker's own until they use it.
 */
export function DesignWidget({ host, instanceId }: WidgetProps) {
  const { t } = useI18n();
  const store = useDesign(instanceId ?? '');
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const loaded = useRef(false);
  const lastSaved = useRef('');

  const shown = store.draft ?? store.current;
  useWidgetMeta(shown ? `${shown.width} × ${shown.height}` : null);

  // The request is kept as it is typed, so it survives a reload.
  useEffect(() => {
    if (!store.loading && !loaded.current) { loaded.current = true; setPrompt(store.prompt); lastSaved.current = store.prompt; }
  }, [store.loading, store.prompt]);
  const savePrompt = useRef(store.savePrompt);
  useEffect(() => { savePrompt.current = store.savePrompt; }, [store.savePrompt]);
  useEffect(() => {
    if (!loaded.current || prompt === lastSaved.current || host.readOnly) return;
    const timer = setTimeout(() => {
      lastSaved.current = prompt;
      void savePrompt.current(prompt).catch(e => setError(e instanceof Error ? e.message : t('Could not save request.')));
    }, 500);
    return () => clearTimeout(timer);
  }, [prompt, host.readOnly, t]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : t('Could not save the design.')); }
    finally { setBusy(false); }
  }

  if (store.loading) return <p className="text-sm text-muted-foreground">{t('Loading the design…')}</p>;
  const locked = busy || !!host.readOnly || !!store.error;
  const showComposer = editing || !store.current || !!store.draft;

  return <div className="space-y-3">
    <WidgetHeaderAction>
      {store.current && !store.draft && <Button variant="ghost" size="sm" disabled={locked} onClick={() => setEditing(v => !v)}>{editing ? t('Close') : t('Revise with AI')}</Button>}
      {store.current && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('Design actions')}><MoreHorizontal size={14} /></Button></DropdownMenuTrigger>
        <MenuShell as="dropdown" align="end">
          <DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(designHandoff(store.current!)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{t('Copy HTML and CSS')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => download(store.current!)}>{t('Download as HTML')}</DropdownMenuItem>
          {store.previous && <DropdownMenuItem disabled={locked} onSelect={() => void run(() => store.restore())}>{t('Bring back the previous design')}</DropdownMenuItem>}
        </MenuShell>
      </DropdownMenu>}
    </WidgetHeaderAction>

    {shown && <DesignFrame design={shown} label={store.draft ? t('Preview: {title}', { title: shown.title }) : shown.title} />}
    {copied && <p role="status" className="text-xs text-muted-foreground">{t('Copied.')}</p>}

    {store.draft && <div className="flex flex-wrap items-center gap-2">
      <p className="mr-auto text-xs text-muted-foreground">{t('Preview · only you see this until you use it. It then replaces the design for everyone.')}</p>
      <Button variant="primary" size="sm" disabled={locked} onClick={() => void run(async () => { await store.adopt(); setEditing(false); setPrompt(''); lastSaved.current = ''; })}>{t('Use this design')}</Button>
      <Button variant="ghost" size="sm" disabled={locked} onClick={() => void run(() => store.discard())}>{t('Discard preview')}</Button>
    </div>}

    {showComposer && !host.readOnly && <form onSubmit={e => { e.preventDefault(); void run(() => store.generate(prompt)); }}>
      {!shown && <p className="mb-2 text-sm text-muted-foreground">{t('Describe a screen, a card, a slide visual or a diagram. AI draws it in HTML and SVG at a fixed size; you can revise it by describing what to change.')}</p>}
      <TextComposer aria-label={t('Describe the design')} rows={3} maxLength={8000} value={prompt} disabled={locked} onChange={e => setPrompt(e.target.value)}
        placeholder={shown ? t('Example: Make the headline larger, move the price under it, and use the accent colour for the button.') : t('Example: A 1200 × 800 pricing section with three plans, the middle one highlighted.')}
        hint={t('Uses AI when you generate')}
        action={<Button type="submit" variant="primary" size="sm" disabled={locked || !prompt.trim()}>{busy ? t('Working…') : shown ? t('Generate revision') : t('Generate design')}</Button>}
      />
    </form>}

    {(error || store.error) && <div role="alert" className="space-y-1 text-sm text-destructive">
      <p>{error ?? store.error}</p>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { const result = await store.reload(); if (result.error) throw result.error; })}>{t('Reload saved design')}</Button>
    </div>}
    {host.readOnly && !shown && <p className="text-sm text-muted-foreground">{t('No design yet.')}</p>}
  </div>;
}
