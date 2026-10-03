'use client';

import { useMemo, useState } from 'react';
import { ArrowLeftRight, Plus, Search, ShoppingCart, SquarePen, Truck } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { ScmHealth, ScmNode, ScmPoStatus } from './scmEngine';
import { daysFrom, formatDay, formatMoney, formatQuantity, HEALTH_LABEL, PO_STATUS_LABEL, signalText } from './scmText';
import { HealthBadge, Pill, Section, SCM_INPUT, SCM_ROW } from './ScmParts';
import { useScmSurface } from './scmSurface';
import { nodeOrderLines } from './ScmForms';

const TH = 'whitespace-nowrap px-2 py-2 text-left text-xs font-medium text-muted-foreground first:pl-0';
const TD = 'whitespace-nowrap px-2 py-2 tabular-nums first:pl-0';

function cover(node: ScmNode, locale: string, t: (m: string, v?: Record<string, string | number>) => string) {
  if (node.daysOfCover === null) return '—';
  return node.daysOfCover > 365 ? t('1y+') : t('{n}d', { n: formatQuantity(node.daysOfCover, locale, 0) });
}

// ---------------------------------------------------------------------------

/** What needs a decision, grouped by how soon. Each row carries its next action. */
export function ScmExceptions() {
  const { t, locale } = useI18n();
  const { nodes, plan, openNode, openOrder, openDialog, locationName, supplierName } = useScmSurface();
  const groups: { id: string; title: string; description: string; rows: ScmNode[] }[] = useMemo(() => [
    { id: 'now', title: t('Out of stock'), description: t('Demand is going unmet today.'), rows: nodes.filter(node => node.health === 'stockout') },
    { id: 'before', title: t('Runs out before supply can arrive'), description: t('A normal order is too late. Expedite, transfer or substitute.'), rows: nodes.filter(node => node.health === 'critical') },
    { id: 'order', title: t('Order now'), description: t('At or below the reorder point. An order placed today arrives in time.'), rows: nodes.filter(node => node.health === 'reorder') },
    { id: 'late', title: t('Late supply'), description: t('Purchase orders past their expected date.'), rows: nodes.filter(node => !['stockout', 'critical', 'reorder'].includes(node.health) && node.arrivals.some(arrival => arrival.overdue)) },
  ], [nodes, t]);
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  if (!total) return <div className="space-y-2 py-12 text-center"><p className="text-sm font-medium">{t('No exceptions')}</p><p className="text-sm text-muted-foreground">{t('Every item is covered by stock or orders that arrive in time.')}</p></div>;

  return <div className="space-y-8">
    {groups.filter(group => group.rows.length).map(group => <Section key={group.id} title={`${group.title} · ${group.rows.length}`} description={group.description}>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {group.rows.map(node => {
          const top = node.signals.find(signal => signal.severity === 'high') ?? node.signals.find(signal => signal.severity === 'medium') ?? node.signals[0];
          return <li key={node.key} className="space-y-2 py-3">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openNode(node.key)}>
                <span className="flex items-center gap-2"><span className="truncate text-sm font-medium hover:underline">{node.name}</span><HealthBadge health={node.health} />{node.abc && <Pill tone="muted">{node.abc}{node.xyz ?? ''}</Pill>}</span>
                <span className="block truncate text-xs text-muted-foreground">{node.sku} · {locationName(node.locationId)} · {supplierName(node.supplierId)}</span>
              </button>
              <dl className="grid grid-cols-4 gap-x-5 text-right">
                {[[t('On hand'), formatQuantity(node.onHand, locale)], [t('Cover'), cover(node, locale, t)], [t('Runs out'), formatDay(node.stockoutDay, locale)], [t('Suggested'), node.suggestedQuantity ? formatQuantity(node.suggestedQuantity, locale) : '—']]
                  .map(([label, value]) => <div key={label}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="text-sm tabular-nums">{value}</dd></div>)}
              </dl>
            </div>
            {top && <p className="text-xs leading-relaxed text-muted-foreground">{signalText(top, t, locale, node.currency)}</p>}
            <div className="flex flex-wrap gap-2">
              {node.transferFrom && <Button size="sm" variant="secondary" onClick={() => openDialog({ kind: 'movement', initial: { mode: 'transfer', itemId: node.itemId, locationId: node.transferFrom!.locationId, toLocationId: node.locationId, quantity: node.transferFrom!.quantity } })}><ArrowLeftRight size={14} />{t('Transfer {n} from {location}', { n: node.transferFrom.quantity, location: locationName(node.transferFrom.locationId) })}</Button>}
              {node.supplierId && node.suggestedQuantity > 0 && <Button size="sm" variant={node.transferFrom ? 'ghost' : 'secondary'} onClick={() => openDialog({ kind: 'new-order', initial: { supplierId: node.supplierId!, locationId: node.locationId, lines: nodeOrderLines(node) } })}><ShoppingCart size={14} />{t('Order {n}', { n: formatQuantity(node.suggestedQuantity, locale) })}</Button>}
              {(() => {
                // Supply already on order: the move is to pull it forward, not to order more.
                const rescue = node.signals.find(signal => signal.code === 'stockout_before_supply' && signal.values.po)?.values.po;
                const arrival = node.arrivals.find(entry => entry.overdue) ?? node.arrivals.find(entry => entry.poNumber === rescue) ?? (node.suggestedQuantity === 0 && ['stockout', 'critical'].includes(node.health) ? node.arrivals[0] : undefined);
                return arrival && <Button size="sm" variant="secondary" onClick={() => openOrder(arrival.poId)}><Truck size={14} />{arrival.overdue ? t('Chase PO-{n}', { n: arrival.poNumber }) : t('Expedite PO-{n}', { n: arrival.poNumber })}</Button>;
              })()}
              <Button size="sm" variant="ghost" onClick={() => openNode(node.key)}>{t('Details')}</Button>
            </div>
          </li>;
        })}
      </ul>
    </Section>)}
    <p className="text-xs text-muted-foreground">{t('Projection through {day}. Overdue orders are assumed to arrive late, never as already received.', { day: formatDay(plan.horizonEnd, locale) })}</p>
  </div>;
}

