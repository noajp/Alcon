'use client';

import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DateField } from '@/Function/shared/date';
import type { useTableData, TableData } from '@/hooks/useTableData';
import { displayCell, parseCell } from '@/Function/widget/widgets/dataViewModel';
import type { Json } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT } from '@/shared/designTokens';
import { OPERATIONS_FIELDS, type OperationsParams } from '@/Function/operations/operationsModel';
import { OPERATIONS_INPUT, OperationsChoice } from './OperationsSetup';

type Source = ReturnType<typeof useTableData>;

/** A stage as people read it: the three outcomes in the reader's language, anything else as written. */
function stageText(stage: string, t: (message: string) => string): string {
  const key = stage.trim().toLowerCase();
  return key === 'open' ? t('Open') : key === 'won' ? t('Won') : key === 'lost' ? t('Lost') : stage.replace(/^./, letter => letter.toUpperCase());
}

const EDITOR_SECTIONS = [
  { title: 'Opportunity', keys: ['name', 'account', 'stage'] },
  { title: 'Value and timing', keys: ['amount', 'currency', 'probability', 'closeDate'] },
  { title: 'Next contact', keys: ['lastContact', 'nextActionDate'] },
];

/** Drafts survive a failed write; a partially created row is reused on retry. */
function RecordEditor({ data, source, params, rowId, onClose, onNext }: {
  data: TableData; source: Source; params: OperationsParams; rowId: string | null;
  onClose: () => void; onNext: () => void;
}) {
  const { t } = useI18n();
  const seenColumns = new Set<string>();
  const fields = OPERATIONS_FIELDS.flatMap(field => {
    const column = data.columns.find(item => item.id === params.fields[field.key]);
    if (!column || seenColumns.has(column.id)) return [];
    seenColumns.add(column.id);
    return [{ ...field, column }];
  });
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(field => [field.column.id, rowId ? displayCell(data.cellsByRow[rowId]?.[field.column.id]) : ''])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createMore, setCreateMore] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const initialDraft = useRef(draft);
  const savedRow = useRef(rowId);
  const lock = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stage = draft[params.fields.stage];
  function change(columnId: string, value: string) {
    setDraft(current => ({ ...current, [columnId]: value }));
    setConfirmDiscard(false);
  }
  function requestClose() {
    if (lock.current) return;
    if (fields.some(field => draft[field.column.id] !== initialDraft.current[field.column.id])) setConfirmDiscard(true);
    else onClose();
  }
  function requiredForAnalysis(key: string, required: boolean) {
    if (['probability', 'closeDate'].includes(key)) return stage === 'open';
    return required;
  }

  async function save() {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    setConfirmDiscard(false);
    try {
      const values: [string, Json | null][] = fields.map(field => [field.column.id, parseCell(draft[field.column.id] ?? '', field.column.type)]);
      if (!values.some(([, value]) => value !== null)) throw new Error(t('Enter at least one value.'));
      if (!savedRow.current) savedRow.current = (await source.createRow()).id;
      await source.setCells(savedRow.current, Object.fromEntries(values));
      if (!rowId && createMore) {
        savedRow.current = null;
        const next = Object.fromEntries(fields.map(field => [field.column.id, ['stage', 'currency'].includes(field.key) ? draft[field.column.id] : '']));
        initialDraft.current = next;
        setDraft(next);
        setSavedCount(current => current + 1);
        requestAnimationFrame(() => inputRef.current?.focus());
        onNext();
      } else onClose();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t('Could not save the record.'));
    } finally { lock.current = false; setSaving(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
    <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
        <div className="space-y-2">
          <DialogTitle>{rowId ? t('Edit opportunity') : t('Add opportunity')}</DialogTitle>
          <DialogDescription>{t('Keep the value, expected close, and next contact together.')}</DialogDescription>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t('Close opportunity editor')} disabled={saving} onClick={requestClose}><X size={14} /></Button>
      </div>
      <form className="flex min-h-0 flex-col" aria-label={rowId ? t('Edit opportunity') : t('New opportunity')} onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="min-h-0 space-y-5 overflow-y-auto border-y border-[var(--border-subtle)] px-5 py-5 sm:px-6">
          {EDITOR_SECTIONS.map(section => {
            const visibleFields = fields.filter(field => section.keys.includes(field.key));
            if (!visibleFields.length) return null;
            return <fieldset key={section.title} className="space-y-3">
              <legend className="text-sm font-medium">{t(section.title)}</legend>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {visibleFields.map(field => <label key={field.column.id} className="min-w-0 space-y-1">
                  <span className="block text-xs text-muted-foreground">{field.key === 'stage' ? t('Stage') : t(field.label)}{requiredForAnalysis(field.key, field.required) && <span aria-label={t('Required for analysis')}> *</span>}</span>
                  {field.column.type === 'date'
                    ? <DateField aria-label={t(field.label)} value={draft[field.column.id] || null} onChange={value => change(field.column.id, value ?? '')} disabled={saving} block />
                    : field.key === 'stage'
                      ? <OperationsChoice label={t(field.label)} value={draft[field.column.id] || ''} disabled={saving}
                          options={[{ id: '', label: t('Set stage…') }, { id: 'open', label: t('Open') }, { id: 'won', label: t('Won') }, { id: 'lost', label: t('Lost') },
                            ...(!['', 'open', 'won', 'lost'].includes(draft[field.column.id] ?? '') ? [{ id: draft[field.column.id], label: draft[field.column.id] }] : [])]}
                          onChange={value => change(field.column.id, value)} />
                      : <input ref={field === fields[0] ? inputRef : undefined} autoFocus={field === fields[0]} aria-label={t(field.label)} className={OPERATIONS_INPUT}
                          inputMode={field.column.type === 'number' ? 'decimal' : undefined} placeholder={field.key === 'currency' ? t('e.g. JPY') : t(field.label)}
                          value={draft[field.column.id] ?? ''} disabled={saving} onChange={event => change(field.column.id, event.target.value)} />}
                </label>)}
              </div>
            </fieldset>;
          })}
          <p className="text-xs text-muted-foreground">{fields.length ? t('* Needed for analysis. You can save an incomplete entry and finish it later.') : t('Connect fields in Data settings before adding entries.')}</p>
          {error && <p role="alert" className="text-sm text-destructive">{error} {t('Your draft is retained. Retry completes this opportunity without creating a duplicate.')}</p>}
          {savedCount > 0 && <p role="status" className="text-xs text-muted-foreground">{t('{n} opportunities saved. Ready for another.', { n: savedCount })}</p>}
        </div>
        <div className="space-y-3 px-5 py-4 sm:px-6">
          {confirmDiscard ? <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-sm">{t('Discard unsaved changes?')}</p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirmDiscard(false)}>{t('Keep editing')}</Button>
              <Button type="button" variant="secondary" onClick={onClose}>{t('Discard changes')}</Button>
            </div>
          </div> : <div className="flex flex-wrap items-center justify-between gap-3">
            {!rowId && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={createMore} disabled={saving} onChange={event => setCreateMore(event.target.checked)} />{t('Add another after saving')}</label>}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" disabled={saving} onClick={requestClose}>{t('Cancel')}</Button>
              <Button type="submit" variant="primary" disabled={saving || !fields.length}>{saving ? t('Saving…') : error ? t('Retry save') : t('Save opportunity')}</Button>
            </div>
          </div>}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function OperationsRecords({ data, source, params, selectedRow, onSelect, showList = true }: {
  data: TableData; source: Source; params: OperationsParams;
  selectedRow: string | null | undefined; onSelect: (row: string | null | undefined) => void;
  showList?: boolean;
}) {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(25);
  const [savedCount, setSavedCount] = useState(0);
  const title = t('Opportunities');
  const secondary = 'account';
  const value = (rowId: string, key: string) => {
    const cell = data.cellsByRow[rowId]?.[params.fields[key]];
    return typeof cell === 'number' ? cell.toLocaleString(locale, { maximumSignificantDigits: 21 }) : displayCell(cell);
  };
  const rows = data.rows.map((row, index) => ({ row, name: value(row.id, 'name') || t('Row {n}', { n: index + 1 }) }));
  const filtered = rows.filter(({ row, name }) => [name, value(row.id, secondary)].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    {selectedRow !== undefined && <RecordEditor key={`${selectedRow ?? 'new'}:${JSON.stringify(params.fields)}`} data={data} source={source} params={params} rowId={selectedRow} onClose={() => onSelect(undefined)} onNext={() => setSavedCount(current => current + 1)} />}
    {showList && <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className={`${FONT.lg} text-foreground`}>{title} <span className="ml-1 text-muted-foreground">{data.rows.length}</span></h3>
      <input aria-label={t('Find opportunities')} placeholder={t('Find opportunity or account…')} className={`${OPERATIONS_INPUT} max-w-64`} value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(25); }} />
    </div>
    {savedCount > 0 && <p role="status" className="text-xs text-muted-foreground">{t('{n} opportunities created.', { n: savedCount })}</p>}
    {filtered.length > 0 && <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label={title}>
        <thead className="border-b border-[var(--border-subtle)] text-xs text-muted-foreground"><tr>
          {['Opportunity / account', 'Stage', 'Amount', 'Close date', 'Next contact'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-2 font-medium first:pl-0 last:pr-0">{t(label)}</th>)}
        </tr></thead>
        <tbody>{filtered.slice(0, visibleCount).map(({ row, name }) => <tr key={row.id} className="hover:bg-muted/40">
          <td className="min-w-40 max-w-72 py-3 pr-3">
            <Button variant="ghost" size="sm" align="start" className="h-auto max-w-full px-0 py-0.5" disabled={selectedRow !== undefined} aria-label={t('Edit {name}', { name })} onClick={() => onSelect(row.id)}><span className="truncate">{name}</span></Button>
            <p className="truncate text-xs text-muted-foreground">{value(row.id, secondary) || '—'}</p>
          </td>
          {[stageText(value(row.id, 'stage'), t), [value(row.id, 'currency'), value(row.id, 'amount')].filter(Boolean).join(' '), value(row.id, 'closeDate'), value(row.id, 'nextActionDate')].map((cell, index) => <td key={index} className="whitespace-nowrap px-3 py-3 tabular-nums last:pr-0">{cell || '—'}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
    {!filtered.length && <p className="py-4 text-sm text-muted-foreground">{data.rows.length ? t('No opportunities match this search.') : t('Add your first opportunity to start planning follow-ups.')}</p>}
    {filtered.length > visibleCount && <Button variant="ghost" onClick={() => setVisibleCount(count => count + 25)}>{t('Show more ({n} remaining)', { n: filtered.length - visibleCount })}</Button>}
    </section>}
  </>;
}
