'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { CrmDeal } from '@/Function/crm/crmModel';
import { HealthDot, money, relativeDay } from './crmFormat';

type SortKey = 'name' | 'stage' | 'owner' | 'amount' | 'probability' | 'closeDate' | 'nextActionDate' | 'lastContact' | 'health';
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Deal' }, { key: 'stage', label: 'Stage' }, { key: 'owner', label: 'Owner' }, { key: 'amount', label: 'Amount', numeric: true },
  { key: 'probability', label: 'Prob.', numeric: true }, { key: 'closeDate', label: 'Close date' },
  { key: 'nextActionDate', label: 'Next action' }, { key: 'lastContact', label: 'Last contact' }, { key: 'health', label: 'Health', numeric: true },
];

function sortValue(deal: CrmDeal, key: SortKey): string | number | null {
  switch (key) {
    case 'name': return deal.name.toLowerCase();
    case 'stage': return deal.outcome === 'won' ? 900 : deal.outcome === 'lost' ? 901 : deal.stage?.probability ?? -1;
    case 'health': return deal.health.score;
    case 'owner': return deal.ownerName?.toLowerCase() ?? null;
    default: return deal[key];
  }
}

/** Every deal in one dense, sortable list. Empty values always sort last. */
export function CrmDeals({ deals, today, onOpen, selectedId, emptyLabel }: {
  deals: CrmDeal[]; today: string; onOpen: (id: string) => void; selectedId: string | null; emptyLabel: string;
}) {
  const { t, locale } = useI18n();
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'nextActionDate', descending: false });
  const [limit, setLimit] = useState(100);
  const sorted = useMemo(() => [...deals].sort((a, b) => {
    const left = sortValue(a, sort.key); const right = sortValue(b, sort.key);
    if (left === right) return a.name.localeCompare(b.name);
    if (left === null) return 1;
    if (right === null) return -1;
    return (left < right ? -1 : 1) * (sort.descending ? -1 : 1);
  }), [deals, sort]);

  if (!deals.length) return <p className="py-10 text-sm text-muted-foreground">{emptyLabel}</p>;
  return <div className="space-y-3">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[840px] text-left text-[13px]">
        <thead className="border-b border-[var(--border-subtle)] text-xs text-muted-foreground"><tr>
          {COLUMNS.map(column => {
            const active = sort.key === column.key;
            return <th key={column.key} scope="col" aria-sort={active ? sort.descending ? 'descending' : 'ascending' : undefined} className={`whitespace-nowrap px-2 py-2 font-medium first:pl-0 ${column.numeric ? 'text-right' : ''}`}>
              <button type="button" className={`inline-flex items-center gap-1 rounded-sm hover:text-foreground ${active ? 'text-foreground' : ''}`}
                onClick={() => setSort(current => ({ key: column.key, descending: current.key === column.key ? !current.descending : !!column.numeric }))}>
                {t(column.label)}{active && (sort.descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
              </button>
            </th>;
          })}
        </tr></thead>
        <tbody>{sorted.slice(0, limit).map(deal => {
          const late = deal.outcome === 'open' && deal.nextActionDate && deal.nextActionDate < today;
          return <tr key={deal.id} onClick={() => onOpen(deal.id)} aria-current={deal.id === selectedId ? 'true' : undefined}
            className={`cursor-pointer hover:bg-muted/40 ${deal.id === selectedId ? 'bg-muted/40' : ''}`}>
            <td className="max-w-72 py-2 pr-2">
              <button type="button" className="block max-w-full truncate rounded-sm text-left font-medium" onClick={event => { event.stopPropagation(); onOpen(deal.id); }}>{deal.name}</button>
              <span className="block truncate text-xs text-muted-foreground">{[deal.account, deal.contact].filter(Boolean).join(' · ') || '—'}</span>
            </td>
            <td className="whitespace-nowrap px-2 py-2">{deal.outcome === 'won' ? <span className="text-foreground">{t('Won')}</span> : deal.outcome === 'lost' ? <span className="text-muted-foreground">{t('Lost')}</span> : deal.stage ? t(deal.stage.label) : '—'}</td>
            <td className="max-w-32 truncate whitespace-nowrap px-2 py-2 text-muted-foreground">{deal.ownerName ?? '—'}</td>
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{money(deal.amount, deal.currency, locale, true)}</td>
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{deal.probability ?? '—'}{deal.probability !== null && '%'}</td>
            <td className="whitespace-nowrap px-2 py-2 tabular-nums">{relativeDay(deal.closeDate, today, locale, t)}</td>
            <td className={`max-w-56 px-2 py-2 ${late ? 'text-[var(--status-danger)]' : ''}`}>
              <span className="block truncate tabular-nums">{deal.outcome === 'open' ? relativeDay(deal.nextActionDate, today, locale, t) : '—'}</span>
              {deal.nextStep && deal.outcome === 'open' && <span className="block truncate text-xs text-muted-foreground">{deal.nextStep}</span>}
            </td>
            <td className="whitespace-nowrap px-2 py-2 tabular-nums text-muted-foreground">{relativeDay(deal.lastContact, today, locale, t)}</td>
            <td className="whitespace-nowrap py-2 pl-2 text-right tabular-nums"><span className="inline-flex items-center gap-1.5"><HealthDot level={deal.health.level} />{deal.health.score ?? '—'}</span></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {sorted.length > limit && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setLimit(value => value + 100)}>{t('Show {n} more', { n: Math.min(100, sorted.length - limit) })}</button>}
  </div>;
}