// ---------------------------------------------------------------------------

type SortKey = 'priority' | 'name' | 'onHand' | 'cover' | 'value' | 'demand';

export function ScmInventory({ health, onHealth }: { health: ScmHealth | null; onHealth: (health: ScmHealth | null) => void }) {
  const { t, locale } = useI18n();
  const { nodes, data, openNode, openDialog, locationName, locationId } = useScmSurface();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<SortKey>('priority');
  const categories = useMemo(() => [...new Set(nodes.map(node => node.category).filter(Boolean) as string[])].sort(), [nodes]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = nodes.filter(node => (!health || node.health === health) && (!category || node.category === category)
      && (!needle || node.name.toLowerCase().includes(needle) || node.sku.toLowerCase().includes(needle)));
    const by: Record<SortKey, (a: ScmNode, b: ScmNode) => number> = {
      priority: () => 0, name: (a, b) => a.name.localeCompare(b.name), onHand: (a, b) => b.onHand - a.onHand,
      cover: (a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity), value: (a, b) => b.inventoryValue - a.inventoryValue, demand: (a, b) => b.dailyDemand - a.dailyDemand,
    };
    return sort === 'priority' ? filtered : [...filtered].sort(by[sort]);
  }, [nodes, health, category, query, sort]);
  const unstocked = data.items.filter(item => item.active && !nodes.some(node => node.itemId === item.id));
  const sortButton = (key: SortKey, label: string) => <th className={`${TH} ${key === 'name' ? '' : 'text-right'}`}>
    <button type="button" className={`hover:text-foreground ${sort === key ? 'text-foreground' : ''}`} aria-pressed={sort === key} onClick={() => setSort(sort === key ? 'priority' : key)}>{label}</button>
  </th>;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-xs"><Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input aria-label={t('Search items')} placeholder={t('Search SKU or name…')} className={`${SCM_INPUT} pl-7`} value={query} onChange={event => setQuery(event.target.value)} /></div>
      {categories.length > 0 && <select aria-label={t('Category')} className={`${SCM_INPUT} w-auto text-foreground`} value={category} onChange={event => setCategory(event.target.value)}>
        <option value="">{t('All categories')}</option>{categories.map(entry => <option key={entry} value={entry}>{entry}</option>)}
      </select>}
      {health && <Button size="sm" variant="secondary" onClick={() => onHealth(null)}>{t(HEALTH_LABEL[health])} ✕</Button>}
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: 'movement', initial: { locationId: locationId ?? undefined } })}><SquarePen size={14} />{t('Record movement')}</Button>
        <Button size="sm" variant="secondary" onClick={() => openDialog({ kind: 'item', item: null })}><Plus size={14} />{t('Add item')}</Button>
      </div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-[var(--border-subtle)]">
          {sortButton('name', t('Item'))}
          {!locationId && <th className={TH}>{t('Location')}</th>}
          <th className={TH}>{t('Class')}</th>
          {sortButton('onHand', t('On hand'))}
          {sortButton('demand', t('Demand / day'))}
          {sortButton('cover', t('Cover'))}
          <th className={`${TH} text-right`}>{t('Reorder point')}</th>
          <th className={`${TH} text-right`}>{t('Incoming')}</th>
          {sortButton('value', t('Value'))}
          <th className={TH}>{t('Status')}</th>
        </tr></thead>
        <tbody>{rows.map(node => <tr key={node.key} className="cursor-pointer border-b border-[var(--border-subtle)] hover:bg-muted/40" onClick={() => openNode(node.key)}>
          <td className={`${TD} max-w-72`}><span className="block truncate font-medium">{node.name}</span><span className="block truncate text-xs text-muted-foreground">{node.sku}{node.category ? ` · ${node.category}` : ''}</span></td>
          {!locationId && <td className={`${TD} text-muted-foreground`}>{locationName(node.locationId)}</td>}
          <td className={`${TD} text-muted-foreground`}>{node.abc ? `${node.abc}${node.xyz ?? ''}` : '—'}</td>
          <td className={`${TD} text-right`}>{formatQuantity(node.onHand, locale)}</td>
          <td className={`${TD} text-right`}>{formatQuantity(node.dailyDemand, locale)}</td>
          <td className={`${TD} text-right ${node.daysOfCover !== null && node.daysOfCover < node.leadTime ? 'text-[var(--status-danger)]' : ''}`}>{cover(node, locale, t)}</td>
          <td className={`${TD} text-right`}>{formatQuantity(node.reorderPoint, locale, 0)}</td>
          <td className={`${TD} text-right`}>{node.onOrder || node.inDraft ? formatQuantity(node.onOrder + node.inDraft, locale) : '—'}</td>
          <td className={`${TD} text-right`}>{formatMoney(node.inventoryValue, node.currency, locale)}</td>
          <td className={TD}><HealthBadge health={node.health} /></td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('No items match.')}</p>}
    </div>
    {unstocked.length > 0 && !health && !query && <p className="text-xs text-muted-foreground">{t('{n} items have no stock or history at this location yet: {names}.', { n: unstocked.length, names: unstocked.slice(0, 5).map(item => item.sku).join(', ') })}</p>}
  </div>;
}

