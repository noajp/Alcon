'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useCrm } from '@/hooks/useCrm';
import { HealthBadge, money, relativeDay } from '@/ActivitySpace/sustainment/crm/crmFormat';
import { LOST_STAGE, WON_STAGE, shiftDate, stageChange, type CrmDeal, type CrmWorkspace } from '@/ActivitySpace/sustainment/crm/crmModel';
import { useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';

function findDeal(workspaces: readonly CrmWorkspace[], dealId: string | null): { deal: CrmDeal; ws: CrmWorkspace } | null {
  for (const ws of workspaces) {
    const deal = ws.deals.find((d) => d.id === dealId);
    if (deal) return { deal, ws };
  }
  return null;
}

/** One line of the card: what it is, and its value. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-3 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * The next step, written in place and saved as the CRM saves it: as the deal
 * owner's Element when someone can act on it, due when the deal says (or
 * tomorrow). A step whose Element is finished is gone, and a new one can be written.
 */
function NextStep({ deal, onSave, disabled, placeholder }: { deal: CrmDeal; onSave: (title: string) => void; disabled: boolean; placeholder: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const open = !!deal.nextElement && !['done', 'cancelled'].includes(deal.nextElement.status);
  const current = open ? deal.nextElement!.title : deal.nextStep ?? '';
  return (
    <Input
      value={draft ?? current}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() && draft.trim() !== current) onSave(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
      }}
      className="h-7 text-xs"
    />
  );
}

/**
 * A CRM deal on any board: its stage, amount, close date, health and next
 * step, with the stage and next step changed in place. The deal stays the
 * CRM's; the widget only remembers which one it shows.
 */
export function CrmDealWidget({ params, setParams, host }: WidgetProps) {
  const { t, locale } = useI18n();
  const crm = useCrm();
  const dealId = typeof params.dealId === 'string' ? params.dealId : null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const found = findDeal(crm.workspaces, dealId);
  const options = crm.workspaces.flatMap((ws) => ws.deals.map((deal) => ({ deal, pipeline: ws.pipeline.name })));
  useWidgetMeta(found?.deal.name ?? 'Deal');
  const editable = !host.readOnly;
  const run = async (write: () => Promise<unknown>) => {
    try { setError(null); setNotice(null); const said = await write(); if (typeof said === 'string') setNotice(said); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Try again.')); }
  };

  const picker = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" align="start" disabled={!editable || crm.loading} aria-label="Deal" className="max-w-full">
          <span className="truncate">{t('Deal')}: {found?.deal.name ?? t('Choose…')}</span>
          <ChevronDown size={12} />
        </Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" width="standard" align="start">
        {!options.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('No deals yet. Add one in CRM.')}</p>}
        {options.map(({ deal, pipeline }) => (
          <DropdownMenuItem key={deal.id} className={MENU_ROW} onSelect={() => setParams({ dealId: deal.id })}>
            <span className="flex-1 truncate">{deal.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{deal.account ?? pipeline}</span>
          </DropdownMenuItem>
        ))}
      </MenuShell>
    </DropdownMenu>
  );

  if (crm.error) return <p role="alert" className="text-xs text-destructive">{crm.error.message || t('Could not load the CRM.')}</p>;
  // A Space with no pipeline yet has no deals; the CRM app makes its first one.
  const empty = crm.pipelinesLoaded && crm.pipelines.length === 0;
  if (crm.loading && !empty) return <p className="text-xs text-muted-foreground">{t('Loading…')}</p>;
  if (!found) {
    return (
      <div className="space-y-2">
        {picker}
        {dealId && <p className="text-xs text-muted-foreground">{t('This deal is not available. It may have been deleted, or it belongs to another Space.')}</p>}
      </div>
    );
  }
  const { deal, ws } = found;
  return (
    <div className="space-y-1.5">
      {picker}
      <div className="flex items-baseline justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{deal.name}</p>
          <p className="truncate text-xs text-muted-foreground">{[deal.account, deal.contact].filter(Boolean).join(' · ') || ws.pipeline.name}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{money(deal.amount, deal.currency, locale)}</span>
      </div>
      <div className="px-1">
        <Row label={t('Stage')}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" align="start" disabled={!editable}>
                {deal.outcome === 'won' ? t(WON_STAGE.label) : deal.outcome === 'lost' ? t(LOST_STAGE.label) : deal.stage ? t(deal.stage.label) : '—'}<ChevronDown size={12} />
              </Button>
            </DropdownMenuTrigger>
            <MenuShell as="dropdown" width="standard" align="start">
              {[...ws.stages, WON_STAGE, LOST_STAGE].map((stage) => (
                <DropdownMenuItem key={stage.id} className={MENU_ROW} onSelect={() => void run(() => crm.saveDeal(deal.id, stageChange(deal, stage)))}>
                  <span className="flex-1">{t(stage.label)}</span>{(deal.stageId === stage.id || deal.outcome === stage.id) && <span>✓</span>}
                </DropdownMenuItem>
              ))}
            </MenuShell>
          </DropdownMenu>
        </Row>
        <Row label={t('Close date')}>{deal.closeDate ? relativeDay(deal.closeDate, ws.today, locale, t) : '—'}</Row>
        <Row label={t('Health')}><HealthBadge level={deal.health.level} score={deal.health.score} t={t} /></Row>
        <Row label={t('Owner')}>{deal.ownerName ?? '—'}</Row>
        <Row label={t('Next step')}>
          <NextStep deal={deal} disabled={!editable} placeholder={t('What happens next')}
            onSave={(title) => void run(() => crm.setNextStep(deal, { title, due: deal.nextActionDate ?? shiftDate(ws.today, 1) }))} />
        </Row>
      </div>
      {notice && <p className="px-1 text-xs text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
