'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DateField } from '@/Function/shared/date';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { ScmActions, ScmData, ScmItemDraft, ScmSupplierDraft } from '@/hooks/useScm';
import { addDays, type ScmItem, type ScmNode, type ScmPoStatus } from './scmEngine';
import { daysFrom, formatDay, formatMoney, formatQuantity, PO_STATUS_LABEL } from './scmText';
import { Pill, SCM_INPUT, SCM_LABEL } from './ScmParts';

// Every write a person makes in SCM goes through one of these dialogs. Each
// keeps its draft when a save fails and shows the reason beside the form.

function FormDialog({ title, description, children, onClose, busy, wide }: { title: string; description?: string; children: ReactNode; onClose: () => void; busy: boolean; wide?: boolean }) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className={wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} showCloseButton={!busy}>
      <DialogTitle>{title}</DialogTitle>
      {description && <DialogDescription>{description}</DialogDescription>}
      {children}
    </DialogContent>
  </Dialog>;
}

function useSubmit(onDone: () => void) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await work(); onDone(); } catch (cause) { setError(t(cause instanceof Error ? cause.message : String(cause))); } finally { setBusy(false); }
  }
  return { busy, error, run, setError };
}

const parseNumber = (value: string) => value.trim() === '' ? null : Number(value);

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className={SCM_LABEL}><span>{label}</span>{children}{hint && <span className="block text-[11px]">{hint}</span>}</label>;
}

