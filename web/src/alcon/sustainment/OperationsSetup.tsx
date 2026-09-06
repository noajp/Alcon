'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/alcon/shared/menu';
import { useOperationsTemplate } from '@/hooks/useOperationsTemplate';
import type { DataTableColumn } from '@/types/database';
import { OPERATIONS_FIELDS, type OperationsParams } from './operationsModel';

export const OPERATIONS_INPUT = 'h-8 min-w-0 w-full rounded-sm bg-transparent px-2 text-sm hover:bg-muted/40 focus:bg-muted/60 disabled:opacity-50';

export function OperationsChoice({ label, value, options, onChange, disabled }: {
  label: string; value: string | null; options: { id: string; label: string }[];
  onChange: (id: string) => void; disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const visible = options.filter(option => option.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <DropdownMenu onOpenChange={() => setSearch('')}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" align="start" disabled={disabled} aria-label={label} className="max-w-full">
          <span className="truncate">{options.find(option => option.id === value)?.label ?? 'Choose…'}</span>
          <ChevronDown size={12} />
        </Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" width="standard" align="start">
        <input autoFocus aria-label={`Find ${label.toLowerCase()}`} placeholder={`Choose ${label.toLowerCase()}…`} className={OPERATIONS_INPUT}
          value={search} onChange={event => setSearch(event.target.value)}
          onKeyDown={event => { if (!['Escape', 'ArrowDown', 'Enter'].includes(event.key)) event.stopPropagation(); }} />
        <div className="max-h-64 overflow-y-auto">
          {visible.map(option => <DropdownMenuItem key={option.id} className={MENU_ROW} onSelect={() => onChange(option.id)}>
            <span className="flex-1 truncate">{option.label}</span>
            <span className="flex w-4 justify-end">{option.id === value && <Check size={12} />}</span>
          </DropdownMenuItem>)}
          {!visible.length && <p className="px-2 py-2 text-xs text-muted-foreground">No matching choices.</p>}
        </div>
      </MenuShell>
    </DropdownMenu>
  );
}

export function OperationsSetup({ params, tables, columns, onChange, onDone }: {
  params: OperationsParams;
  tables: { id: string; name: string }[];
  columns: DataTableColumn[];
  onChange: (patch: Partial<OperationsParams>) => void;
  onDone: () => void;
}) {
  const template = useOperationsTemplate();
  const [name, setName] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const fields = OPERATIONS_FIELDS[params.kind];
  const ready = fields.filter(field => field.required).every(field => columns.some(column => column.id === params.fields[field.key] && field.allowedTypes.includes(column.type)));

  async function create() {
    try {
      const result = await template.create(params.kind, name.trim());
      if (mounted.current) onChange(result);
    } catch { /* The hook retains the actionable error beside the form. */ }
  }

  return <div className="space-y-4">
    <p className="max-w-3xl text-sm text-muted-foreground">
      {params.kind === 'crm'
        ? 'Prioritize customer follow-ups, track opportunities, and forecast your pipeline from actual records.'
        : 'Anticipate shortages, test changes in demand, and calculate replenishment from your inventory records.'}
    </p>
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Tool</span>
      <OperationsChoice label="Tool" value={params.kind} options={[{ id: 'crm', label: 'CRM' }, { id: 'scm', label: 'SCM' }]}
        disabled={template.creating} onChange={kind => onChange({ kind: kind as OperationsParams['kind'], tableId: null, fields: {} })} />
      <span className="text-xs text-muted-foreground">Source Table</span>
      <OperationsChoice label="Source Table" value={params.tableId} options={tables.map(table => ({ id: table.id, label: table.name }))}
        disabled={template.creating} onChange={tableId => { if (tableId !== params.tableId) onChange({ tableId, fields: {} }); }} />
    </div>
    {!params.tableId && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void create(); }}>
      <p className="text-xs text-muted-foreground">Start with an empty Table containing the fields this tool needs, or connect an existing Table.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="New Table name" placeholder={params.kind === 'crm' ? 'Name your sales pipeline…' : 'Name your inventory plan…'} className={`${OPERATIONS_INPUT} flex-1`}
          value={name} disabled={template.creating} onChange={event => setName(event.target.value)} />
        <Button variant="primary" type="submit" disabled={template.creating || !name.trim()}>{template.creating ? 'Creating…' : `Create ${params.kind.toUpperCase()} Table`}</Button>
      </div>
      <p className="text-xs text-muted-foreground">The Table belongs to your account. Records are saved in Table and can also be edited there.</p>
      {template.error && <p role="alert" className="text-sm text-destructive">{template.error}</p>}
    </form>}
    {params.tableId && columns.length > 0 && <>
      <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        {fields.map(field => <div key={field.key} className="flex min-w-0 items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{field.label}{field.required ? ' *' : ''}</span>
          <OperationsChoice label={`Column for ${field.label}`} value={params.fields[field.key] ?? ''}
            options={[{ id: '', label: 'Not mapped' }, ...columns.filter(column => field.allowedTypes.includes(column.type) && !Object.entries(params.fields).some(([key, id]) => key !== field.key && id === column.id)).map(column => ({ id: column.id, label: column.name }))]}
            onChange={columnId => { const next = { ...params.fields }; if (columnId) next[field.key] = columnId; else delete next[field.key]; onChange({ fields: next }); }} />
        </div>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={onDone}>Done</Button>
        <span className="text-xs text-muted-foreground">{ready ? 'Required fields connected. Optional fields improve the recommendations.' : '* Required for the full analysis. Connect matching typed columns.'}</span>
      </div>
    </>}
    {params.tableId && !columns.length && <p className="text-xs text-muted-foreground">This Table has no columns available. Open Table to add fields, or choose another source.</p>}
  </div>;
}
