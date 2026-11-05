'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { CARD, FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { createDefinition, deleteDefinition, updateDefinition, useDefinitions, type Definition } from '@/hooks/definitionData';
import { useCatalog, type CatalogDefinition } from '@/hooks/customizeData';
import { YoursDiscover, type CustomizeMode } from './YoursDiscover';
import { TryDefinition } from './TryDefinition';

// Settings › Customize › Definitions: how work is to be carried out, as
// Markdown the engine follows (the goal, the loop, stop rules, the output's
// shape). Yours is the Space's library, shared by its members; Discover is
// the catalog Alcon offers to start from, added by copying into the library.
// Try runs one from the library once, as an Element under a chosen Object.

export function DefinitionsPanel() {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const library = useDefinitions(spaceId);
  const catalog = useCatalog();
  const [mode, setMode] = useState<CustomizeMode>('yours');
  const [editing, setEditing] = useState<Definition | 'new' | null>(null);
  const [preview, setPreview] = useState<CatalogDefinition | null>(null);
  const [trying, setTrying] = useState<Definition | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const added = new Set(library.data.map((d) => d.source_id).filter(Boolean));

  const add = async (item: CatalogDefinition) => {
    if (!spaceId) return;
    setBusy(item.id); setError(null);
    try {
      await createDefinition({ spaceId, name: item.name, body: item.body, sourceId: item.id });
      await library.refetch();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`${FONT.lg} text-foreground`}>{t('Definitions')}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">{t('How work is carried out: the goal, the steps or loop, when to stop and the shape of the result. A Strategy or an Element names one, and agents follow it.')}</p>
        </div>
        <div className="flex items-center gap-2">
          <YoursDiscover mode={mode} onChange={setMode} />
          {mode === 'yours' && <Button size="sm" variant="secondary" onClick={() => setEditing('new')} disabled={!spaceId}>{t('New definition')}</Button>}
        </div>
      </div>
      {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}

      {mode === 'yours' ? (
        library.loading ? <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
          : library.data.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">{t('This Space has no definitions yet. Add one from Discover or write a new one.')}</p>
          ) : (
            <div>
              {library.data.map((d) => (
                <div key={d.id} className="-mx-2 flex w-[calc(100%+16px)] items-center gap-2 rounded-md px-2 transition-colors hover:bg-[var(--surface-strong)]">
                  <button type="button" onClick={() => setEditing(d)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left outline-none focus-visible:underline">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-foreground">{d.name}</div>
                      <div className="truncate text-[12px] text-muted-foreground">{firstLine(d.body)}</div>
                    </div>
                    {d.source_id && <span className="shrink-0 text-[11px] text-muted-foreground">{t('From the catalog')}</span>}
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{d.updated_at.slice(0, 10)}</span>
                  </button>
                  <Button size="xs" variant="ghost" onClick={() => setTrying(d)}>{t('Try')}</Button>
                </div>
              ))}
            </div>
          )
      ) : catalog.loading ? <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {catalog.definitions.map((item) => (
            <div key={item.id} className={`${CARD} flex flex-col gap-2 p-4`}>
              <div className="text-[13px] font-semibold text-foreground">{item.name}</div>
              <p className="line-clamp-2 text-[12px] text-muted-foreground">{item.description}</p>
              <div className="mt-auto flex items-center gap-2 pt-1">
                <Button size="xs" variant="ghost" onClick={() => setPreview(item)}>{t('Preview')}</Button>
                {added.has(item.id)
                  ? <span className="ml-auto text-[11px] text-[var(--status-success)]">{t('Added')}</span>
                  : <Button size="xs" variant="secondary" className="ml-auto" onClick={() => void add(item)} disabled={busy !== null || !spaceId}>{busy === item.id ? t('Adding…') : t('Add')}</Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <Dialog open onOpenChange={(o) => { if (!o) setPreview(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{preview.name}</DialogTitle></DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto text-[13px]"><MarkdownLite text={preview.body} /></div>
            <DialogFooter>
              {added.has(preview.id)
                ? <span className="text-[12px] text-[var(--status-success)]">{t('Added')}</span>
                : <Button size="sm" onClick={() => void add(preview).then(() => setPreview(null))} disabled={busy !== null}>{t('Add')}</Button>}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {trying && <TryDefinition definition={trying} onClose={() => setTrying(null)} />}

      {editing && spaceId && (
        <DefinitionEditor spaceId={spaceId} definition={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { void library.refetch(); setEditing(null); }} />
      )}
    </div>
  );
}

function firstLine(body: string): string {
  return body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? '';
}

function DefinitionEditor({ spaceId, definition, onClose, onSaved }: { spaceId: string; definition: Definition | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(definition?.name ?? '');
  const [body, setBody] = useState(definition?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await f(); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  const save = () => run(() => (definition
    ? updateDefinition(definition.id, { name: name.trim(), body })
    : createDefinition({ spaceId, name, body })));
  const remove = () => {
    if (!definition || !window.confirm(t('Delete “{name}”? Strategies and Elements that follow it will follow none.', { name: definition.name }))) return;
    void run(() => deleteDefinition(definition.id));
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{definition ? t('Edit definition') : t('New definition')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name')} className="h-8 text-[13px] md:text-[13px]" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={16} spellCheck={false} className="font-mono text-[12px]"
            placeholder={'# 目的\n…\n# 進め方\n1. …\n# 止める条件\n- …\n# 成果物の型\n```md\n# …\n```'} />
          {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
        </div>
        <DialogFooter>
          {definition && <Button variant="ghost" size="sm" className="mr-auto text-[var(--status-danger)]" onClick={remove} disabled={busy}>{t('Delete')}</Button>}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || !name.trim() || !body.trim()}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