/** A date picked from the app's calendar; the label is not a <label> because the trigger is a button. */
function DateEntry({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className={SCM_LABEL}><span>{label}</span><DateField block clearable={false} aria-label={label} value={value} onChange={next => { if (next) onChange(next); }} /></div>;
}

function Select({ value, onChange, options, label, disabled }: { value: string; onChange: (value: string) => void; options: { id: string; label: string }[]; label: string; disabled?: boolean }) {
  return <select aria-label={label} disabled={disabled} className={`${SCM_INPUT} text-foreground`} value={value} onChange={event => onChange(event.target.value)}>
    {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
  </select>;
}

function Footer({ busy, error, onClose, submit, extra }: { busy: boolean; error: string | null; onClose: () => void; submit: string; extra?: ReactNode }) {
  const { t } = useI18n();
  return <>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2 pt-1">
      {extra && <div className="mr-auto flex flex-wrap gap-2">{extra}</div>}
      <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? t('Saving…') : submit}</Button>
    </div>
  </>;
}

// ---------------------------------------------------------------------------

export function ItemDialog({ data, actions, item, onClose }: { data: ScmData; actions: ScmActions; item: ScmItem | null; onClose: () => void }) {
  const { t } = useI18n();
  const { busy, error, run, setError } = useSubmit(onClose);
  const [form, setForm] = useState(() => ({
    sku: item?.sku ?? '', name: item?.name ?? '', unit: item?.unit ?? 'pcs', category: item?.category ?? '',
    supplierId: item?.supplierId ?? data.suppliers[0]?.id ?? '', unitCost: String(item?.unitCost ?? ''), unitPrice: item?.unitPrice === null || item?.unitPrice === undefined ? '' : String(item.unitPrice),
    currency: item?.currency ?? data.policy.currency, leadTimeDays: item?.leadTimeDays === null || item?.leadTimeDays === undefined ? '' : String(item.leadTimeDays),
    moq: String(item?.moq ?? 0), orderMultiple: String(item?.orderMultiple ?? 1),
    serviceLevel: item?.serviceLevel ? String(Math.round(item.serviceLevel * 1000) / 10) : '',
    baseline: item?.baselineDailyDemand === null || item?.baselineDailyDemand === undefined ? '' : String(item.baselineDailyDemand),
    openingLocation: data.locations[0]?.id ?? '', opening: '',
  }));
  const set = (key: keyof typeof form) => (value: string) => setForm(current => ({ ...current, [key]: value }));
  const categories = useMemo(() => [...new Set(data.items.map(entry => entry.category).filter(Boolean) as string[])].sort(), [data.items]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const unitCost = parseNumber(form.unitCost);
    const serviceLevel = parseNumber(form.serviceLevel);
    if (!form.sku.trim() || !form.name.trim()) { setError(t('Enter a SKU and a name.')); return; }
    if (unitCost === null || !(unitCost >= 0)) { setError(t('Enter a unit cost of zero or more.')); return; }
    if (serviceLevel !== null && !(serviceLevel >= 50 && serviceLevel <= 99.9)) { setError(t('Service level must be between 50 and 99.9%.')); return; }
    if (!/^[A-Za-z]{3}$/.test(form.currency)) { setError(t('Currency must be a three-letter code, such as JPY or USD.')); return; }
    const draft: ScmItemDraft = {
      sku: form.sku, name: form.name, unit: form.unit, category: form.category || null, supplierId: form.supplierId || null,
      unitCost, unitPrice: parseNumber(form.unitPrice), currency: form.currency, leadTimeDays: parseNumber(form.leadTimeDays),
      moq: parseNumber(form.moq) ?? 0, orderMultiple: parseNumber(form.orderMultiple) || 1,
      serviceLevel: serviceLevel === null ? null : serviceLevel / 100, baselineDailyDemand: parseNumber(form.baseline),
    };
    const opening = !item && form.openingLocation && form.opening.trim() ? { locationId: form.openingLocation, quantity: Number(form.opening) } : null;
    void run(() => actions.saveItem(item?.id ?? null, draft, opening));
  }

  return <FormDialog title={item ? t('Edit item') : t('Add item')} description={t('What you stock, who supplies it and how it is ordered.')} onClose={onClose} busy={busy} wide>
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('SKU')}><input autoFocus className={SCM_INPUT} value={form.sku} onChange={event => set('sku')(event.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label={t('Name')}><input className={SCM_INPUT} value={form.name} onChange={event => set('name')(event.target.value)} /></Field></div>
        <Field label={t('Category')}><input list="scm-categories" className={SCM_INPUT} value={form.category} onChange={event => set('category')(event.target.value)} />
          <datalist id="scm-categories">{categories.map(category => <option key={category} value={category} />)}</datalist></Field>
        <Field label={t('Unit')}><input className={SCM_INPUT} value={form.unit} onChange={event => set('unit')(event.target.value)} /></Field>
        <Field label={t('Supplier')}><Select label={t('Supplier')} value={form.supplierId} onChange={set('supplierId')} options={[{ id: '', label: t('None') }, ...data.suppliers.map(supplier => ({ id: supplier.id, label: supplier.name }))]} /></Field>
        <Field label={t('Unit cost')}><input inputMode="decimal" className={SCM_INPUT} value={form.unitCost} onChange={event => set('unitCost')(event.target.value)} /></Field>
        <Field label={t('Selling price (optional)')} hint={t('Used to value lost sales.')}><input inputMode="decimal" className={SCM_INPUT} value={form.unitPrice} onChange={event => set('unitPrice')(event.target.value)} /></Field>
        <Field label={t('Currency')}><input className={SCM_INPUT} maxLength={3} value={form.currency} onChange={event => set('currency')(event.target.value.toUpperCase())} /></Field>
        <Field label={t('Minimum order (MOQ)')}><input inputMode="decimal" className={SCM_INPUT} value={form.moq} onChange={event => set('moq')(event.target.value)} /></Field>
        <Field label={t('Order multiple')} hint={t('Case or pack size.')}><input inputMode="decimal" className={SCM_INPUT} value={form.orderMultiple} onChange={event => set('orderMultiple')(event.target.value)} /></Field>
        <Field label={t('Lead time override (days)')} hint={t("Blank uses the supplier's.")}><input inputMode="decimal" className={SCM_INPUT} value={form.leadTimeDays} onChange={event => set('leadTimeDays')(event.target.value)} /></Field>
        <Field label={t('Service level override (%)')} hint={t('Blank uses the policy.')}><input inputMode="decimal" className={SCM_INPUT} value={form.serviceLevel} onChange={event => set('serviceLevel')(event.target.value)} /></Field>
        <Field label={t('Expected daily demand')} hint={t('Used until the item has history.')}><input inputMode="decimal" className={SCM_INPUT} value={form.baseline} onChange={event => set('baseline')(event.target.value)} /></Field>
      </div>
      {!item && data.locations.length > 0 && <div className="grid grid-cols-1 gap-3 border-t border-[var(--border-subtle)] pt-3 sm:grid-cols-3">
        <Field label={t('Opening stock at')}><Select label={t('Opening stock at')} value={form.openingLocation} onChange={set('openingLocation')} options={data.locations.map(location => ({ id: location.id, label: location.name }))} /></Field>
        <Field label={t('Opening quantity')}><input inputMode="decimal" className={SCM_INPUT} value={form.opening} onChange={event => set('opening')(event.target.value)} /></Field>
      </div>}
      <Footer busy={busy} error={error} onClose={onClose} submit={item ? t('Save') : t('Add item')} extra={item && <>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => actions.setItemActive(item.id, !item.active))}>{item.active ? t('Archive') : t('Restore')}</Button>
        <Button type="button" variant="danger" disabled={busy} onClick={() => void (async () => { if (await appDialog.confirm(t('Delete {name}? Only an item with no stock history or orders can be deleted.', { name: item.name }))) await run(() => actions.deleteItem(item.id)); })()}>{t('Delete')}</Button>
      </>} />
      {item && <p className="text-[11px] text-muted-foreground">{t('Archived items leave the plan and keep their history. An item with stock history or orders cannot be deleted; archive it instead.')}</p>}
    </form>
  </FormDialog>;
}

