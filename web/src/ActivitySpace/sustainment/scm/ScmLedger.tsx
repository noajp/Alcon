'use client';

import { useState } from 'react';
import { Plus, Undo2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/Function/shared/ConfirmDialog';
import { DateField } from '@/Function/shared/date';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useScmLedger, type ScmMovementRecord } from '@/hooks/useScm';
import type { ScmMovementKind } from './scmEngine';
import { formatDay, formatQuantity } from './scmText';
import { Pill, SCM_SELECT_INLINE, type Tone } from './ScmParts';
import { useScmSurface } from './scmSurface';

const KIND_LABEL: Record<ScmMovementKind, string> = {
  receipt: 'Receipt', issue: 'Issue', adjust: 'Adjustment', transfer_in: 'Transfer in', transfer_out: 'Transfer out',
};
const KIND_TONE: Record<ScmMovementKind, Tone> = { receipt: 'success', issue: 'muted', adjust: 'warning', transfer_in: 'info', transfer_out: 'info' };
const PAGE = 100;

/** Every stock change, newest first. The ledger is never edited; a mistake is reversed. */
export function ScmLedger({ itemId, onItem }: { itemId: string | null; onItem: (itemId: string | null) => void }) {
  const { t, locale } = useI18n();
  const { data, actions, locationId, openOrder, openDialog, locationName } = useScmSurface();
  const [kind, setKind] = useState<ScmMovementKind | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [reversing, setReversing] = useState<ScmMovementRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ledger = useScmLedger(data.spaceId, { itemId, locationId, kind: kind || null, from: from || null, to: to || null }, limit);
  const items = new Map(data.items.map(item => [item.id, item]));
  const orders = new Map(data.orders.map(order => [order.id, order]));

  async function reverse(movement: ScmMovementRecord) {
    setBusy(true); setError(null);
    try {
      const note = `${t('Reversal of {kind} on {day}', { kind: t(KIND_LABEL[movement.kind]), day: movement.occurredOn })}${movement.note ? ` (${movement.note})` : ''}`;
      await actions.reverseMovement(movement, data.today, note); setReversing(null);
    }
    catch (cause) { setError(t(cause instanceof Error ? cause.message : String(cause))); setReversing(null); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label={t('Item')} className={SCM_SELECT_INLINE} value={itemId ?? ''} onChange={event => onItem(event.target.value || null)}>
        <option value="">{t('All items')}</option>
        {data.items.map(item => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
      </select>
      <select aria-label={t('Movement type')} className={SCM_SELECT_INLINE} value={kind} onChange={event => setKind(event.target.value as ScmMovementKind | '')}>
        <option value="">{t('All movements')}</option>
        {(Object.keys(KIND_LABEL) as ScmMovementKind[]).map(entry => <option key={entry} value={entry}>{t(KIND_LABEL[entry])}</option>)}
      </select>
      <DateField size="sm" variant="ghost" placeholder={t('From date')} aria-label={t('From date')} value={from || null} onChange={value => setFrom(value ?? '')} />
      <DateField size="sm" variant="ghost" placeholder={t('To date')} aria-label={t('To date')} value={to || null} onChange={value => setTo(value ?? '')} />
      <Button className="ml-auto" size="sm" variant="secondary" onClick={() => openDialog({ kind: 'movement', initial: { itemId: itemId ?? undefined, locationId: locationId ?? undefined } })}><Plus size={14} />{t('Record movement')}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {ledger.error && <p role="alert" className="text-sm text-destructive">{t(ledger.error.message)}</p>}
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-[var(--border-subtle)] text-left text-xs text-muted-foreground">
          <th className="py-2 pr-2 font-medium">{t('Date')}</th><th className="px-2 py-2 font-medium">{t('Item')}</th>
          {!locationId && <th className="px-2 py-2 font-medium">{t('Location')}</th>}
          <th className="px-2 py-2 font-medium">{t('Type')}</th><th className="px-2 py-2 text-right font-medium">{t('Quantity')}</th>
          <th className="px-2 py-2 font-medium">{t('Reference')}</th><th className="py-2 pl-2" />
        </tr></thead>
        <tbody>{(ledger.data?.rows ?? []).map(movement => {
          const item = items.get(movement.itemId);
          const order = movement.poId ? orders.get(movement.poId) : undefined;
          const reversible = !movement.poId && movement.kind !== 'transfer_in' && movement.kind !== 'transfer_out';
          return <tr key={movement.id} className="border-b border-[var(--border-subtle)]">
            <td className="whitespace-nowrap py-2 pr-2 tabular-nums text-muted-foreground">{formatDay(movement.occurredOn, locale)}</td>
            <td className="max-w-64 px-2 py-2"><button type="button" className="block max-w-full truncate text-left hover:underline" onClick={() => onItem(movement.itemId)}>{item ? `${item.sku} · ${item.name}` : '—'}</button></td>
            {!locationId && <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{locationName(movement.locationId)}</td>}
            <td className="px-2 py-2"><Pill tone={KIND_TONE[movement.kind]}>{t(KIND_LABEL[movement.kind])}</Pill></td>
            <td className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${movement.quantity < 0 ? 'text-muted-foreground' : ''}`}>{movement.quantity > 0 ? '+' : ''}{formatQuantity(movement.quantity, locale)}</td>
            <td className="max-w-72 px-2 py-2 text-xs text-muted-foreground">
              {order ? <button type="button" className="hover:underline" onClick={() => openOrder(order.id)}>PO-{order.number}</button> : <span className="block truncate" title={movement.note ?? undefined}>{movement.note ?? '—'}</span>}
            </td>
            <td className="py-1 pl-2 text-right">{reversible && <Button size="icon-sm" variant="ghost" aria-label={t('Reverse this movement')} title={t('Reverse this movement')} onClick={() => setReversing(movement)}><Undo2 size={14} /></Button>}</td>
          </tr>;
        })}</tbody>
      </table>
      {ledger.loading && <p role="status" className="py-6 text-center text-sm text-muted-foreground">{t('Loading…')}</p>}
      {ledger.data && !ledger.data.rows.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('No movements match.')}</p>}
    </div>
    {ledger.data && ledger.data.total > ledger.data.rows.length && <Button variant="ghost" onClick={() => setLimit(current => current + PAGE)}>{t('Show more ({n} remaining)', { n: ledger.data.total - ledger.data.rows.length })}</Button>}
    <p className="text-xs text-muted-foreground">{t('The ledger is never edited. Reversing a movement records an opposite adjustment, so both stay visible. Receipts against an order are corrected with a stock count.')}</p>
    <ConfirmDialog open={!!reversing} busy={busy} title={t('Reverse this movement?')} confirmLabel={t('Reverse')}
      description={reversing ? t('An adjustment of {qty} is recorded today for {item}. The original stays in the ledger.', { qty: `${reversing.quantity > 0 ? '-' : '+'}${formatQuantity(Math.abs(reversing.quantity), locale)}`, item: items.get(reversing.itemId)?.name ?? '' }) : ''}
      onCancel={() => setReversing(null)} onConfirm={() => { if (reversing) void reverse(reversing); }} />
  </div>;
}