// ---------------------------------------------------------------------------

type OrderFilter = 'open' | 'draft' | 'received' | 'all';
const OPEN: ScmPoStatus[] = ['approved', 'sent', 'partial'];

export function ScmOrders() {
  const { t, locale } = useI18n();
  const { data, openOrder, openDialog, locationName, supplierName, locationId } = useScmSurface();
  const [filter, setFilter] = useState<OrderFilter>('open');
  const orders = data.orders.filter(order => (!locationId || order.locationId === locationId) && (
    filter === 'all' || (filter === 'open' && OPEN.includes(order.status)) || order.status === filter));
  const count = (value: OrderFilter) => data.orders.filter(order => (!locationId || order.locationId === locationId) && (value === 'all' || (value === 'open' ? OPEN.includes(order.status) : order.status === value))).length;
  const sorted = filter === 'open' ? [...orders].sort((a, b) => a.expectedOn.localeCompare(b.expectedOn)) : orders;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-1">
      {(['open', 'draft', 'received', 'all'] as OrderFilter[]).map(value => <Button key={value} shape="tab" size="sm" variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} onClick={() => setFilter(value)}>
        {t(value === 'open' ? 'Open' : value === 'draft' ? 'Awaiting approval' : value === 'received' ? 'Received' : 'All')}<span className="text-xs tabular-nums text-muted-foreground">{count(value)}</span>
      </Button>)}
      <Button className="ml-auto" size="sm" variant="secondary" onClick={() => openDialog({ kind: 'new-order', initial: { locationId: locationId ?? undefined } })}><Plus size={14} />{t('New order')}</Button>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-[var(--border-subtle)]">
          <th className={TH}>{t('Order')}</th><th className={TH}>{t('Supplier')}</th>{!locationId && <th className={TH}>{t('Deliver to')}</th>}
          <th className={TH}>{t('Status')}</th><th className={TH}>{t('Ordered')}</th><th className={TH}>{t('Expected')}</th>
          <th className={`${TH} text-right`}>{t('Lines')}</th><th className={`${TH} text-right`}>{t('Value')}</th>
        </tr></thead>
        <tbody>{sorted.map(order => {
          const overdue = OPEN.includes(order.status) && order.expectedOn < data.today;
          const value = order.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
          return <tr key={order.id} className="cursor-pointer border-b border-[var(--border-subtle)] hover:bg-muted/40" onClick={() => openOrder(order.id)}>
            <td className={TD}><span className="font-medium">PO-{order.number}</span>{order.source !== 'human' && <span className="ml-2"><Pill tone="info">{order.source === 'copilot' ? 'Copilot' : t('Autopilot')}</Pill></span>}</td>
            <td className={`${TD} max-w-48 truncate`}>{supplierName(order.supplierId)}</td>
            {!locationId && <td className={`${TD} text-muted-foreground`}>{locationName(order.locationId)}</td>}
            <td className={TD}><Pill tone={order.status === 'draft' ? 'warning' : order.status === 'cancelled' ? 'muted' : order.status === 'received' ? 'success' : overdue ? 'danger' : 'info'}>{overdue ? t('Overdue') : t(PO_STATUS_LABEL[order.status])}</Pill></td>
            <td className={`${TD} text-muted-foreground`}>{formatDay(order.orderedOn, locale)}</td>
            <td className={`${TD} ${overdue ? 'text-[var(--status-danger)]' : ''}`}>{formatDay(order.status === 'received' ? order.receivedOn : order.expectedOn, locale)}{overdue && <span className="ml-1 text-xs">({t('{n}d late', { n: -daysFrom(data.today, order.expectedOn) })})</span>}</td>
            <td className={`${TD} text-right`}>{order.lines.length}</td>
            <td className={`${TD} text-right`}>{formatMoney(value, order.currency, locale)}</td>
          </tr>;
        })}</tbody>
      </table>
      {!sorted.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('No orders here.')}</p>}
    </div>
  </div>;
}

