'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { CARD, FONT } from '@/shared/designTokens';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { useIntegrations, useIsSpaceOwner } from '@/AIP/connectors/data';
import { presetById } from '@/AIP/connectors/catalog';
import { createDefinition, deleteDefinition, updateDefinition, useDefinitions, useSpaceDefaultHarness, type Definition } from '@/hooks/definitionData';
import { useCatalog, type CatalogDefinition } from '@/hooks/customizeData';
import { checkHarness, parseDefinition, type Diagnostic } from './harnessDefinition';
import { YoursDiscover, type CustomizeMode } from './YoursDiscover';
import { TryDefinition } from './TryDefinition';

// Settings › AI › Harnesses: how a kind of work is carried out by AI — the
// goal, the steps or loop, where it stops, the result's shape, the
// connectors it uses and, for a Strategy, how it is broken down. Yours is the
// Space's library, shared by its members; one of them may be the Space's
// default, which Strategies are worked by when they name none (otherwise
// Alcon's built-in way). Discover is the catalog Alcon offers to start from,
// added by copying into the library. Every harness is checked as it is
// written (checkHarness), against the Space's connections.

/** Names a harness may call a connected service by: what the Space named it, and its preset's id and name. */
function useConnectedNames(spaceId: string | null): string[] {
  const { data } = useIntegrations(spaceId);
  return useMemo(() => data.flatMap((i) => [i.name, i.preset ?? '', presetById(i.preset)?.name ?? ''].filter(Boolean)), [data]);
}

