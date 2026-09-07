'use client';

import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DateField } from '@/alcon/shared/date';
import type { useWidgetTableData, WidgetTableData } from '@/hooks/useWidgetTableData';
import { displayCell, parseCell } from '@/alcon/widget/widgets/dataViewModel';
import type { Json } from '@/types/database';
import { OPERATIONS_FIELDS, type OperationsParams } from './operationsModel';
import { OPERATIONS_INPUT, OperationsChoice } from './OperationsSetup';

type Source = ReturnType<typeof useWidgetTableData>;

const EDITOR_SECTIONS = {
  crm: [
    { title: 'Opportunity', keys: ['name', 'account', 'stage'] },
    { title: 'Value and timing', keys: ['amount', 'currency', 'probability', 'closeDate'] },
    { title: 'Next contact', keys: ['lastContact', 'nextActionDate'] },
  ],
  scm: [
    { title: 'Item and stock', keys: ['name', 'supplier', 'onHand', 'dailyDemand', 'safetyStock'] },
    { title: 'Incoming supply', keys: ['leadTimeDays', 'onOrder', 'arrivalDate'] },
    { title: 'Purchase cost', keys: ['unitCost', 'currency'] },
  ],
};

/** Drafts survive a failed write; a partially created row is reused on retry. */
function RecordEditor({ data, source, params, rowId, onClose, onNext }: {
  data: WidgetTableData; source: Source; params: OperationsParams; rowId: string | null;
  onClose: () => void; onNext: () => void;
}) {
  const seenColumns = new Set<string>();
  const fields = OPERATIONS_FIELDS[params.kind].flatMap(field => {
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
  const noun = params.kind === 'crm' ? 'opportunity' : 'item';
  const stage = draft[params.fields.stage];
  const onOrder = Number(draft[params.fields.onOrder]);
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
    if (params.kind === 'crm' && ['probability', 'closeDate'].includes(key)) return stage === 'open';
    if (params.kind === 'scm' && key === 'arrivalDate') return onOrder > 0;
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
      if (!values.some(([, value]) => value !== null)) throw new Error('Enter at least one value.');
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
      setError(cause instanceof Error ? cause.message : 'Could not save the record.');
    } finally { lock.current = false; setSaving(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
    <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
        <div className="space-y-2">
          <DialogTitle>{rowId ? 'Edit' : 'Add'} {noun}</DialogTitle>
          <DialogDescription>{params.kind === 'crm' ? 'Keep the value, expected close, and next contact together.' : 'Record stock, demand, and incoming supply to plan replenishment.'}</DialogDescription>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Close ${noun} editor`} disabled={saving} onClick={requestClose}><X size={14} /></Button>
      </div>
      <form className="flex min-h-0 flex-col" aria-label={`${rowId ? 'Edit' : 'New'} ${noun}`} onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="min-h-0 space-y-5 overflow-y-auto border-y border-[var(--border-subtle)] px-5 py-5 sm:px-6">
          {EDITOR_SECTIONS[params.kind].map(section => {
            const visibleFields = fields.filter(field => section.keys.includes(field.key));
            if (!visibleFields.length) return null;
            return <fieldset key={section.title} className="space-y-3">
              <legend className="text-sm font-medium">{section.title}</legend>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                {visibleFields.map(field => <label key={field.column.id} className="min-w-0 space-y-1">
                  <span className="block text-xs text-muted-foreground">{field.key === 'stage' ? 'Stage' : field.label}{requiredForAnalysis(field.key, field.required) && <span aria-label="Required for analysis"> *</span>}</span>
                  {field.column.type === 'date'
                    ? <DateField aria-label={field.label} value={draft[field.column.id] || null} onChange={value => change(field.column.id, value ?? '')} disabled={saving} block />
                    : params.kind === 'crm' && field.key === 'stage'
                      ? <OperationsChoice label={field.label} value={draft[field.column.id] || ''} disabled={saving}
                          options={[{ id: '', label: 'Set stage…' }, { id: 'open', label: 'Open' }, { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' },
                            ...(!['', 'open', 'won', 'lost'].includes(draft[field.column.id] ?? '') ? [{ id: draft[field.column.id], label: draft[field.column.id] }] : [])]}
                          onChange={value => change(field.column.id, value)} />
                      : <input ref={field === fields[0] ? inputRef : undefined} autoFocus={field === fields[0]} aria-label={field.label} className={OPERATIONS_INPUT}
                          inputMode={field.column.type === 'number' ? 'decimal' : undefined} placeholder={field.key === 'currency' ? 'e.g. JPY' : field.label}
                          value={draft[field.column.id] ?? ''} disabled={saving} onChange={event => change(field.column.id, event.target.value)} />}
                </label>)}
              </div>
            </fieldset>;
          })}
          <p className="text-xs text-muted-foreground">{fields.length ? '* Needed for analysis. You can save an incomplete entry and finish it later.' : 'Connect fields in Data settings before adding entries.'}</p>
          {error && <p role="alert" className="text-sm text-destructive">{error} Your draft is retained. Retry completes this {noun} without creating a duplicate.</p>}
          {savedCount > 0 && <p role="status" className="text-xs text-muted-foreground">{savedCount} {savedCount === 1 ? noun : params.kind === 'crm' ? 'opportunities' : 'items'} saved. Ready for another.</p>}
        </div>
        <div className="space-y-3 px-5 py-4 sm:px-6">
          {confirmDiscard ? <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-sm">Discard unsaved changes?</p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
              <Button type="button" variant="secondary" onClick={onClose}>Discard changes</Button>
            </div>
          </div> : <div className="flex flex-wrap items-center justify-between gap-3">
            {!rowId && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={createMore} disabled={saving} onChange={event => setCreateMore(event.target.checked)} />Add another after saving</label>}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" disabled={saving} onClick={requestClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving || !fields.length}>{saving ? 'Saving…' : error ? 'Retry save' : `Save ${noun}`}</Button>
            </div>
          </div>}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function OperationsRecords({ data, source, params, selectedRow, onSelect, showList = true }: {
  data: WidgetTableData; source: Source; params: OperationsParams;
  selectedRow: string | null | undefined; onSelect: (row: string | null | undefined) => void;
  showList?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(25);
  const [savedCount, setSavedCount] = useState(0);
  const isCRM = params.kind === 'crm';
  const title = isCRM ? 'Opportunities' : 'Inventory';
  const secondary = isCRM ? 'account' : 'supplier';
  const value = (rowId: string, key: string) => {
    const cell = data.cellsByRow[rowId]?.[params.fields[key]];
    return typeof cell === 'number' ? cell.toLocaleString(undefined, { maximumSignificantDigits: 21 }) : displayCell(cell);
  };
  const rows = data.rows.map((row, index) => ({ row, name: value(row.id, 'name') || `Row ${index + 1}` }));
  const filtered = rows.filter(({ row, name }) => [name, value(row.id, secondary)].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    {selectedRow !== undefined && <RecordEditor key={`${selectedRow ?? 'new'}:${JSON.stringify(params.fields)}`} data={data} source={source} params={params} rowId={selectedRow} onClose={() => onSelect(undefined)} onNext={() => setSavedCount(current => current + 1)} />}
    {showList && <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">{title} <span className="ml-1 text-muted-foreground">{data.rows.length}</span></h3>
      <input aria-label={`Find ${isCRM ? 'opportunities' : 'items'}`} placeholder={isCRM ? 'Find opportunity or account…' : 'Find item or supplier…'} className={`${OPERATIONS_INPUT} max-w-64`} value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(25); }} />
    </div>
    {savedCount > 0 && <p role="status" className="text-xs text-muted-foreground">{savedCount} {isCRM ? 'opportunities' : 'items'} created.</p>}
    {filtered.length > 0 && <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label={title}>
        <thead className="text-xs text-muted-foreground"><tr>
          {(isCRM ? ['Opportunity / account', 'Stage', 'Amount', 'Close date', 'Next contact'] : ['Item / supplier', 'On hand', 'Daily demand', 'On order', 'Expected arrival']).map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-2 font-medium first:pl-0 last:pr-0">{label}</th>)}
        </tr></thead>
        <tbody>{filtered.slice(0, visibleCount).map(({ row, name }) => <tr key={row.id} className="border-t border-[var(--border-subtle)]">
          <td className="min-w-40 max-w-72 py-3 pr-3">
            <Button variant="ghost" size="sm" align="start" className="h-auto max-w-full px-0 py-0.5" disabled={selectedRow !== undefined} aria-label={`Edit ${name}`} onClick={() => onSelect(row.id)}><span className="truncate">{name}</span></Button>
            <p className="truncate text-xs text-muted-foreground">{value(row.id, secondary) || '—'}</p>
          </td>
          {(isCRM
            ? [value(row.id, 'stage').replace(/^./, letter => letter.toUpperCase()), [value(row.id, 'currency'), value(row.id, 'amount')].filter(Boolean).join(' '), value(row.id, 'closeDate'), value(row.id, 'nextActionDate')]
            : [value(row.id, 'onHand'), value(row.id, 'dailyDemand'), value(row.id, 'onOrder'), value(row.id, 'arrivalDate')]
          ).map((cell, index) => <td key={index} className="whitespace-nowrap px-3 py-3 tabular-nums last:pr-0">{cell || '—'}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
    {!filtered.length && <p className="py-4 text-sm text-muted-foreground">{data.rows.length ? `No ${isCRM ? 'opportunities' : 'items'} match this search.` : isCRM ? 'Add your first opportunity to start planning follow-ups.' : 'Add your first item to see stock coverage and replenishment needs.'}</p>}
    {filtered.length > visibleCount && <Button variant="ghost" onClick={() => setVisibleCount(count => count + 25)}>Show more ({filtered.length - visibleCount} remaining)</Button>}
    </section>}
  </>;
}
