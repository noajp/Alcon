'use client';

import { useMemo } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { accountsOf, type CrmDeal } from './crmModel';
import { HealthDot, moneyList, relativeDay } from './crmFormat';

/** Accounts derived from the deals' Account field — one row per customer. */
export function CrmAccounts({ deals, today, onOpenAccount }: {
  deals: CrmDeal[]; today: string; onOpenAccount: (account: string) => void;
}) {
  const { t, locale } = useI18n();
  const accounts = useMemo(() => accountsOf(deals), [deals]);
  if (!accounts.length) return <p className="py-10 text-sm text-muted-foreground">{t('Accounts appear here once deals have an Account.')}</p>;
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[680px] text-left text-[13px]">
      <thead className="text-xs text-muted-foreground"><tr>
        {['Account', 'Open deals', 'Open pipeline', 'Won', 'Last contact', 'Next action'].map(label =>
          <th key={label} scope="col" className="whitespace-nowrap px-2 py-2 font-medium first:pl-0">{t(label)}</th>)}
      </tr></thead>
      <tbody>{accounts.map(account => <tr key={account.key || 'none'} className="cursor-pointer border-t border-[var(--border-subtle)] hover:bg-muted/30" onClick={() => onOpenAccount(account.key)}>
        <td className="max-w-72 py-2 pr-2">
          <button type="button" className="flex max-w-full items-center gap-2 rounded-sm text-left font-medium" onClick={event => { event.stopPropagation(); onOpenAccount(account.key); }}>
            {account.worst && <HealthDot level={account.worst} />}<span className="truncate">{account.name ?? t('No account')}</span>
          </button>
          <span className="block pl-4 text-xs text-muted-foreground">{t('{n} deals', { n: account.deals.length })}</span>
        </td>
        <td className="px-2 py-2 tabular-nums">{account.openCount}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{moneyList(account.pipeline, locale)}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{moneyList(account.won, locale)}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums text-muted-foreground">{relativeDay(account.lastContact, today, locale, t)}</td>
        <td className={`whitespace-nowrap px-2 py-2 tabular-nums ${account.nextActionDate && account.nextActionDate < today ? 'text-[var(--status-danger)]' : ''}`}>{relativeDay(account.nextActionDate, today, locale, t)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
