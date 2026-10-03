'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Boxes, ClipboardPaste, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/Function/shared/ConfirmDialog';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { ScmActions, ScmData } from '@/hooks/useScm';
import type { ScmPolicy } from './scmEngine';
import { parseScmImport } from './scmImport';
import { formatMoney } from './scmText';
import { Section, SCM_INPUT, SCM_LABEL } from './ScmParts';

// The intent the planner works within (service level, horizon, budget,
// approval authority), where stock lives, and getting data in.

export function ScmPolicyForm({ data, actions }: { data: ScmData; actions: ScmActions }) {
  const { t, locale } = useI18n();
  const policy = data.policy;
  const [form, setForm] = useState(() => ({
    serviceLevel: String(Math.round(policy.serviceLevel * 1000) / 10), horizonDays: String(policy.horizonDays), reviewDays: String(policy.reviewDays),
    lookbackDays: String(policy.lookbackDays), orderingCost: String(policy.orderingCost), holdingRate: String(Math.round(policy.holdingRate * 1000) / 10),
    autopilot: policy.autopilotEnabled, limit: String(policy.autoApproveLimit), budget: policy.monthlyBudget === null ? '' : String(policy.monthlyBudget), currency: policy.currency,
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const set = (key: keyof typeof form) => (value: string | boolean) => { setForm(current => ({ ...current, [key]: value })); setMessage(null); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: ScmPolicy = {
      serviceLevel: Number(form.serviceLevel) / 100, horizonDays: Number(form.horizonDays), reviewDays: Number(form.reviewDays),
      lookbackDays: Number(form.lookbackDays), orderingCost: Number(form.orderingCost) || 0, holdingRate: (Number(form.holdingRate) || 0) / 100,
      autopilotEnabled: form.autopilot, autoApproveLimit: Number(form.limit) || 0, monthlyBudget: form.budget.trim() ? Number(form.budget) : null, currency: form.currency,
    };
    const problems = [
      !(next.serviceLevel >= 0.5 && next.serviceLevel <= 0.999) && t('Service level must be between 50 and 99.9%.'),
      !(Number.isInteger(next.horizonDays) && next.horizonDays >= 7 && next.horizonDays <= 365) && t('Plan ahead 7 to 365 days.'),
      !(Number.isInteger(next.reviewDays) && next.reviewDays >= 1 && next.reviewDays <= 90) && t('Review every 1 to 90 days.'),
      !(Number.isInteger(next.lookbackDays) && next.lookbackDays >= 14 && next.lookbackDays <= 730) && t('Learn from 14 to 730 days of history.'),
      !(next.holdingRate >= 0 && next.holdingRate <= 2) && t('Holding cost must be 0 to 200% a year.'),
      next.monthlyBudget !== null && !(next.monthlyBudget >= 0) && t('Budget must be zero or more.'),
      !/^[A-Za-z]{3}$/.test(next.currency) && t('Currency must be a three-letter code, such as JPY or USD.'),
    ].filter(Boolean) as string[];
    if (problems.length) { setMessage({ tone: 'error', text: problems.join(' ') }); return; }
    setBusy(true);
    try { await actions.savePolicy(next); setMessage({ tone: 'ok', text: t('Saved. Every plan now uses this policy.') }); }
    catch (cause) { setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) }); }
    finally { setBusy(false); }
  }

  const field = (key: keyof typeof form, label: string, hint?: string) => <label className={SCM_LABEL}><span>{label}</span>
    <input inputMode="decimal" className={SCM_INPUT} value={String(form[key])} onChange={event => set(key)(event.target.value)} />
    {hint && <span className="block text-[11px]">{hint}</span>}
  </label>;

  return <form onSubmit={submit} className="space-y-8">
    <Section title={t('Service and planning')} description={t('The intent every recommendation is sized to.')}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {field('serviceLevel', t('Service level (%)'), t('Chance of not running out during a replenishment cycle.'))}
        {field('horizonDays', t('Plan ahead (days)'))}
        {field('reviewDays', t('Review every (days)'), t('How often orders are placed.'))}
        {field('lookbackDays', t('Learn from (days of history)'))}
        {field('orderingCost', t('Cost per order'), t('Enables economic order quantities. 0 = off.'))}
        {field('holdingRate', t('Holding cost (% a year)'))}
      </div>
    </Section>
    <Section title={t('Autopilot authority')} description={t('What the planner may do without asking. Anything beyond it becomes an approval Element in your queue, with the evidence attached.')}>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1" checked={form.autopilot} onChange={event => set('autopilot')(event.target.checked)} />
        <span><span className="font-medium">{t('Let the autopilot place orders')}</span><span className="block text-xs text-muted-foreground">{t('Runs when SCM is opened each day, and whenever you run the planner. Orders it places are marked Autopilot and logged.')}</span></span>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {field('limit', t('Approve automatically up to (per order)'), form.limit ? formatMoney(Number(form.limit) || 0, form.currency, locale) : undefined)}
        {field('budget', t('Monthly purchasing budget'), t('Blank = no budget. Orders beyond it always need approval.'))}
        <label className={SCM_LABEL}><span>{t('Currency')}</span><input maxLength={3} className={SCM_INPUT} value={form.currency} onChange={event => set('currency')(event.target.value.toUpperCase())} /></label>
      </div>
    </Section>
    {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-destructive' : 'text-[var(--status-success)]'}`}>{message.text}</p>}
    <Button type="submit" variant="primary" disabled={busy}>{busy ? t('Saving…') : t('Save policy')}</Button>
  </form>;
}

export function ScmLocations({ data, actions }: { data: ScmData; actions: ScmActions }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string; code: string } | null>(null);
  async function rename() {
    if (!renaming?.name.trim()) return;
    try { await actions.saveLocation(renaming.id, { name: renaming.name, code: renaming.code }); setRenaming(null); setError(null); }
    catch (cause) { setError(t(cause instanceof Error ? cause.message : String(cause))); }
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try { await actions.saveLocation(null, { name, code }); setName(''); setCode(''); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <Section title={t('Locations')} description={t('Warehouses, stores or sites that hold stock. Each item is planned per location.')}>
    <ul className="divide-y divide-[var(--border-subtle)]">{data.locations.map(location => {
      const used = data.stock.some(row => row.locationId === location.id) || data.orders.some(order => order.locationId === location.id);
      return <li key={location.id} className="flex items-center gap-3 py-2 text-sm">
        {renaming?.id === location.id ? <form className="flex flex-1 flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void rename(); }}>
          <input autoFocus aria-label={t('Name')} className={`${SCM_INPUT} min-w-40 flex-1`} value={renaming.name} onChange={event => setRenaming({ ...renaming, name: event.target.value })} />
          <input aria-label={t('Code')} className={`${SCM_INPUT} w-24`} value={renaming.code} onChange={event => setRenaming({ ...renaming, code: event.target.value })} />
          <Button type="submit" size="sm" variant="primary" disabled={!renaming.name.trim()}>{t('Save')}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>{t('Cancel')}</Button>
        </form> : <>
          <span className="flex-1">{location.name}</span><span className="text-xs text-muted-foreground">{location.code}</span>
          <Button size="icon-sm" variant="ghost" aria-label={t('Rename {name}', { name: location.name })} onClick={() => setRenaming({ id: location.id, name: location.name, code: location.code ?? '' })}><Pencil size={14} /></Button>
          {!used && <Button size="icon-sm" variant="ghost" aria-label={t('Delete {name}', { name: location.name })} onClick={() => setConfirm(location.id)}><Trash2 size={14} /></Button>}
        </>}
      </li>;
    })}</ul>
    <p className="text-[11px] text-muted-foreground">{t('A location with stock history or orders can be renamed but not deleted.')}</p>
    <form onSubmit={add} className="flex flex-wrap items-end gap-2">
      <label className={`${SCM_LABEL} min-w-48 flex-1`}><span>{t('Name')}</span><input className={SCM_INPUT} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className={`${SCM_LABEL} w-28`}><span>{t('Code')}</span><input className={SCM_INPUT} value={code} onChange={event => setCode(event.target.value)} /></label>
      <Button type="submit" variant="secondary" disabled={!name.trim()}><Plus size={14} />{t('Add location')}</Button>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <ConfirmDialog open={!!confirm} title={t('Delete this location?')} description={t('This location has no stock history or orders. It will be removed.')}
      confirmLabel={t('Delete')} onCancel={() => setConfirm(null)} onConfirm={() => { const id = confirm; setConfirm(null); if (id) void actions.deleteLocation(id).catch(cause => setError(t(cause instanceof Error ? cause.message : String(cause)))); }} />
  </Section>;
}

export function ScmImport({ data, actions, onDone }: { data: ScmData; actions: ScmActions; onDone?: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => text.trim() ? parseScmImport(text) : null, [text]);
  async function run() {
    if (!parsed?.rows.length) return;
    setBusy(true); setError(null);
    try {
      const outcome = await actions.importRows(parsed.rows, data);
      setResult(t('Imported {items} items and {counts} stock counts.', outcome));
      setText('');
      onDone?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <Section title={t('Import from a spreadsheet')} description={t('Paste rows copied from Excel, Google Sheets or a CSV file, with a header row. SKU and name are required; supplier, cost, lead time, location and on hand are picked up when present.')}>
    <textarea aria-label={t('Paste spreadsheet rows')} rows={6} spellCheck={false} className={`${SCM_INPUT} h-auto py-2 font-mono text-xs`} value={text} onChange={event => { setText(event.target.value); setResult(null); }}
      placeholder={'SKU\tName\tSupplier\tUnit cost\tLead time\tLocation\tOn hand\nCB-001\tHouse blend 1kg\tBean Co\t2400\t14\tTokyo\t120'} />
    {parsed && <div className="space-y-1 text-xs">
      <p className="text-muted-foreground">{t('{n} rows ready · columns found: {columns}', { n: parsed.rows.length, columns: parsed.columns.join(', ') || '—' })}</p>
      {parsed.errors.slice(0, 6).map(entry => <p key={`${entry.line}:${entry.message}`} className="text-destructive">{t('Line {line}: {message}', { line: entry.line, message: entry.message })}</p>)}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result && <p role="status" className="text-sm text-[var(--status-success)]">{result}</p>}
    <Button variant="secondary" disabled={busy || !parsed?.rows.length} onClick={() => void run()}><ClipboardPaste size={14} />{busy ? t('Importing…') : t('Import {n} rows', { n: parsed?.rows.length ?? 0 })}</Button>
  </Section>;
}

export function ScmDataSection({ data, actions }: { data: ScmData; actions: ScmActions }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <Section title={t('Reset')} description={t('Delete every SCM record in this Space: items, stock, ledger, orders, suppliers, locations and policy.')}>
    <Button variant="danger" disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={14} />{t('Delete all SCM data')}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <ConfirmDialog open={confirm} busy={busy} title={t('Delete all SCM data?')} description={t('{n} items and their full history will be deleted for everyone in this Space. This cannot be undone.', { n: data.items.length })} confirmLabel={t('Delete all')}
      onCancel={() => setConfirm(false)} onConfirm={() => { setBusy(true); void actions.clearAll().catch(cause => setError(String(cause))).finally(() => { setBusy(false); setConfirm(false); }); }} />
  </Section>;
}

/** First run: try it on a sample, bring a spreadsheet, or start by hand. */
export function ScmOnboarding({ data, actions, onAddItem }: { data: ScmData; actions: ScmActions; onAddItem: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="grid gap-10 py-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">{t('Never run out. Never over-order.')}</h2>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{t('SCM forecasts demand from your stock movements, sizes safety stock to the service level you choose, and projects every item day by day with the orders already placed. It proposes what to order, and within the authority you give it, places the orders itself.')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="md" disabled={busy} onClick={() => { setBusy(true); setError(null); void actions.loadSample(data.today).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false)); }}>
          <Boxes size={14} />{busy ? t('Loading 120 days of history…') : t('Explore with sample data')}<ArrowRight size={14} />
        </Button>
        <Button variant="ghost" size="md" disabled={busy} onClick={onAddItem}><Plus size={14} />{t('Add your first item')}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">{t('The sample is a café chain with two warehouses, five suppliers and 120 days of history. Delete it any time from Planning settings.')}</p>
      <ScmImport data={data} actions={actions} />
    </div>
    <ol className="space-y-5 border-t border-[var(--border-subtle)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
      {[
        [t('Forecasts that learn'), t('Trend and weekly patterns from your own issues, with the forecast error shown next to every number.')],
        [t('Safety stock with a reason'), t('Sized from demand variability and how late each supplier really delivers, not from a rule of thumb.')],
        [t('A control tower, not a report'), t('What runs out before supply can arrive, what to order today, which transfer closes a gap.')],
        [t('An autopilot with limits'), t('You set the service level, the budget and the approval limit. The planner acts within them and escalates the rest as Elements.')],
        [t('What-if in seconds'), t('A supplier two weeks late, demand up 30%: see what breaks, when, and what it costs.')],
      ].map(([title, description], index) => <li key={title} className="flex gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">{index + 1}</span>
        <div className="space-y-1"><p className="text-sm font-medium">{title}</p><p className="text-xs leading-relaxed text-muted-foreground">{description}</p></div>
      </li>)}
    </ol>
  </div>;
}
