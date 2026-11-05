'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { createDefinition, updateDefinition, useDefinitions } from '@/hooks/definitionData';
import { DEFINITION_EXAMPLE, definitionParts, type DefinitionPart } from './definitionParts';

// The Strategy's definition on its Execution tab: which one its Elements
// follow (from the Space's library), what the engine will act on in it, and a
// box to paste a new one. Pasting is the whole authoring step — the headings
// do the rest.

const PART_LABEL: Record<DefinitionPart, string> = {
  goal: 'Goal', conditions: 'Conditions', metric: 'Metric (a loop)', procedure: 'Procedure',
  stop: 'Stop rules', checks: 'Checks', output: 'Output shape',
};

const NONE = '__none';

export function DefinitionPanel({ spaceId, definitionId, canEdit, onChange }: {
  spaceId: string | null;
  definitionId: string | null;
  canEdit: boolean;
  onChange: (definitionId: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const library = useDefinitions(spaceId);
  const current = library.data.find((d) => d.id === definitionId) ?? null;
  const [mode, setMode] = useState<'view' | 'paste' | 'edit'>('view');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startPaste = () => { setName(''); setBody(''); setError(null); setMode('paste'); };
  const startEdit = () => { if (!current) return; setName(current.name); setBody(current.body); setError(null); setMode('edit'); };

  const save = async () => {
    if (!spaceId || !name.trim() || !body.trim()) return;
    setBusy(true); setError(null);
    try {
      if (mode === 'edit' && current) {
        await updateDefinition(current.id, { name: name.trim(), body });
      } else {
        const created = await createDefinition({ spaceId, name, body });
        await onChange(created.id);
      }
      await library.refetch();
      setMode('view'); setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const parts = current ? definitionParts(current.body) : [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
        <span className="w-36 shrink-0">{t('Definition')}</span>
        <OptionMenu label={t('Definition')} value={definitionId ?? NONE} disabled={!canEdit || busy}
          onChange={(v) => void onChange(v === NONE ? null : v)}
          options={[{ value: NONE, label: t('None — the agent decides how') }, ...library.data.map((d) => ({ value: d.id, label: d.name }))]} />
        {current && (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setOpen((o) => !o)}>
            {open ? t('Hide') : t('Show')}
          </Button>
        )}
        {canEdit && current && mode === 'view' && <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={startEdit}>{t('Edit')}</Button>}
        {canEdit && mode === 'view' && <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={startPaste}>{t('Paste a new definition')}</Button>}
      </div>

      {current && mode === 'view' && open && (
        <div className="flex flex-wrap gap-1">
          {parts.length === 0
            ? <span className="text-[12px] text-muted-foreground">{t('No known headings — the agent reads it as instructions.')}</span>
            : parts.map((p) => (
              <span key={p} className="rounded-md border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">{t(PART_LABEL[p])}</span>
            ))}
        </div>
      )}
      {current && mode === 'view' && open && (
        <div className="max-h-96 overflow-auto rounded-md bg-muted/20 px-3 py-2">
          <MarkdownLite text={current.body} className="space-y-2 text-[13px] leading-[1.6]" />
        </div>
      )}

      {mode !== 'view' && (
        <div className="space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name (e.g. Property search report)')}
            className="w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-[13px] outline-none focus:bg-muted/30" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder={DEFINITION_EXAMPLE}
            className="w-full resize-y rounded-md border border-border/60 bg-transparent px-2 py-1.5 font-mono text-[12px] leading-5 outline-none focus:bg-muted/30" />
          {body.trim() && (
            <div className="flex flex-wrap gap-1">
              {definitionParts(body).map((p) => (
                <span key={p} className="rounded-md border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">{t(PART_LABEL[p])}</span>
              ))}
            </div>
          )}
          {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode('view')} disabled={busy}>{t('Cancel')}</Button>
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy || !name.trim() || !body.trim()}>
              {mode === 'edit' ? t('Save') : t('Save and use for this Strategy')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