// ---------------------------------------------------------------------------

export function ScmSuppliers() {
  const { t, locale } = useI18n();
  const { plan, data, openDialog, go } = useScmSurface();
  const records = new Map(data.suppliers.map(supplier => [supplier.id, supplier]));
  return <div className="space-y-4">
    <div className="flex justify-between gap-2">
      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{t('Scores weigh on-time delivery (70%) and lead-time consistency (30%), from every order received in the last year. Late suppliers are planned at the lead time they actually deliver.')}</p>
      <Button size="sm" variant="secondary" onClick={() => openDialog({ kind: 'supplier', supplierId: null })}><Plus size={14} />{t('Add supplier')}</Button>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      {plan.suppliers.map(supplier => {
        const record = records.get(supplier.supplierId);
        const tone = supplier.score === null ? 'muted' : supplier.score >= 85 ? 'success' : supplier.score >= 65 ? 'warning' : 'danger';
        return <article key={supplier.supplierId} className="space-y-3 rounded-lg border border-[var(--border-subtle)] p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold">{supplier.name}</h3>
              <p className="truncate text-xs text-muted-foreground">{[record?.contact, record?.email].filter(Boolean).join(' · ') || t('No contact recorded')}</p>
            </div>
            <Pill tone={tone}>{supplier.score === null ? t('No history') : t('Score {n}', { n: supplier.score })}</Pill>
          </div>
          <dl className="grid grid-cols-3 gap-3">
            {[
              [t('On time'), supplier.onTimeRate === null ? '—' : `${Math.round(supplier.onTimeRate * 100)}%`],
              [t('Lead time'), supplier.averageLeadTime === null ? t('{n}d promised', { n: formatQuantity(supplier.promisedLeadTime, locale) }) : t('{actual}d vs {promised}d', { actual: formatQuantity(supplier.averageLeadTime, locale), promised: formatQuantity(supplier.promisedLeadTime, locale) })],
              [t('Variability'), supplier.samples >= 3 ? t('±{n}d', { n: formatQuantity(supplier.leadTimeSd, locale) }) : '—'],
              [t('Open orders'), supplier.overdueOrders ? t('{n} ({late} late)', { n: supplier.openOrders, late: supplier.overdueOrders }) : String(supplier.openOrders)],
              [t('Open value'), formatMoney(supplier.openValue, supplier.currency, locale)],
              [t('Spend, {n} days', { n: data.policy.lookbackDays }), formatMoney(supplier.spendLookback, supplier.currency, locale)],
            ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="truncate text-[11px] text-muted-foreground">{label}</dt><dd className={`truncate text-sm tabular-nums ${label === t('Open orders') && supplier.overdueOrders ? 'text-[var(--status-danger)]' : ''}`}>{value}</dd></div>)}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: 'supplier', supplierId: supplier.supplierId })}>{t('Edit')}</Button>
            <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: 'new-order', initial: { supplierId: supplier.supplierId } })}>{t('New order')}</Button>
            <Button size="sm" variant="ghost" onClick={() => go('scenarios', { scmSupplierDelay: supplier.supplierId })}>{t('Simulate a delay')}</Button>
            <span className="ml-auto self-center text-xs text-muted-foreground">{t('{n} items', { n: supplier.itemCount })}</span>
          </div>
        </article>;
      })}
    </div>
    {!plan.suppliers.length && <button type="button" className={`${SCM_ROW} p-6 text-center text-sm text-muted-foreground`} onClick={() => openDialog({ kind: 'supplier', supplierId: null })}>{t('Add your first supplier.')}</button>}
  </div>;
}
