'use client';

import { FlaskConical, Pencil, ShoppingCart } from 'lucide-react';
import { Button } from '@/ui/button';
import { PageHead } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { RailRow } from '@/Function/shared/RailRow';
import { RecordPage, RecordSection } from '@/Function/shared/tool/RecordPage';
import { ScmIcon } from '@/Function/shared/conceptIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { formatDay, formatMoney, formatQuantity, PO_STATUS_LABEL } from './scmText';
import { Pill } from './ScmParts';
import { useScmSurface } from './scmSurface';

/** One supplier: how it really delivers, and every order placed with it. */
export function ScmSupplierPage({ supplierId, onBack, onOpenSuppliers }: { supplierId: string; onBack: () => void; onOpenSuppliers: () => void }) {
  const { t, locale } = useI18n();
  const { data, plan, go, openOrder, openDialog, domainName, locationName } = useScmSurface();
  const record = data.suppliers.find(supplier => supplier.id === supplierId);
  const stats = plan.suppliers.find(supplier => supplier.supplierId === supplierId);
  if (!record) return <RecordPage icon={ScmIcon} crumbs={[{ label: t('Suppliers'), onClick: onOpenSuppliers }, { label: '—' }]} onBack={onBack} rail={null}>
    <p className="text-sm text-muted-foreground">{t('This supplier is not in the shown scope.')}</p>
  </RecordPage>;
  const orders = data.orders.filter(order => order.supplierId === supplierId).sort((a, b) => b.orderedOn.localeCompare(a.orderedOn)).slice(0, 40);
  const tone = !stats || stats.score === null ? 'muted' : stats.score >= 85 ? 'success' : stats.score >= 65 ? 'warning' : 'danger';
  const q = (value: number | null | undefined) => formatQuantity(value ?? null, locale);

  const rail = <>
    <RailCard title={t('Properties')}>
      <RailRow name={t('Lead time')} dense label={stats && stats.averageLeadTime !== null
        ? t('{actual}d vs {promised}d', { actual: q(stats.averageLeadTime), promised: q(stats.promisedLeadTime) })
        : t('{n}d promised', { n: q(record.leadTimeDays) })} />
      <RailRow name={t('Variability')} dense label={stats && stats.samples >= 3 ? t('±{n}d', { n: q(stats.leadTimeSd) }) : '—'} placeholder={!stats || stats.samples < 3} />
      <RailRow name={t('Currency')} dense label={record.currency} />
      <RailRow name={t('Domain')} dense label={domainName(record.domainId) ?? t('Shared by the Space')} placeholder={!record.domainId} />
      <RailRow name={t('Contact')} dense label={record.contact ?? '—'} placeholder={!record.contact} />
      <RailRow name={t('Email')} dense label={record.email ?? '—'} placeholder={!record.email} />
      <RailRow name={t('Items')} dense label={String(stats?.itemCount ?? 0)} placeholder={!stats?.itemCount} />
    </RailCard>
    <RailCard title={t('Performance')}>
      <RailRow name={t('Score')} dense label={<Pill tone={tone}>{!stats || stats.score === null ? t('No history') : String(stats.score)}</Pill>} />
      <RailRow name={t('On time')} dense label={stats?.onTimeRate == null ? '—' : `${Math.round(stats.onTimeRate * 100)}%`} placeholder={stats?.onTimeRate == null} />
      <RailRow name={t('Open orders')} dense label={stats?.overdueOrders ? <span className="text-[var(--status-danger)]">{t('{n} ({late} late)', { n: stats.openOrders, late: stats.overdueOrders })}</span> : String(stats?.openOrders ?? 0)} />
      <RailRow name={t('Open value')} dense label={stats ? formatMoney(stats.openValue, stats.currency, locale) : '—'} />
      <RailRow name={t('Spend, {n} days', { n: data.policy.lookbackDays })} dense label={stats ? formatMoney(stats.spendLookback, stats.currency, locale) : '—'} />
    </RailCard>
  </>;

  return <RecordPage icon={ScmIcon} crumbs={[{ label: t('Suppliers'), onClick: onOpenSuppliers }, { label: record.name }]} onBack={onBack} rail={rail}
    actions={<>
      <Button size="sm" variant="ghost" onClick={() => go('scenarios', { scmSupplierDelay: supplierId })}><FlaskConical size={14} />{t('Simulate a delay')}</Button>
      <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: 'supplier', supplierId })}><Pencil size={14} />{t('Edit')}</Button>
      <Button size="sm" variant="secondary" onClick={() => openDialog({ kind: 'new-order', initial: { supplierId } })}><ShoppingCart size={14} />{t('New order')}</Button>
    </>}>
    <PageHead icon={<ScmIcon size={18} />} title={record.name} description={record.notes ?? ''} canEdit={false}
      titleLabel={t('Supplier')} titlePlaceholder="" descriptionLabel={t('Notes')} descriptionPlaceholder="" onSaveTitle={() => {}} />
    <RecordSection title={t('Purchase orders')}>
      {orders.length ? <ul className="max-w-3xl divide-y divide-[var(--border-subtle)]">{orders.map(order => {
        const open = ['approved', 'sent', 'partial'].includes(order.status);
        const overdue = open && order.expectedOn < data.today;
        const value = order.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
        return <li key={order.id}><button type="button" className="flex w-full flex-wrap items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted/40" onClick={() => openOrder(order.id)}>
          <span className="font-medium">PO-{order.number}</span>
          <Pill tone={order.status === 'draft' ? 'warning' : order.status === 'received' ? 'success' : order.status === 'cancelled' ? 'muted' : overdue ? 'danger' : 'info'}>{overdue ? t('Overdue') : t(PO_STATUS_LABEL[order.status])}</Pill>
          <span className="text-xs text-muted-foreground">{locationName(order.locationId)}</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{formatMoney(value, order.currency, locale)} · {order.status === 'received' && order.receivedOn ? t('Received {day}', { day: formatDay(order.receivedOn, locale) }) : t('Expected {day}', { day: formatDay(order.expectedOn, locale) })}</span>
        </button></li>;
      })}</ul> : <p className="text-sm text-muted-foreground">{t('No orders with this supplier yet.')}</p>}
    </RecordSection>
  </RecordPage>;
}