export function SupplierDialog({ data, actions, supplierId, onClose }: { data: ScmData; actions: ScmActions; supplierId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const supplier = data.suppliers.find(entry => entry.id === supplierId) ?? null;
  const { busy, error, run, setError } = useSubmit(onClose);
  const [form, setForm] = useState({
    name: supplier?.name ?? '', contact: supplier?.contact ?? '', email: supplier?.email ?? '',
    leadTimeDays: String(supplier?.leadTimeDays ?? 14), currency: supplier?.currency ?? data.policy.currency, notes: supplier?.notes ?? '',
  });
  const set = (key: keyof typeof form) => (value: string) => setForm(current => ({ ...current, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    const leadTime = Number(form.leadTimeDays);
    if (!form.name.trim()) { setError(t('Enter a name.')); return; }
    if (!Number.isFinite(leadTime) || leadTime < 0 || leadTime > 730) { setError(t('Lead time must be 0 to 730 days.')); return; }
    const draft: ScmSupplierDraft = { name: form.name, contact: form.contact, email: form.email, leadTimeDays: leadTime, currency: form.currency, notes: form.notes };
    void run(() => actions.saveSupplier(supplier?.id ?? null, draft));
  }
  return <FormDialog title={supplier ? t('Edit supplier') : t('Add supplier')} description={t('Promised lead time is a starting point; the planner learns the real one from receipts.')} onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label={t('Name')}><input autoFocus className={SCM_INPUT} value={form.name} onChange={event => set('name')(event.target.value)} /></Field></div>
        <Field label={t('Contact')}><input className={SCM_INPUT} value={form.contact} onChange={event => set('contact')(event.target.value)} /></Field>
        <Field label={t('Email')}><input type="email" className={SCM_INPUT} value={form.email} onChange={event => set('email')(event.target.value)} /></Field>
        <Field label={t('Promised lead time (days)')}><input inputMode="decimal" className={SCM_INPUT} value={form.leadTimeDays} onChange={event => set('leadTimeDays')(event.target.value)} /></Field>
        <Field label={t('Currency')}><input maxLength={3} className={SCM_INPUT} value={form.currency} onChange={event => set('currency')(event.target.value.toUpperCase())} /></Field>
        <div className="sm:col-span-2"><Field label={t('Remarks')}><textarea rows={2} className={`${SCM_INPUT} h-auto py-1.5`} value={form.notes} onChange={event => set('notes')(event.target.value)} /></Field></div>
      </div>
      <Footer busy={busy} error={error} onClose={onClose} submit={supplier ? t('Save') : t('Add supplier')} extra={supplier &&
        <Button type="button" variant="danger" disabled={busy} onClick={() => void (async () => { if (await appDialog.confirm(t('Delete {name}? A supplier with purchase orders is kept for their history and cannot be deleted.', { name: supplier.name }))) await run(() => actions.deleteSupplier(supplier.id)); })()}>{t('Delete')}</Button>} />
    </form>
  </FormDialog>;
}

// ---------------------------------------------------------------------------

export type MovementMode = 'issue' | 'receipt' | 'adjust' | 'count' | 'transfer';
const MODE_LABEL: Record<MovementMode, string> = { issue: 'Issue', receipt: 'Receipt', adjust: 'Adjust', count: 'Count', transfer: 'Transfer' };
const MODE_HINT: Record<MovementMode, string> = {
  issue: 'Stock used or sold. Issues are the demand history the forecast learns from.',
  receipt: 'Stock received without a purchase order. Receive orders from Purchase orders instead.',
  adjust: 'A correction, positive or negative (damage, loss, found stock).',
  count: 'A physical count. The difference to the system figure is recorded as an adjustment.',
  transfer: 'Move stock between locations. Both sides are recorded together.',
};

export function MovementDialog({ data, actions, initial, onClose }: {
  data: ScmData; actions: ScmActions; onClose: () => void;
  initial?: { mode?: MovementMode; itemId?: string; locationId?: string; toLocationId?: string; quantity?: number };
}) {
  const { t, locale } = useI18n();
  const { busy, error, run, setError } = useSubmit(onClose);
  const [mode, setMode] = useState<MovementMode>(initial?.mode ?? 'issue');
  const [itemId, setItemId] = useState(initial?.itemId ?? data.items[0]?.id ?? '');
  const [locationId, setLocationId] = useState(initial?.locationId ?? data.locations[0]?.id ?? '');
  const [toLocationId, setToLocationId] = useState(initial?.toLocationId ?? data.locations.find(location => location.id !== (initial?.locationId ?? data.locations[0]?.id))?.id ?? '');
  const [quantity, setQuantity] = useState(initial?.quantity ? String(initial.quantity) : '');
  const [day, setDay] = useState(data.today);
  const [note, setNote] = useState('');
  const onHand = data.stock.find(row => row.itemId === itemId && row.locationId === locationId)?.onHand ?? 0;
  const item = data.items.find(entry => entry.id === itemId);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(value)) { setError(t('Enter a quantity.')); return; }
    if (mode !== 'adjust' && value < 0) { setError(t('Enter a positive quantity.')); return; }
    if (day > data.today) { setError(t('The date cannot be in the future.')); return; }
    if (mode === 'count') void run(() => actions.countStock(itemId, locationId, value, day, note));
    else if (mode === 'transfer') void run(() => actions.transfer({ itemId, from: locationId, to: toLocationId, quantity: value, occurredOn: day, note }));
    else void run(() => actions.recordMovement({ itemId, locationId, kind: mode, quantity: value, occurredOn: day, note }));
  }

  return <FormDialog title={t('Record stock movement')} description={t(MODE_HINT[mode])} onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-1">
        {(Object.keys(MODE_LABEL) as MovementMode[]).filter(entry => entry !== 'transfer' || data.locations.length > 1).map(entry =>
          <Button key={entry} type="button" shape="tab" size="sm" role="tab" aria-selected={mode === entry} variant={mode === entry ? 'secondary' : 'ghost'} onClick={() => setMode(entry)}>{t(MODE_LABEL[entry])}</Button>)}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label={t('Item')}><Select label={t('Item')} value={itemId} onChange={setItemId} options={data.items.filter(entry => entry.active).map(entry => ({ id: entry.id, label: `${entry.sku} · ${entry.name}` }))} /></Field></div>
        <Field label={mode === 'transfer' ? t('From') : t('Location')} hint={t('On hand: {n}', { n: formatQuantity(onHand, locale) })}>
          <Select label={t('Location')} value={locationId} onChange={setLocationId} options={data.locations.map(location => ({ id: location.id, label: location.name }))} />
        </Field>
        {mode === 'transfer' && <Field label={t('To')}><Select label={t('To')} value={toLocationId} onChange={setToLocationId} options={data.locations.filter(location => location.id !== locationId).map(location => ({ id: location.id, label: location.name }))} /></Field>}
        <Field label={mode === 'count' ? t('Counted quantity') : mode === 'adjust' ? t('Change (+/-)') : t('Quantity')} hint={item?.unit}>
          <input autoFocus inputMode="decimal" className={SCM_INPUT} value={quantity} onChange={event => setQuantity(event.target.value)} />
        </Field>
        <DateEntry label={t('Date')} value={day} onChange={setDay} />
        <div className="sm:col-span-2"><Field label={t('Note (optional)')}><input className={SCM_INPUT} value={note} onChange={event => setNote(event.target.value)} /></Field></div>
      </div>
      <Footer busy={busy} error={error} onClose={onClose} submit={t('Record')} />
    </form>
  </FormDialog>;
}

// ---------------------------------------------------------------------------

export function NewOrderDialog({ data, actions, onClose, initial }: {
  data: ScmData; actions: ScmActions; onClose: () => void;
  initial?: { supplierId?: string; locationId?: string; lines?: { itemId: string; quantity: number }[]; rationale?: string };
}) {
  const { t, locale } = useI18n();
  const { busy, error, run, setError } = useSubmit(onClose);
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? data.suppliers[0]?.id ?? '');
  const [locationId, setLocationId] = useState(initial?.locationId ?? data.locations[0]?.id ?? '');
  const supplier = data.suppliers.find(entry => entry.id === supplierId);
  const [expectedOn, setExpectedOn] = useState(() => addDays(data.today, Math.ceil(supplier?.leadTimeDays ?? 14)));
  const [lines, setLines] = useState(() => (initial?.lines?.length ? initial.lines : []).map(line => ({ itemId: line.itemId, quantity: String(line.quantity) })));
  const supplied = data.items.filter(item => item.active && (item.supplierId === supplierId || !item.supplierId));
  const currency = supplier?.currency ?? data.policy.currency;
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (data.items.find(item => item.id === line.itemId)?.unitCost ?? 0), 0);

  function submit(status: ScmPoStatus) {
    const parsed = lines.map(line => ({ itemId: line.itemId, quantity: Number(line.quantity), unitCost: data.items.find(item => item.id === line.itemId)?.unitCost ?? 0 }))
      .filter(line => line.itemId && line.quantity > 0);
    if (!supplierId || !locationId) { setError(t('Choose a supplier and a location.')); return; }
    if (expectedOn < data.today) { setError(t('Expected arrival cannot be before today.')); return; }
    if (!parsed.length) { setError(t('Add at least one line with a quantity.')); return; }
    void run(() => actions.createOrder({ supplierId, locationId, status, orderedOn: data.today, expectedOn, currency, source: 'human', rationale: initial?.rationale ?? null, lines: parsed }));
  }

  return <FormDialog title={t('New purchase order')} description={t('Approved orders count as incoming supply in every plan. Drafts wait for approval.')} onClose={onClose} busy={busy} wide>
    <form onSubmit={event => { event.preventDefault(); submit('approved'); }} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('Supplier')}><Select label={t('Supplier')} value={supplierId} onChange={value => { setSupplierId(value); const next = data.suppliers.find(entry => entry.id === value); if (next) setExpectedOn(addDays(data.today, Math.ceil(next.leadTimeDays))); }} options={data.suppliers.map(entry => ({ id: entry.id, label: entry.name }))} /></Field>
        <Field label={t('Deliver to')}><Select label={t('Deliver to')} value={locationId} onChange={setLocationId} options={data.locations.map(location => ({ id: location.id, label: location.name }))} /></Field>
        <DateEntry label={t('Expected arrival')} value={expectedOn} onChange={setExpectedOn} />
      </div>
      <div className="space-y-2">
        {lines.map((line, index) => {
          const item = data.items.find(entry => entry.id === line.itemId);
          return <div key={index} className="grid grid-cols-[minmax(0,1fr)_7rem_6rem_2rem] items-center gap-2">
            <Select label={t('Item')} value={line.itemId} onChange={value => setLines(current => current.map((entry, at) => at === index ? { ...entry, itemId: value } : entry))}
              options={[{ id: '', label: t('Choose…') }, ...supplied.map(entry => ({ id: entry.id, label: `${entry.sku} · ${entry.name}` }))]} />
            <input aria-label={t('Quantity')} inputMode="decimal" className={SCM_INPUT} value={line.quantity} onChange={event => setLines(current => current.map((entry, at) => at === index ? { ...entry, quantity: event.target.value } : entry))} />
            <span className="truncate text-right text-xs tabular-nums text-muted-foreground">{item ? formatMoney((Number(line.quantity) || 0) * item.unitCost, currency, locale) : '—'}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('Remove line')} onClick={() => setLines(current => current.filter((_, at) => at !== index))}><Trash2 size={14} /></Button>
          </div>;
        })}
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => setLines(current => [...current, { itemId: '', quantity: '' }])}><Plus size={14} />{t('Add line')}</Button>
          <span className="text-sm font-medium tabular-nums">{formatMoney(total, currency, locale)}</span>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
        <Button type="button" variant="secondary" onClick={() => submit('draft')} disabled={busy}>{t('Save as draft')}</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? t('Saving…') : t('Create approved order')}</Button>
      </div>
    </form>
  </FormDialog>;
}

