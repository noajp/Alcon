'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Table2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
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
  onChange: (patch: Partial<OperationsParams> | ((current: OperationsParams) => Partial<OperationsParams>)) => void;
  onDone: () => void;
}) {
  const template = useOperationsTemplate();
  const [name, setName] = useState('Sales pipeline');
  const [useExisting, setUseExisting] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const fields = OPERATIONS_FIELDS;
  const ready = fields.filter(field => field.required).every(field => columns.some(column => column.id === params.fields[field.key] && field.allowedTypes.includes(column.type)));

  async function create() {
    try {
      const result = await template.create(name.trim());
      if (mounted.current) onChange(result);
    } catch { /* The hook retains the actionable error beside the form. */ }
  }

  if (!params.tableId) return <div className="grid gap-8 py-4 sm:py-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-16">
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-xl font-semibold">Start with your opportunities</h3>
        <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">Add the deals you are working on. Keep the next contact in view and see a forecast based on their value and likelihood.</p>
      </div>
      {!useExisting ? <form className="max-w-md space-y-3" onSubmit={event => { event.preventDefault(); void create(); }}>
        <label className="block space-y-2 text-sm">
          <span>Pipeline name</span>
          <input aria-label="Pipeline name" className={`${OPERATIONS_INPUT} bg-muted/40`} value={name} disabled={template.creating} onChange={event => setName(event.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" type="submit" size="md" disabled={template.creating || !name.trim()}>{template.creating ? 'Creating…' : 'Create pipeline'}<ArrowRight size={14} /></Button>
          <Button variant="ghost" type="button" size="md" disabled={template.creating} onClick={() => setUseExisting(true)}>Use an existing Table</Button>
        </div>
        {template.error && <p role="alert" className="text-sm text-destructive">{template.error}</p>}
      </form> : <div className="max-w-md space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm"><Table2 size={16} /><span>Connect your Table</span>
          <OperationsChoice label="Source Table" value={null} options={tables.map(table => ({ id: table.id, label: table.name }))} onChange={tableId => onChange({ tableId, fields: {} })} />
        </div>
        <p className="text-xs text-muted-foreground">{tables.length ? 'Next, choose the columns that contain the details for this plan.' : 'You do not have any available Tables yet. Create one to get started.'}</p>
        <Button variant="ghost" onClick={() => setUseExisting(false)}>Back to creating a pipeline</Button>
      </div>}
      <p className="text-xs text-muted-foreground">Your data is private to your account. You can also edit it in Table.</p>
    </div>
    <ol className="space-y-5 border-t border-[var(--border-subtle)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
      {[
        ['Add opportunities', 'Capture the customer, value, likelihood, and expected close.'],
        ['Follow up at the right time', 'Find overdue conversations and opportunities without a next step.'],
        ['See what is likely to close', 'Review a forecast for each currency, then turn follow-ups into Elements.'],
      ].map(([title, description], index) => <li key={title} className="flex gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">{index + 1}</span>
        <div className="space-y-1"><p className="text-sm font-medium">{title}</p><p className="text-xs leading-relaxed text-muted-foreground">{description}</p></div>
      </li>)}
    </ol>
  </div>;

  return <div className="space-y-5 py-2">
    <div className="space-y-1"><h3 className="text-lg font-semibold">Connect your data</h3><p className="text-sm text-muted-foreground">Choose where each detail lives. Your existing Table stays in place.</p></div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Table</span>
      <OperationsChoice label="Source Table" value={params.tableId} options={tables.map(table => ({ id: table.id, label: table.name }))}
        onChange={tableId => { if (tableId !== params.tableId) onChange({ tableId, fields: {} }); }} />
    </div>
    {columns.length > 0 ? <>
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {fields.map(field => <div key={field.key} className="flex min-w-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] py-2">
          <span className="text-sm">{field.label}{field.required ? <span className="ml-1 text-muted-foreground">*</span> : <span className="ml-1 text-xs text-muted-foreground">Optional</span>}</span>
          <OperationsChoice label={`Column for ${field.label}`} value={params.fields[field.key] ?? ''}
            options={[{ id: '', label: 'Not connected' }, ...columns.filter(column => field.allowedTypes.includes(column.type) && !Object.entries(params.fields).some(([key, id]) => key !== field.key && id === column.id)).map(column => ({ id: column.id, label: column.name }))]}
            onChange={columnId => onChange(current => { const next = { ...current.fields }; if (columnId) next[field.key] = columnId; else delete next[field.key]; return { fields: next }; })} />
        </div>)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!ready} onClick={onDone}>Open pipeline<ArrowRight size={14} /></Button>
        <span className="text-xs text-muted-foreground">{ready ? 'Required details are connected.' : '* Connect these details to calculate your plan.'}</span>
      </div>
    </> : <p role="status" className="text-sm text-muted-foreground">No columns are available. Choose another Table, or add its columns in Table.</p>}
    <details className="text-xs text-muted-foreground"><summary className="w-fit cursor-pointer rounded-sm py-2 hover:text-foreground focus-visible:bg-muted">Advanced</summary>
      <Button variant="ghost" onClick={() => onChange({ tableId: null, fields: {} })}>Start a new pipeline</Button>
    </details>
  </div>;
}
