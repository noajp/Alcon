'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { pipelineColumns, resolveStage, stageChange, type CrmDeal, type CrmStage, type CrmWorkspace } from '@/Function/crm/crmModel';
import { HealthDot, money, moneyList, relativeDay } from './crmFormat';
import type { Crm } from '@/hooks/useCrm';

const DRAG_TYPE = 'application/x-alcon-deal';

function DealCard({ deal, today, onOpen, selected }: { deal: CrmDeal; today: string; onOpen: (id: string) => void; selected: boolean }) {
  const { t, locale } = useI18n();
  const late = deal.outcome === 'open' && deal.nextActionDate && deal.nextActionDate < today;
  return <button type="button" draggable onClick={() => onOpen(deal.id)}
    onDragStart={event => { event.dataTransfer.setData(DRAG_TYPE, deal.id); event.dataTransfer.effectAllowed = 'move'; }}
    aria-current={selected ? 'true' : undefined}
    className={`group block w-full space-y-1.5 rounded-md border bg-[var(--surface-raised)] p-2.5 text-left transition-colors hover:border-[var(--border-strong)] ${selected ? 'border-[var(--border-strong)]' : 'border-[var(--border-subtle)]'}`}>
    <span className="flex items-start gap-2"><span className="mt-1.5"><HealthDot level={deal.health.level} /></span><span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{deal.name}</span></span>
    {deal.account && <span className="block truncate pl-4 text-xs text-muted-foreground">{deal.account}</span>}
    <span className="flex items-center justify-between gap-2 pl-4 text-xs tabular-nums">
      <span>{money(deal.amount, deal.currency, locale, true)}</span>
      <span className={late ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}>
        {deal.outcome === 'open' ? late ? t('Follow-up late') : deal.closeDate ? relativeDay(deal.closeDate, today, locale, t) : '' : ''}
      </span>
    </span>
  </button>;
}

/** Stages left to right; drag a card to move it. The deal panel's stage
 * buttons do the same from the keyboard. */
export function CrmPipeline({ crm, workspace, deals, onOpen, selectedId }: {
  crm: Crm; workspace: CrmWorkspace; deals: CrmDeal[]; onOpen: (id: string) => void; selectedId: string | null;
}) {
  const { t, locale } = useI18n();
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Show a moved card in its new column while the write is in flight.
  const shown = useMemo(() => deals.map(deal => {
    const target = moves[deal.id];
    if (target === undefined) return deal;
    const stage = resolveStage(target, workspace.stages);
    return { ...deal, stage, outcome: target === 'won' || target === 'lost' ? target : 'open' } as CrmDeal;
  }), [deals, moves, workspace.stages]);
  const columns = useMemo(() => pipelineColumns(workspace, shown), [workspace, shown]);

  async function drop(dealId: string, stage: CrmStage) {
    const deal = deals.find(item => item.id === dealId);
    if (!deal || (deal.stage?.id ?? '') === stage.id || !stage.id) return;
    setMoves(current => ({ ...current, [dealId]: stage.id }));
    setError(null);
    try { await crm.saveDeal(dealId, stageChange(deal, stage)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('Could not move the deal.')); }
    finally { setMoves(current => { const next = { ...current }; delete next[dealId]; return next; }); }
  }

  return <div className="space-y-3">
    {error && <p role="alert" className="text-sm text-[var(--status-danger)]">{error}</p>}
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-8 sm:px-8" role="list" aria-label={t('Pipeline')}>
      {columns.map(column => {
        const weighted = column.closed ? null : column.deals.reduce<Record<string, number>>((sum, deal) => {
          if (deal.currency && deal.weighted !== null) sum[deal.currency] = (sum[deal.currency] ?? 0) + deal.weighted;
          return sum;
        }, {});
        const id = column.stage.id || 'none';
        return <section key={id} role="listitem" aria-label={column.stage.id ? t(column.stage.label) : t('No stage')}
          className={`flex max-h-[calc(100dvh-16rem)] min-h-48 shrink-0 flex-col rounded-lg transition-colors ${column.closed ? 'w-52' : 'min-w-56 flex-1 basis-56'} ${over === id ? 'bg-[var(--accent-subtle)]' : 'bg-muted/30'}`}
          onDragOver={event => { if (column.stage.id && event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); setOver(id); } }}
          onDragLeave={() => setOver(current => current === id ? null : current)}
          onDrop={event => { event.preventDefault(); setOver(null); const dealId = event.dataTransfer.getData(DRAG_TYPE); if (dealId) void drop(dealId, column.stage); }}>
          <header className="space-y-0.5 px-3 pb-2 pt-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{column.stage.id ? t(column.stage.label) : t('No stage')}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{column.deals.length}</span>
              {!column.closed && column.stage.id && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{column.stage.probability}%</span>}
            </div>
            <p className="truncate text-xs tabular-nums text-muted-foreground">{moneyList(column.totals, locale)}</p>
            {weighted && Object.keys(weighted).length > 0 && <p className="truncate text-[11px] tabular-nums text-muted-foreground/70">{t('Weighted')} {moneyList(weighted, locale)}</p>}
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
            {column.deals.map(deal => <DealCard key={deal.id} deal={deal} today={workspace.today} onOpen={onOpen} selected={deal.id === selectedId} />)}
            {!column.deals.length && <p className="px-1 py-6 text-center text-xs text-muted-foreground">{t('Drop a deal here')}</p>}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