/** One purchase order: what was ordered and received, its next step, and receiving. */
export function OrderDialog({ data, actions, orderId, onClose, onOpenNode }: { data: ScmData; actions: ScmActions; orderId: string; onClose: () => void; onOpenNode: (key: string) => void }) {
  const { t, locale } = useI18n();
  const order = data.orders.find(entry => entry.id === orderId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<Record<string, string> | null>(null);
  const [receivedOn, setReceivedOn] = useState(data.today);
  const [expectedOn, setExpectedOn] = useState(order?.expectedOn ?? data.today);
  /** Line quantities being edited (by line id) and lines being added. */
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [adding, setAdding] = useState<{ itemId: string; quantity: string }[]>([]);
  if (!order) return null;
  const supplier = data.suppliers.find(entry => entry.id === order.supplierId);
  const location = data.locations.find(entry => entry.id === order.locationId);
  const total = order.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const open = ['approved', 'sent', 'partial'].includes(order.status);
  const overdue = open && order.expectedOn < data.today;
  const editable = order.status === 'draft' || open;
  /** Items that can still be added: not on the order and not picked in another new row. */
  const addableFor = (index: number) => data.items.filter(item => item.active && !order.lines.some(line => line.itemId === item.id)
    && !adding.some((entry, at) => at !== index && entry.itemId === item.id));
  function saveLines() {
    if (!editing) return;
    // An emptied field is a mistake, not a removal: only an explicit 0 or the bin removes a line.
    const typed = order!.lines.map(line => ({ line, text: (editing[line.id] ?? String(line.quantity)).trim() }));
    if (typed.some(entry => entry.text === '' || !Number.isFinite(Number(entry.text)) || Number(entry.text) < 0)) { setError(t('Enter a quantity of zero or more. Zero removes the line.')); return; }
    const lines = typed.map(entry => ({ id: entry.line.id, quantity: Number(entry.text) })).filter((line, index) => line.quantity !== order!.lines[index].quantity);
    const filled = adding.filter(line => line.itemId || line.quantity.trim());
    if (filled.some(line => !line.itemId || !(Number(line.quantity) > 0))) { setError(t('Enter a quantity above zero for every new line.')); return; }
    const add = filled.map(line => ({ itemId: line.itemId, quantity: Number(line.quantity), unitCost: data.items.find(item => item.id === line.itemId)?.unitCost ?? 0 }));
    const kept = typed.filter(entry => Number(entry.text) > 0).length + add.length;
    if (kept === 0) { setError(t('An order needs at least one line. Cancel it instead of removing every line.')); return; }
    if (!lines.length && !add.length) { setEditing(null); setAdding([]); return; }
    void act(async () => { await actions.updateOrder(order!.id, { lines, add }); setEditing(null); setAdding([]); });
  }

  async function act(work: () => Promise<unknown>, close = false) {
    setBusy(true); setError(null);
    try { await work(); if (close) onClose(); } catch (cause) { setError(t(cause instanceof Error ? cause.message : String(cause))); } finally { setBusy(false); }
  }

  return <FormDialog title={`PO-${order.number} · ${supplier?.name ?? ''}`} onClose={onClose} busy={busy} wide>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Pill tone={order.status === 'draft' ? 'warning' : order.status === 'cancelled' ? 'muted' : order.status === 'received' ? 'success' : overdue ? 'danger' : 'info'}>{overdue ? t('Overdue') : t(PO_STATUS_LABEL[order.status])}</Pill>
        {order.source !== 'human' && <Pill tone="info">{order.source === 'copilot' ? 'Copilot' : t('Autopilot')}</Pill>}
        <span>{t('To {location}', { location: location?.name ?? '' })}</span>
        <span>· {t('Ordered {day}', { day: formatDay(order.orderedOn, locale) })}</span>
        <span>· {order.status === 'received' && order.receivedOn ? t('Received {day}', { day: formatDay(order.receivedOn, locale) }) : t('Expected {day}', { day: formatDay(order.expectedOn, locale) })}</span>
        {overdue && <span className="text-[var(--status-danger)]">({t('{n} days late', { n: -daysFrom(data.today, order.expectedOn) })})</span>}
      </div>
      {order.rationale && <p className="whitespace-pre-line rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">{order.rationale}</p>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr>
          <th className="py-1.5 font-medium">{t('Item')}</th><th className="py-1.5 text-right font-medium">{t('Ordered')}</th>
          <th className="py-1.5 text-right font-medium">{t('Received')}</th><th className="py-1.5 text-right font-medium">{t('Value')}</th>
          {receiving && <th className="py-1.5 pl-3 text-right font-medium">{t('Receive now')}</th>}
        </tr></thead>
        <tbody>{order.lines.map(line => {
          const item = data.items.find(entry => entry.id === line.itemId);
          return <tr key={line.id} className="border-t border-[var(--border-subtle)]">
            <td className="py-1.5"><button type="button" className="text-left hover:underline" onClick={() => onOpenNode(`${line.itemId}:${order.locationId}`)}>{item ? `${item.sku} · ${item.name}` : '—'}</button></td>
            <td className="py-1.5 text-right tabular-nums">{editing
              ? <span className="flex items-center justify-end gap-1">
                  <input aria-label={t('Quantity for {name}', { name: item?.name ?? '' })} inputMode="decimal" className={`${SCM_INPUT} w-20 text-right`} value={editing[line.id] ?? String(line.quantity)} onChange={event => setEditing(current => ({ ...current, [line.id]: event.target.value }))} />
                  {line.receivedQuantity === 0 && <Button type="button" variant="ghost" size="icon-sm" aria-label={t('Remove line')} onClick={() => setEditing(current => ({ ...current, [line.id]: '0' }))}><Trash2 size={14} /></Button>}
                </span>
              : formatQuantity(line.quantity, locale)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatQuantity(line.receivedQuantity, locale)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatMoney(line.quantity * line.unitCost, order.currency, locale)}</td>
            {receiving && <td className="py-1 pl-3"><input aria-label={t('Receive now')} inputMode="decimal" className={`${SCM_INPUT} text-right`} value={receiving[line.id] ?? ''} onChange={event => setReceiving(current => ({ ...current, [line.id]: event.target.value }))} /></td>}
          </tr>;
        })}</tbody>
        {editing && <tbody>{adding.map((line, index) => <tr key={`add-${index}`} className="border-t border-[var(--border-subtle)]">
          <td className="py-1"><Select label={t('Item')} value={line.itemId} onChange={value => setAdding(current => current.map((entry, at) => at === index ? { ...entry, itemId: value } : entry))}
            options={[{ id: '', label: t('Choose…') }, ...addableFor(index).map(item => ({ id: item.id, label: `${item.sku} · ${item.name}` }))]} /></td>
          <td className="py-1 text-right"><input aria-label={t('Quantity')} inputMode="decimal" className={`${SCM_INPUT} ml-auto w-20 text-right`} value={line.quantity} onChange={event => setAdding(current => current.map((entry, at) => at === index ? { ...entry, quantity: event.target.value } : entry))} /></td>
          <td /><td />
        </tr>)}
        <tr><td colSpan={4} className="py-1"><Button type="button" variant="ghost" size="sm" onClick={() => setAdding(current => [...current, { itemId: '', quantity: '' }])}><Plus size={14} />{t('Add line')}</Button></td></tr></tbody>}
        <tfoot><tr className="border-t border-[var(--border-subtle)] font-medium"><td className="py-1.5">{t('Total')}</td><td /><td /><td className="py-1.5 text-right tabular-nums">{formatMoney(total, order.currency, locale)}</td>{receiving && <td />}</tr></tfoot>
      </table>
      {receiving && <div className="flex flex-wrap items-end gap-3">
        <DateEntry label={t('Received on')} value={receivedOn} onChange={setReceivedOn} />
        <Button variant="primary" disabled={busy || receivedOn > data.today || !Object.values(receiving).some(value => Number(value) > 0)} onClick={() => void act(() => actions.receiveOrder(order.id, Object.entries(receiving).map(([lineId, value]) => ({ lineId, quantity: Number(value) || 0 })).filter(line => line.quantity > 0), receivedOn), true)}>{t('Post receipt')}<ArrowRight size={14} /></Button>
        <Button variant="ghost" disabled={busy} onClick={() => setReceiving(null)}>{t('Cancel')}</Button>
      </div>}
      {editing && <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => { setEditing(null); setAdding([]); }}>{t('Cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={saveLines}>{busy ? t('Saving…') : t('Save lines')}</Button>
      </div>}
      {open && !receiving && !editing && <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border-subtle)] pt-3">
        <DateEntry label={t('Expected arrival')} value={expectedOn} onChange={setExpectedOn} />
        <Button variant="ghost" disabled={busy || expectedOn === order.expectedOn || expectedOn < order.orderedOn} onClick={() => void act(() => actions.updateOrder(order.id, { expectedOn }))}>{t('Update date')}</Button>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!receiving && !editing && <div className="flex flex-wrap justify-end gap-2">
        {editable && <Button variant="ghost" disabled={busy} className="mr-auto" onClick={() => setEditing({})}>{t('Edit lines')}</Button>}
        {order.status === 'draft' && <Button variant="ghost" disabled={busy} onClick={() => void (async () => { if (await appDialog.confirm(t('Delete this draft? It is removed, and its approval Element is cancelled.'))) await act(() => actions.deleteDraftOrder(order.id), true); })()}>{t('Delete draft')}</Button>}
        {order.status === 'draft' && <>
          <Button variant="danger" disabled={busy} onClick={() => void act(() => actions.setOrderStatus(order.id, order.status, 'cancelled'), true)}>{t('Reject')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void act(() => actions.setOrderStatus(order.id, order.status, 'approved'), true)}>{t('Approve order')}</Button>
        </>}
        {order.status === 'approved' && <Button variant="secondary" disabled={busy} onClick={() => void act(() => actions.setOrderStatus(order.id, order.status, 'sent'))}>{t('Mark as sent')}</Button>}
        {open && order.status !== 'partial' && <Button variant="danger" disabled={busy} onClick={() => void act(() => actions.setOrderStatus(order.id, order.status, 'cancelled'), true)}>{t('Cancel order')}</Button>}
        {open && <Button variant="primary" disabled={busy} onClick={() => setReceiving(Object.fromEntries(order.lines.map(line => [line.id, String(Math.max(0, line.quantity - line.receivedQuantity))])))}>{t('Receive')}</Button>}
      </div>}
    </div>
  </FormDialog>;
}

/** The suggested order for one item, or an empty line to fill in when nothing is suggested. */
export function nodeOrderLines(node: ScmNode) {
  return [{ itemId: node.itemId, quantity: node.suggestedQuantity > 0 ? node.suggestedQuantity : 0 }];
}