export function HarnessesPanel() {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const library = useDefinitions(spaceId);
  const catalog = useCatalog();
  const fallback = useSpaceDefaultHarness(spaceId);
  const isOwner = useIsSpaceOwner(spaceId) === true;
  const connected = useConnectedNames(spaceId);
  const [mode, setMode] = useState<CustomizeMode>('yours');
  const [editing, setEditing] = useState<Definition | 'new' | null>(null);
  const [preview, setPreview] = useState<CatalogDefinition | null>(null);
  const [trying, setTrying] = useState<Definition | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const added = new Set(library.data.map((d) => d.source_id).filter(Boolean));
  const defaultHarness = library.data.find((d) => d.id === fallback.data) ?? null;

  const act = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id); setError(null);
    try { await f(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };
  const add = (item: CatalogDefinition) => act(item.id, async () => {
    if (!spaceId) return;
    await createDefinition({ spaceId, name: item.name, body: item.body, sourceId: item.id });
    await library.refetch();
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`${FONT.lg} text-foreground`}>{t('Harnesses')}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">{t('How AI carries out a kind of work: the goal, the steps, where it stops and asks, the shape of the result and the connectors it uses.')}</p>
        </div>
        <div className="flex items-center gap-2">
          <YoursDiscover mode={mode} onChange={setMode} />
          {mode === 'yours' && <Button size="sm" variant="secondary" onClick={() => setEditing('new')} disabled={!spaceId}>{t('New harness')}</Button>}
        </div>
      </div>

      <div className="rounded-md bg-[var(--surface-strong)] px-3 py-2 text-[12px] text-foreground">
        {defaultHarness
          ? t('Strategies are worked by “{name}” unless they name another harness.', { name: defaultHarness.name })
          : t('Strategies are worked by Alcon’s built-in way. To change how they are broken down, add “Strategy の進め方” from Discover, edit it and make it the default.')}
      </div>
      {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}

      {mode === 'yours' ? (
        library.loading ? <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
          : library.data.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">{t('This Space has no harnesses yet. Add one from Discover or write a new one.')}</p>
          ) : (
            <div>
              {library.data.map((d) => {
                const isDefault = d.id === fallback.data;
                return (
                  <div key={d.id} className="-mx-2 flex w-[calc(100%+16px)] items-center gap-2 rounded-md px-2 transition-colors hover:bg-[var(--surface-strong)]">
                    <button type="button" onClick={() => setEditing(d)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left outline-none focus-visible:underline">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground">{d.name}</span>
                          {isDefault && <span className="shrink-0 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-[var(--text-secondary)]">{t('Default')}</span>}
                        </div>
                        <div className="truncate text-[12px] text-muted-foreground">{firstLine(d.body)}</div>
                      </div>
                      <CheckSummary diagnostics={checkHarness(parseDefinition(d.body), { connected })} />
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{d.updated_at.slice(0, 10)}</span>
                    </button>
                    {isOwner && (
                      <Button size="xs" variant="ghost" disabled={busy !== null}
                        onClick={() => void act(d.id, () => fallback.set(isDefault ? null : d.id))}>
                        {isDefault ? t('Stop using as default') : t('Make default')}
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" onClick={() => setTrying(d)}>{t('Try')}</Button>
                  </div>
                );
              })}
            </div>
          )
      ) : catalog.loading ? <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {catalog.definitions.map((item) => (
            <div key={item.id} className={`${CARD} flex flex-col gap-2 p-4`}>
              <div className="text-[13px] font-semibold text-foreground">{item.name}</div>
              <p className="line-clamp-2 text-[12px] text-muted-foreground">{item.description}</p>
              <ConnectorChips names={parseDefinition(item.body).connectors} connected={connected} />
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
        <HarnessEditor spaceId={spaceId} definition={editing === 'new' ? null : editing} connected={connected}
          onClose={() => setEditing(null)} onSaved={() => { void library.refetch(); setEditing(null); }} />
      )}
    </div>
  );
}

function firstLine(body: string): string {
  return body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? '';
}

/** The connectors a catalog harness uses, marked by whether the Space has them. */
function ConnectorChips({ names, connected }: { names: string[]; connected: string[] }) {
  const { t } = useI18n();
  if (!names.length) return null;
  const have = new Set(connected.map((c) => c.trim().toLowerCase().replace(/\s+/g, '')));
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-muted-foreground">{t('Uses')}</span>
      {names.map((n) => (
        <span key={n} className={cn('rounded-full border border-[var(--border-default)] px-1.5 text-[11px]',
          have.has(n.toLowerCase().replace(/\s+/g, '')) ? 'text-[var(--text-secondary)]' : 'text-muted-foreground')}>
          {n}
        </span>
      ))}
    </div>
  );
}

/** A row's count of problems: errors, then warnings. Nothing when clean. */
function CheckSummary({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const { t } = useI18n();
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  if (!errors && !warnings) return null;
  return (
    <span className={cn('shrink-0 text-[11px]', errors ? 'text-[var(--status-danger)]' : 'text-[var(--status-warning)]')}>
      {errors ? t('Problems: {count}', { count: errors }) : t('Warnings: {count}', { count: warnings })}
    </span>
  );
}

const SEVERITY_CLASS: Record<Diagnostic['severity'], string> = {
  error: 'text-[var(--status-danger)]',
  warning: 'text-[var(--status-warning)]',
  hint: 'text-muted-foreground',
};

/** What the check found, as the person writes: each finding with how to fix it. */
function Diagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const { t } = useI18n();
  if (!diagnostics.length) return <p className="text-[12px] text-[var(--status-success)]">{t('No problems found.')}</p>;
  const label: Record<Diagnostic['severity'], string> = { error: t('Problem'), warning: t('Warning'), hint: t('Hint') };
  return (
    <ul className="space-y-1.5" aria-label={t('Check')}>
      {diagnostics.map((d, i) => (
        <li key={`${d.code}-${i}`} className="text-[12px] leading-relaxed">
          <span className={cn('mr-1.5 font-medium', SEVERITY_CLASS[d.severity])}>{label[d.severity]}</span>
          <span className="text-foreground">{d.message}</span>
          {d.fix && <span className="block text-muted-foreground">{d.fix}</span>}
        </li>
      ))}
    </ul>
  );
}

function HarnessEditor({ spaceId, definition, connected, onClose, onSaved }: {
  spaceId: string; definition: Definition | null; connected: string[]; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(definition?.name ?? '');
  const [body, setBody] = useState(definition?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diagnostics = useMemo(() => checkHarness(parseDefinition(body), { connected }), [body, connected]);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await f(); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  const save = () => run(() => (definition
    ? updateDefinition(definition.id, { name: name.trim(), body })
    : createDefinition({ spaceId, name, body })));
  const remove = () => {
    if (!definition || !window.confirm(t('Delete “{name}”? Strategies and Elements that follow it go back to the Space’s default.', { name: definition.name }))) return;
    void run(() => deleteDefinition(definition.id));
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{definition ? t('Edit harness') : t('New harness')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name')} className="h-8 text-[13px] md:text-[13px]" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} spellCheck={false} className="font-mono text-[12px]"
            placeholder={'# 目的\n…\n# 進め方\n1. …\n# 止める条件\n- …\n# 使うコネクタ\n- GitHub\n# 成果物の型\n```md\n# …\n```'} />
          {body.trim() && <Diagnostics diagnostics={diagnostics} />}
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
