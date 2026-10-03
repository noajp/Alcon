'use client';

import { useState } from 'react';
import { DateField } from '@/Function/shared/date';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fieldOptions, type CrmFieldRecord } from './crmModel';
import { CrmPicker } from './CrmPicker';

const FIELD_INPUT = 'h-7 w-full min-w-0 rounded-sm bg-transparent px-1.5 text-[13px] hover:bg-muted/40 focus:bg-muted/60 outline-none';

/** A value that saves when it loses focus or on Enter; Escape restores it. */
export function EditableText({ label, value, onSave, numeric = false, placeholder, multiline = false }: {
  label: string; value: string | number | null; onSave: (value: string | number | null) => Promise<unknown>;
  numeric?: boolean; placeholder?: string; multiline?: boolean;
}) {
  const initial = value === null || value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) { setSynced(initial); setDraft(initial); }
  const [error, setError] = useState(false);
  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === initial) return;
    const parsed = numeric ? (trimmed === '' ? null : Number(trimmed.replace(/,/g, ''))) : trimmed || null;
    if (numeric && parsed !== null && !Number.isFinite(parsed)) { setError(true); return; }
    setError(false);
    try { await onSave(parsed); } catch { setError(true); }
  }
  const common = {
    'aria-label': label, 'aria-invalid': error || undefined, placeholder: placeholder ?? '—', value: draft,
    className: `${FIELD_INPUT} ${initial ? '' : 'text-muted-foreground'} ${error ? 'bg-[var(--status-danger-subtle)]' : ''} ${multiline ? 'h-auto min-h-7 resize-y py-1' : ''}`,
    onBlur: () => void commit(),
  };
  return multiline
    ? <textarea {...common} rows={2} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setDraft(initial); }} />
    : <input {...common} inputMode={numeric ? 'decimal' : undefined} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setDraft(initial); }} />;
}

export function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-2">
    <span className="truncate text-xs text-muted-foreground">{label}</span><div className="min-w-0">{children}</div>
  </div>;
}

/** The Space's own fields for a record. Values live in the record's `custom`. */
export function CustomFields({ fields, values, onSave }: {
  fields: readonly CrmFieldRecord[]; values: Record<string, unknown>; onSave: (next: Record<string, unknown>) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const set = (key: string, value: unknown) => {
    const next = { ...values };
    if (value === null || value === '' || value === undefined) delete next[key]; else next[key] = value;
    return onSave(next);
  };
  return <>{fields.map(field => {
    const value = values[field.key];
    return <Property key={field.id} label={field.label}>
      {field.type === 'date' ? <DateField aria-label={field.label} value={typeof value === 'string' ? value : null} onChange={next => void set(field.key, next).catch(() => {})} placeholder={t('Set date')} />
        : field.type === 'checkbox' ? <input type="checkbox" aria-label={field.label} checked={value === true} onChange={event => void set(field.key, event.target.checked || null).catch(() => {})} className="ml-1.5" />
        : field.type === 'select' ? <CrmPicker label={field.label} value={typeof value === 'string' ? value : null} options={fieldOptions(field).map(option => ({ id: option, label: option }))} onChange={next => void set(field.key, next).catch(() => {})} placeholder="—" />
        : <EditableText label={field.label} numeric={field.type === 'number'} value={typeof value === 'string' || typeof value === 'number' ? value : null} onSave={next => set(field.key, next)} />}
    </Property>;
  })}</>;
}
