'use client';

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import type { CustomColumnType, SelectOption } from '@/types/database';
import { COLUMN_TYPES } from './columnTypes';
import { CHOICE_TYPES, FIELD_COLORS, formatFieldNumber, optionLabel, validateField, type FieldDraft } from './fieldModel';

const INPUT = 'border-none w-full rounded-md bg-muted px-3 py-2 text-sm focus:bg-accent';
const SUPPORTED: CustomColumnType[] = ['text', 'select', 'multi_select', 'number', 'date', 'person', 'checkbox', 'url', 'email', 'phone'];

/** One draft, one save. Failed writes leave the draft intact. */
export function ObjectFieldDialog({ column, onClose, onSave, onDelete, onDuplicate }: {
  column?: CustomColumnWithValues;
  onClose: () => void;
  onSave: (draft: FieldDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onDuplicate?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<FieldDraft>(() => ({ name: column?.name ?? '', type: column?.column_type ?? 'text', options: structuredClone(column?.options ?? {}) }));
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const choices = draft.options.options ?? [];
  const patchOptions = (options: Partial<FieldDraft['options']>) => setDraft((prev) => ({ ...prev, options: { ...prev.options, ...options } }));
  const updateChoice = (index: number, patch: Partial<SelectOption>) => patchOptions({ options: choices.map((o, i) => i === index ? { ...o, ...patch } : o) });
  const move = (index: number, delta: number) => {
    const next = [...choices];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    patchOptions({ options: next });
  };
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await action(); onClose(); }
    catch { setError('Changes could not be saved. Your draft is still here. Please try again.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const save = () => {
    const validation = validateField(draft);
    if (validation) { setError(validation); return; }
    void run(() => onSave({ ...draft, name: draft.name.trim() }));
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending.current) onClose(); }}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{deleting ? 'Delete field' : column ? 'Edit field' : 'Add field'}</DialogTitle>
          <DialogDescription>{deleting ? 'This deletes the field and its saved values. Hide the column instead to keep its data.' : 'Custom fields belong to this Object. Tags stay with the Element across views.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (!deleting) save(); }}>
          <fieldset disabled={busy} className="space-y-4 max-h-[60vh] overflow-y-auto px-1 pb-4">
            {deleting ? <label className="block space-y-2 text-sm">Type “{column?.name}” to confirm<input autoFocus aria-label="Confirm field name" className={INPUT} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label> : <>
              <label className="block space-y-2 text-sm">Field name<input autoFocus aria-label="Field name" className={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Approval stage" /></label>
              <label className="block space-y-2 text-sm">Description<textarea aria-label="Field description" className={INPUT} rows={2} value={draft.options.description ?? ''} onChange={(e) => patchOptions({ description: e.target.value })} placeholder="Explain what this field tracks" /></label>
              <label className="block space-y-2 text-sm">Field type<select aria-label="Field type" className={INPUT} disabled={!!column} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as CustomColumnType })}>
                {COLUMN_TYPES.filter((t) => SUPPORTED.includes(t.type) || t.type === draft.type).map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select></label>
              {column && <p className="text-xs text-muted-foreground">The type is fixed to preserve existing values.</p>}
              {CHOICE_TYPES.includes(draft.type) && <div className="space-y-2">
                <p className="text-sm font-medium">Options</p>
                {choices.map((choice, index) => <div key={choice.value} className="flex items-center gap-1">
                  <select aria-label={`Color for option ${index + 1}`} className="w-8 h-8 rounded-md bg-muted" style={{ color: choice.color }} value={choice.color ?? FIELD_COLORS[0]} onChange={(e) => updateChoice(index, { color: e.target.value })}>
                    {FIELD_COLORS.map((color, i) => <option key={color} value={color}>{`● ${['Gray', 'Accent', 'Green', 'Amber', 'Red'][i]}`}</option>)}
                  </select>
                  <input aria-label={`Option ${index + 1}`} className={INPUT} value={optionLabel(choice)} onChange={(e) => updateChoice(index, { label: e.target.value })} />
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move option ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move option ${index + 1} down`} disabled={index === choices.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></Button>
                  <Button type="button" variant="ghost" size="xs" onClick={() => updateChoice(index, { archived: !choice.archived })}>{choice.archived ? 'Restore' : 'Retire'}</Button>
                </div>)}
                <Button type="button" variant="secondary" size="sm" onClick={() => patchOptions({ options: [...choices, { value: crypto.randomUUID(), label: '', color: FIELD_COLORS[0] }] })}><Plus size={14} />Add option</Button>
                <p className="text-xs text-muted-foreground">Retired options remain on existing Elements but cannot be newly selected.</p>
              </div>}
              {['number', 'budget'].includes(draft.type) && <div className="space-y-3">
                <label className="block text-sm space-y-2">Format<select aria-label="Number format" className={INPUT} value={draft.options.format ?? 'number'} onChange={(e) => patchOptions({ format: e.target.value })}>{['number', 'currency', 'percent', 'custom'].map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
                <label className="block text-sm space-y-2">Decimal places<select aria-label="Decimal places" className={INPUT} value={draft.options.decimals ?? 2} onChange={(e) => patchOptions({ decimals: Number(e.target.value) })}>{[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select></label>
                {draft.options.format === 'currency' && <select aria-label="Currency" className={INPUT} value={draft.options.currency ?? 'JPY'} onChange={(e) => patchOptions({ currency: e.target.value })}>{['JPY', 'USD', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select>}
                {draft.options.format === 'custom' && <input aria-label="Unit" placeholder="e.g. hours" className={INPUT} value={draft.options.unit ?? ''} onChange={(e) => patchOptions({ unit: e.target.value })} />}
                <p className="text-sm text-muted-foreground">Preview: {formatFieldNumber(1234.567, draft.options)}</p>
              </div>}
            </>}
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive pb-4">{error}</p>}
          <DialogFooter>
            {column && !deleting && <div className="flex flex-1 gap-1"><Button type="button" variant="ghost" size="icon-sm" aria-label="Delete field" disabled={busy} onClick={() => setDeleting(true)}><Trash2 size={14} /></Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { if (onDuplicate) void run(onDuplicate); }}>Duplicate</Button></div>}
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => deleting ? setDeleting(false) : onClose()}>Cancel</Button>
            {deleting ? <Button type="button" variant="danger" size="sm" disabled={busy || confirmation !== column?.name} onClick={() => { if (onDelete) void run(onDelete); }}>{busy ? 'Deleting…' : 'Delete field'}</Button> : <Button type="submit" variant="primary" size="sm" disabled={busy}>{busy ? 'Saving…' : column ? 'Save changes' : 'Create field'}</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
