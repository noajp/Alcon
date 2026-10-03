'use client';

import { useMemo } from 'react';
import { ArrowLeft, ArrowLeftRight, MessageSquare, Pencil, ShoppingCart, SquarePen } from 'lucide-react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { addDays, type ScmNode } from './scmEngine';
import { formatDay, formatMoney, formatQuantity, PO_STATUS_LABEL, signalText } from './scmText';
import { HealthBadge, Pill, Reading, Section } from './ScmParts';
import { useScmSurface } from './scmSurface';
import { nodeOrderLines } from './ScmForms';

const METHOD_LABEL = { holt_weekly: 'Trend + weekly pattern', holt: 'Trend', baseline: 'Stated baseline', none: 'Average' } as const;
const AXIS = { fontSize: 11, fill: 'var(--muted-foreground)' };
const TOOLTIP = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 };

/** One item at one location: where its stock is heading, why the plan says what it says. */
export function ScmItemDetail({ node, onBack }: { node: ScmNode; onBack: () => void }) {
  const { t, locale } = useI18n();
  const { plan, data, go, openNode, openOrder, openDialog, askCopilot, locationName, supplierName } = useScmSurface();
  const item = data.items.find(entry => entry.id === node.itemId) ?? null;
  const siblings = plan.nodes.filter(entry => entry.itemId === node.itemId);
  const q = (value: number | null, digits = 1) => formatQuantity(value, locale, digits);

  const projection = useMemo(() => node.projection.map(point => ({ ...point, label: formatDay(point.day, locale) })), [node.projection, locale]);
  const history = useMemo(() => {
    const points = new Map<string, number>();
    for (const entry of data.demand) if (entry.itemId === node.itemId && entry.locationId === node.locationId) points.set(entry.day, (points.get(entry.day) ?? 0) + entry.quantity);
    const days = Math.min(data.policy.lookbackDays, 90);
    const rows: { label: string; actual: number | null; forecast: number | null }[] = [];
    for (let offset = -days; offset < 0; offset++) {
      const day = addDays(data.today, offset);
      rows.push({ label: formatDay(day, locale), actual: points.get(day) ?? 0, forecast: null });
    }
    node.forecast.daily.slice(0, 28).forEach((value, index) => rows.push({ label: formatDay(addDays(data.today, index), locale), actual: null, forecast: Math.round(value * 100) / 100 }));
    return rows;
  }, [data.demand, data.policy.lookbackDays, data.today, node, locale]);

  const orders = data.orders.filter(order => order.locationId === node.locationId && order.lines.some(line => line.itemId === node.itemId)).slice(0, 8);
  const stats = node.supplierId ? plan.suppliers.find(supplier => supplier.supplierId === node.supplierId) : null;
  const promised = item?.leadTimeDays ?? data.suppliers.find(supplier => supplier.id === node.supplierId)?.leadTimeDays ?? null;
  const z = node.serviceLevel;

  return <div className="space-y-8">
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} />{t('Back')}</Button>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{node.name}</h2><HealthBadge health={node.health} />{node.abc && <Pill tone="muted">{t('Class {c}', { c: `${node.abc}${node.xyz ?? ''}` })}</Pill>}</div>
          <p className="text-sm text-muted-foreground">{node.sku}{node.category ? ` · ${node.category}` : ''} · {supplierName(node.supplierId)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => askCopilot(t('Explain the stock plan for {sku} {name} at {location}: is the forecast credible, is the safety stock right, and what should I do now?', { sku: node.sku, name: node.name, location: locationName(node.locationId) }))}><MessageSquare size={14} />{t('Ask AI')}</Button>
          <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: 'movement', initial: { itemId: node.itemId, locationId: node.locationId } })}><SquarePen size={14} />{t('Record movement')}</Button>
          {item && <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: 'item', item })}><Pencil size={14} />{t('Edit')}</Button>}
          {node.transferFrom && <Button size="sm" variant="secondary" onClick={() => openDialog({ kind: 'movement', initial: { mode: 'transfer', itemId: node.itemId, locationId: node.transferFrom!.locationId, toLocationId: node.locationId, quantity: node.transferFrom!.quantity } })}><ArrowLeftRight size={14} />{t('Transfer {n}', { n: node.transferFrom.quantity })}</Button>}
          {node.supplierId && <Button size="sm" variant="primary" onClick={() => openDialog({ kind: 'new-order', initial: { supplierId: node.supplierId!, locationId: node.locationId, lines: nodeOrderLines(node) } })}><ShoppingCart size={14} />{t('Order')}</Button>}
        </div>
      </div>
      {siblings.length > 1 && <div className="flex flex-wrap gap-1">{siblings.map(entry => <Button key={entry.key} shape="tab" size="sm" variant={entry.key === node.key ? 'secondary' : 'ghost'} aria-pressed={entry.key === node.key} onClick={() => openNode(entry.key)}>
        {locationName(entry.locationId)}<span className="text-xs tabular-nums text-muted-foreground">{q(entry.onHand)}</span>
      </Button>)}</div>}
    </div>

    {node.signals.length > 0 && <ul className="space-y-1.5">{node.signals.map((signal, index) => <li key={index} className="flex items-start gap-2 text-sm">
      <Pill tone={signal.severity === 'high' ? 'danger' : signal.severity === 'medium' ? 'warning' : 'muted'}>{t(signal.severity === 'high' ? 'Act now' : signal.severity === 'medium' ? 'Plan' : 'Watch')}</Pill>
      <span className="leading-relaxed">{signalText(signal, t, locale, node.currency)}</span>
    </li>)}</ul>}

    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
      <Reading label={t('On hand')} value={`${q(node.onHand)} ${node.unit}`} hint={formatMoney(node.inventoryValue, node.currency, locale)} />
      <Reading label={t('Incoming')} value={q(node.onOrder)} hint={node.inDraft ? t('+{n} in drafts', { n: q(node.inDraft) }) : undefined} />
      <Reading label={t('On-hand cover (days)')} value={node.daysOfCover === null ? '—' : q(node.daysOfCover, 0)} hint={node.stockoutDay ? t('Runs out {day}', { day: formatDay(node.stockoutDay, locale) }) : t('No stockout in {n} days', { n: data.policy.horizonDays })} />
      <Reading label={t('Reorder point')} value={q(node.reorderPoint, 0)} hint={t('Order up to {n}', { n: q(node.orderUpTo, 0) })} />
      <Reading label={t('Safety stock')} value={q(node.safetyStock, 0)} hint={t('{n}% service level', { n: Math.round(z * 1000) / 10 })} />
      <Reading label={t('Suggested order')} value={node.suggestedQuantity ? q(node.suggestedQuantity) : '—'} hint={node.suggestedQuantity ? formatMoney(node.suggestedValue, node.currency, locale) : undefined} />
    </dl>

    <Section title={t('Stock projection')} description={t('Solid: only the orders already placed. Dashed: following the plan, with every proposed and future order on time. Bars: arrivals.')}>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <ComposedChart data={projection} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
            <Tooltip contentStyle={TOOLTIP} formatter={(value, name) => [q(Number(value)), t(String(name))]} />
            <ReferenceLine y={node.reorderPoint} stroke="var(--status-warning)" strokeDasharray="4 4" label={{ value: t('Reorder point'), position: 'insideTopRight', fontSize: 10, fill: 'var(--status-warning)' }} />
            <ReferenceLine y={node.safetyStock} stroke="var(--status-danger)" strokeDasharray="2 4" label={{ value: t('Safety stock'), position: 'insideBottomRight', fontSize: 10, fill: 'var(--status-danger)' }} />
            <Bar dataKey="arrivals" name="Arrivals" fill="var(--status-success)" opacity={0.5} barSize={6} />
            <Area type="stepAfter" dataKey="stock" name="Projected stock" stroke="var(--accent-default)" fill="var(--accent-subtle)" strokeWidth={1.5} />
            {node.dailyDemand > 0 && <Line type="stepAfter" dataKey="planned" name="Following the plan" stroke="var(--accent-default)" strokeDasharray="5 4" dot={false} strokeWidth={1.5} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Section>

    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Section title={t('Demand and forecast')} description={t('{method}. Accuracy on the last 14 days: {wape}.', { method: t(METHOD_LABEL[node.forecast.method]), wape: node.forecast.wape === null ? t('not enough history') : t('{n}% error (WAPE)', { n: Math.round(node.forecast.wape * 100) }) })}>
        <div className="h-52 w-full">
          <ResponsiveContainer>
            <ComposedChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={32} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} />
              <Tooltip contentStyle={TOOLTIP} formatter={(value, name) => [q(Number(value)), t(String(name))]} />
              <Bar dataKey="actual" name="Actual" fill="var(--muted-foreground)" opacity={0.45} />
              <Line type="monotone" dataKey="forecast" name="Forecast" stroke="var(--accent-default)" dot={false} strokeWidth={1.5} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title={t('Why this plan')} description={t('Every number below comes from the ledger, the orders and the policy.')}>
        <dl className="space-y-2 text-xs">
          {[
            [t('Daily demand'), t('{d} ± {s} per day', { d: q(node.dailyDemand), s: q(node.forecast.sigma) }), node.forecast.censoredDays ? t('Forecast over lead time + review, from {n} days of history; {c} stockout days filled in', { n: node.forecast.historyDays, c: node.forecast.censoredDays }) : t('Forecast over lead time + review, from {n} days of history', { n: node.forecast.historyDays })],
            [t('Lead time'), t('{n} days', { n: q(node.leadTime) }), promised !== null && Math.abs(node.leadTime - promised) > 0.05 ? t('Promised {p} days; this supplier delivers {d} days late on average', { p: q(promised), d: q(node.leadTime - promised) }) : t('As promised')],
            [t('Lead-time spread'), t('± {n} days', { n: q(node.leadTimeSd) }), stats?.samples ? t('From {n} received orders', { n: stats.samples }) : t('No receipts yet')],
            [t('Safety stock'), q(node.safetyStock, 0), t('z({level}) × √((L+R)·σ² + d²·σL²)', { level: `${Math.round(z * 1000) / 10}%` })],
            [t('Reorder point'), q(node.reorderPoint, 0), t('Demand over lead time + {r}-day review + safety stock', { r: data.policy.reviewDays })],
            [t('Order-up-to'), q(node.orderUpTo, 0), t('Reorder point + another {r} days of demand', { r: data.policy.reviewDays })],
            [t('Inventory position'), q(node.inventoryPosition), t('On hand + incoming + drafts')],
            [t('Economic order quantity'), node.eoq === null ? '—' : q(node.eoq, 0), node.eoq === null ? t('Set an ordering cost in the policy to use EOQ') : t('Orders are at least this size, capped at 120 days of demand')],
          ].map(([label, value, hint]) => <div key={label} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd><span className="text-sm tabular-nums text-foreground">{value}</span><span className="block text-muted-foreground">{hint}</span></dd>
          </div>)}
        </dl>
      </Section>
    </div>

    <Section title={t('Orders')} action={<Button size="sm" variant="ghost" onClick={() => go('ledger', { scmLedgerItemId: node.itemId })}>{t('Stock ledger')}</Button>}>
      {orders.length ? <ul className="divide-y divide-[var(--border-subtle)]">{orders.map(order => {
        const line = order.lines.find(entry => entry.itemId === node.itemId)!;
        const overdue = ['approved', 'sent', 'partial'].includes(order.status) && order.expectedOn < data.today;
        return <li key={order.id}><button type="button" className="flex w-full flex-wrap items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted/40" onClick={() => openOrder(order.id)}>
          <span className="font-medium">PO-{order.number}</span>
          <Pill tone={order.status === 'draft' ? 'warning' : order.status === 'received' ? 'success' : order.status === 'cancelled' ? 'muted' : overdue ? 'danger' : 'info'}>{overdue ? t('Overdue') : t(PO_STATUS_LABEL[order.status])}</Pill>
          <span className="tabular-nums">{q(line.receivedQuantity)} / {q(line.quantity)}</span>
          <span className="ml-auto text-xs text-muted-foreground">{order.status === 'received' && order.receivedOn ? t('Received {day}', { day: formatDay(order.receivedOn, locale) }) : t('Expected {day}', { day: formatDay(order.expectedOn, locale) })}</span>
        </button></li>;
      })}</ul> : <p className="text-sm text-muted-foreground">{t('No orders for this item here yet.')}</p>}
    </Section>
  </div>;
}
