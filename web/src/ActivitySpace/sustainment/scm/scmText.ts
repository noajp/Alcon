import type { ScmBriefingLine, ScmHealth, ScmPlan, ScmPoStatus, ScmProposal, ScmSignal } from './scmEngine';

// Wording for what the planner returns as codes and values. The engine stays
// language-free; every sentence a person reads is composed here through `t`.

export type Translate = (message: string, values?: Record<string, string | number>) => string;

export function formatMoney(value: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' || currency === 'KRW' ? 0 : 2 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString(locale)}`;
  }
}

/** Large amounts shortened for KPI tiles: ¥1.2M. */
export function formatMoneyShort(value: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value);
  } catch {
    return formatMoney(value, currency, locale);
  }
}

export function formatQuantity(value: number | null, locale: string, digits = 1) {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(locale, { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : digits });
}

export function formatDay(day: string | null, locale: string) {
  if (!day) return '—';
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function daysFrom(today: string, day: string) {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export const HEALTH_LABEL: Record<ScmHealth, string> = {
  stockout: 'Out of stock', critical: 'Stockout risk', reorder: 'Order now', healthy: 'Healthy',
  excess: 'Excess', dead: 'Dead stock', no_demand: 'No demand',
};

/** Tone per health: which status token colours it. */
export const HEALTH_TONE: Record<ScmHealth, 'danger' | 'warning' | 'success' | 'info' | 'muted'> = {
  stockout: 'danger', critical: 'danger', reorder: 'warning', healthy: 'success', excess: 'info', dead: 'muted', no_demand: 'muted',
};

export const PO_STATUS_LABEL: Record<ScmPoStatus, string> = {
  draft: 'Draft', approved: 'Approved', sent: 'Sent', partial: 'Partly received', received: 'Received', cancelled: 'Cancelled',
};

export function signalText(signal: ScmSignal, t: Translate, locale: string, currency?: string): string {
  const v: Record<string, string | number> = { ...signal.values };
  if (currency && typeof v.value === 'number') v.value = formatMoney(v.value, currency, locale);
  for (const key of ['units', 'quantity', 'onHand', 'position', 'reorderPoint', 'dailyDemand']) {
    if (typeof v[key] === 'number') v[key] = formatQuantity(v[key] as number, locale);
  }
  const day = (key: string) => formatDay(String(v[key] ?? ''), locale);
  switch (signal.code) {
    case 'negative_stock': return t('The ledger shows {onHand} on hand. Count the stock to correct it.', v);
    case 'out_of_stock': return t('Out of stock while demand runs at {dailyDemand} a day.', v);
    case 'stockout_before_supply': return v.po
      ? t('Runs out {day}; PO-{po} lands {poDay}, {days} days later. Pull it forward or bridge about {units} units.', { ...v, day: day('day'), poDay: day('poDay') })
      : t('Runs out {day}, before a new order could arrive ({earliest}). Expedite, transfer or substitute: about {units} units short.', { ...v, day: day('day'), earliest: day('earliest') });
    case 'stockout_in_horizon': return t('Runs out {day} unless the suggested order is placed now.', { ...v, day: day('day') });
    case 'below_reorder_point': return t('Stock plus incoming ({position}) is at or below the reorder point ({reorderPoint}). Order {quantity}.', v);
    case 'overdue_order': return t('PO-{po} is overdue ({quantity} units). Planned to arrive {assumed}; confirm with the supplier.', { ...v, assumed: day('assumed') });
    case 'draft_pending': return t('{quantity} units are in a draft order waiting for approval.', v);
    case 'excess_stock': return t('{units} units beyond need (worth {value}), about {cover} days of cover.', v);
    case 'dead_stock': return t('No demand in {days} days. {onHand} units (worth {value}) are tied up.', v);
    case 'unreliable_supplier': return t('{supplier} delivers on time {onTime}% of the time, {delay} days late on average. Planned at its real lead time.', v);
    case 'single_source': return t('A-class item with a single, unreliable source ({supplier}). Consider a second supplier.', v);
    case 'transfer_available': return t('{location} can spare {quantity} units. A transfer covers the gap faster than a new order.', v);
    case 'demand_rising': return t('Demand is up {change}% over the last two weeks.', v);
    case 'no_supplier': return t('No supplier is set, so no order can be proposed.');
    case 'no_history': return t('No demand recorded yet. Record issues, or set an expected daily demand on the item, to plan it.');
  }
}

export function briefingText(line: ScmBriefingLine, t: Translate, locale: string): string {
  const v = line.values;
  switch (line.kind) {
    case 'stockouts': return Number(v.count) === 1 ? t('{first} is out of stock now.', v) : t('{count} items are out of stock now, starting with {first}.', v);
    case 'critical': {
      const base = Number(v.count) === 1
        ? t('{first} will run out {day}, before a new order can arrive.', { ...v, day: formatDay(String(v.day), locale) })
        : t('{count} items will run out before a new order can arrive. First: {first} on {day}.', { ...v, day: formatDay(String(v.day), locale) });
      return Number(v.transfers) > 0 ? `${base} ${t('{transfers} can be covered by a transfer between locations.', v)}` : base;
    }
    case 'overdue': return t('{count} purchase orders are overdue ({suppliers}). The plan assumes they arrive late, not that they have arrived.', v);
    case 'proposals': return t('Proposed: {count} orders, {lines} lines, {amount}. {auto} within autopilot authority, {approval} need approval.', v);
    case 'demand': return Number(v.count) === 1 ? t('Demand for {first} is rising.', v) : t('Demand is rising for {count} items, including {first}.', v);
    case 'supplier': return t('{name} is on time {onTime}% of the time ({delay} days late on average). Its lead time is planned as observed.', v);
    case 'excess': return t('{count} items hold excess or dead stock worth {amount}.', v);
    case 'healthy': return t('No urgent supply risks. {count} of {total} item-locations are healthy.', v);
  }
}

/** The evidence written onto an order the planner proposed: the policy, and
 * for each line the numbers that produced its quantity. */
export function explainProposal(proposal: ScmProposal, plan: ScmPlan, t: Translate, locale: string, mode: 'place' | 'draft' | 'autopilot' = 'autopilot'): string {
  const nodes = new Map(plan.nodes.map(node => [node.key, node]));
  const lines = proposal.lines.map(line => {
    const node = nodes.get(line.nodeKey);
    if (!node) return `- ${line.sku}: ${line.quantity}`;
    const q = (value: number | null) => formatQuantity(value, locale);
    return `- ${line.sku} ${line.name}: ${t('order {quantity}. On hand {onHand}, incoming {onOrder}, demand {daily}/day, lead time {lead} days, reorder point {rop}, order-up-to {upTo}.', {
      quantity: q(line.quantity), onHand: q(node.onHand), onOrder: q(node.onOrder + node.inDraft), daily: q(node.dailyDemand), lead: q(node.leadTime), rop: q(node.reorderPoint), upTo: q(node.orderUpTo),
    })}${node.eoq !== null && line.quantity > node.orderUpTo - node.inventoryPosition + 1 ? ` ${t('Sized up to the economic order quantity ({eoq}).', { eoq: q(node.eoq) })}` : ''}${node.stockoutDay ? ` ${t('Runs out {day} without it.', { day: formatDay(node.stockoutDay, locale) })}` : ''}`;
  });
  const authority = mode === 'place' ? t('Placed by a person from the planner proposal.')
    : mode === 'draft' ? t('Saved as a draft for approval.')
    : proposal.authority === 'auto' ? t('Within the autopilot approval limit.')
    : proposal.authority === 'over_budget' ? t('Exceeds the remaining monthly budget; needs approval.')
    : t('Above the autopilot approval limit; needs approval.');
  return [
    t('Planned {day} at a {level}% service level, reviewing every {review} days.', { day: formatDay(plan.today, locale), level: Math.round(plan.policy.serviceLevel * 1000) / 10, review: plan.policy.reviewDays }),
    authority, '', ...lines,
  ].join('\n');
}
