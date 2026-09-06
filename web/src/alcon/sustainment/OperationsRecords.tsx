'use client';

import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { DateField } from '@/alcon/shared/date';
import type { useWidgetTableData, WidgetTableData } from '@/hooks/useWidgetTableData';
import { displayCell, parseCell } from '@/alcon/widget/widgets/dataViewModel';
import type { Json } from '@/types/database';
import { OPERATIONS_FIELDS, type OperationsParams } from './operationsModel';
import { OPERATIONS_INPUT, OperationsChoice } from './OperationsSetup';

type Source = ReturnType<typeof useWidgetTableData>;

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
  const savedRow = useRef(rowId);
  const lock = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  function change(columnId: string, value: string) { setDraft(current => ({ ...current, [columnId]: value })); }

  async function save() {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      const values: [string, Json | null][] = fields.map(field => [field.column.id, parseCell(draft[field.column.id] ?? '', field.column.type)]);
      if (!values.some(([, value]) => value !== null)) throw new Error('Enter at least one value.');
      if (!savedRow.current) savedRow.current = (await source.createRow()).id;
      await source.setCells(savedRow.current, Object.fromEntries(values));
      if (!rowId && createMore) {
        savedRow.current = null;
        setDraft(current => Object.fromEntries(fields.map(field => [field.column.id, ['stage', 'currency'].includes(field.key) ? current[field.column.id] : ''])));
        requestAnimationFrame(() => inputRef.current?.focus());
        onNext();
      } else onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the record.');
    } finally { lock.current = false; setSaving(false); }
  }

  return <form className="space-y-4 bg-muted/20 p-4" aria-label={rowId ? 'Edit record' : 'New record'}
    onSubmit={event => { event.preventDefault(); void save(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (!Object.values(draft).some(Boolean) && !saving) onClose(); } }}>
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-medium">{rowId ? 'Edit record' : params.kind === 'crm' ? 'New opportunity' : 'New inventory record'}</h3>
      <Button variant="ghost" size="icon-sm" type="button" aria-label="Close record editor" disabled={saving} onClick={onClose}><X size={14} /></Button>
    </div>
    <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field, index) => <label key={field.column.id} className="min-w-0 space-y-1">
        <span className="block text-xs text-muted-foreground">{field.label}</span>
        {field.column.type === 'date'
          ? <DateField aria-label={field.label} value={draft[field.column.id] || null} onChange={value => change(field.column.id, value ?? '')} disabled={saving} block />
          : params.kind === 'crm' && field.key === 'stage'
            ? <OperationsChoice label={field.label} value={draft[field.column.id] || ''} disabled={saving}
                options={[{ id: '', label: 'Set stage…' }, { id: 'open', label: 'Open' }, { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' },
                  ...(!['', 'open', 'won', 'lost'].includes(draft[field.column.id] ?? '') ? [{ id: draft[field.column.id], label: draft[field.column.id] }] : [])]}
                onChange={value => change(field.column.id, value)} />
            : <input ref={index === 0 ? inputRef : undefined} autoFocus={index === 0} aria-label={field.label} className={OPERATIONS_INPUT}
                inputMode={field.column.type === 'number' ? 'decimal' : undefined} placeholder={field.key === 'currency' ? 'e.g. JPY' : field.label}
                value={draft[field.column.id] ?? ''} disabled={saving} onChange={event => change(field.column.id, event.target.value)} />}
      </label>)}
    </div>
    {!fields.length && <p className="text-xs text-muted-foreground">Connect fields in Configure before adding records.</p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="primary" disabled={saving || !fields.length}>{saving ? 'Saving…' : error ? 'Retry save' : 'Save record'}</Button>
      {!rowId && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={createMore} disabled={saving} onChange={event => setCreateMore(event.target.checked)} />Create more</label>}
      <span className="text-xs text-muted-foreground">Changes update the source Table and recalculate the analysis.</span>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error} Your draft is retained. Confirmed values remain saved; retry completes this record.</p>}
  </form>;
}

export function OperationsRecords({ data, source, params, selectedRow, onSelect }: {
  data: WidgetTableData; source: Source; params: OperationsParams;
  selectedRow: string | null | undefined; onSelect: (row: string | null | undefined) => void;
}) {
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(25);
  const [savedCount, setSavedCount] = useState(0);
  const fields = OPERATIONS_FIELDS[params.kind];
  const nameId = params.fields[fields[0]?.key];
  const secondary = params.kind === 'crm' ? 'account' : 'supplier';
  const secondaryId = params.fields[secondary];
  const filtered = data.rows.filter((row, index) => [displayCell(data.cellsByRow[row.id]?.[nameId]) || `Row ${index + 1}`, displayCell(data.cellsByRow[row.id]?.[secondaryId])].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">Records <span className="text-muted-foreground">{data.rows.length}</span></h3>
      <div className="flex items-center gap-2">
        <input aria-label="Find records" placeholder="Find records…" className={`${OPERATIONS_INPUT} max-w-48`} value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(25); }} />
        <Button variant="secondary" disabled={selectedRow !== undefined} onClick={() => onSelect(null)}><Plus size={12} />Add record</Button>
      </div>
    </div>
    {selectedRow !== undefined && <RecordEditor key={`${selectedRow ?? 'new'}:${JSON.stringify(params.fields)}`} data={data} source={source} params={params} rowId={selectedRow} onClose={() => onSelect(undefined)} onNext={() => setSavedCount(current => current + 1)} />}
    {savedCount > 0 && <p role="status" className="text-xs text-muted-foreground">{savedCount} records created.</p>}
    <div className="divide-y divide-[var(--border-subtle)]">
      {filtered.slice(0, visibleCount).map((row, index) => <div key={row.id} className="flex min-h-8 items-center gap-4 py-1">
        <Button variant="ghost" align="start" className="min-w-0 flex-1" disabled={selectedRow !== undefined} onClick={() => onSelect(row.id)}>
          <span className="truncate">{displayCell(data.cellsByRow[row.id]?.[nameId]) || `Row ${data.rows.indexOf(row) + 1}`}</span>
        </Button>
        <span className="max-w-48 truncate text-xs text-muted-foreground">{displayCell(data.cellsByRow[row.id]?.[secondaryId]) || '—'}</span>
        <span className="hidden max-w-48 truncate text-xs text-muted-foreground sm:block">{params.kind === 'crm'
          ? [displayCell(data.cellsByRow[row.id]?.[params.fields.stage]), displayCell(data.cellsByRow[row.id]?.[params.fields.currency]), displayCell(data.cellsByRow[row.id]?.[params.fields.amount])].filter(Boolean).join(' · ')
          : `${displayCell(data.cellsByRow[row.id]?.[params.fields.onHand]) || '—'} on hand`}</span>
        <Button variant="ghost" size="xs" disabled={selectedRow !== undefined} aria-label={`Edit ${displayCell(data.cellsByRow[row.id]?.[nameId]) || `row ${index + 1}`}`} onClick={() => onSelect(row.id)}>Edit</Button>
      </div>)}
    </div>
    {!filtered.length && <p className="py-2 text-sm text-muted-foreground">{data.rows.length ? 'No records match this search.' : 'Add your first record to calculate the plan.'}</p>}
    {filtered.length > visibleCount && <Button variant="ghost" onClick={() => setVisibleCount(count => count + 25)}>Show more ({filtered.length - visibleCount} remaining)</Button>}
  </section>;
}
