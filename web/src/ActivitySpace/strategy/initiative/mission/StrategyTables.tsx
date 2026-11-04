'use client';

import { useStrategyTables } from '@/hooks/tableData';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The Strategy's Tables: what its runs found, one thing per row (the
// candidate houses, the vendors). Each opens in the Table view.

export function StrategyTables({ strategyId, onOpen }: { strategyId: string; onOpen?: (tableId: string) => void }) {
  const { t } = useI18n();
  const { data } = useStrategyTables(strategyId);
  if (!data.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="text-muted-foreground">{t('Tables')}</span>
      {data.map((table) => (
        <button key={table.id} type="button" onClick={() => onOpen?.(table.id)} disabled={!onOpen}
          className="inline-flex h-6 items-center gap-1 rounded-[var(--control-tab-radius)] border border-[var(--border-default)] px-2 text-foreground hover:bg-muted/40">
          {table.name}
          <span className="tabular-nums text-muted-foreground">{t('{n} rows', { n: table.rowCount })}</span>
        </button>
      ))}
    </div>
  );
}
