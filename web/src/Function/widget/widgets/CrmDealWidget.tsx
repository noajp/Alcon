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
import type { CrmDeal, CrmWorkspace } from '@/ActivitySpace/sustainment/crm/crmModel';
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

/** The next step, written in place; saved when the field is left. */
function NextStep({ deal, onSave, disabled }: { deal: CrmDeal; onSave: (text: string | null) => void; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  // A next step that is an Element is that Element's words; it is changed on the Element.
  if (deal.nextElement) return <span className="truncate">{deal.nextStep}</span>;
  return (
    <Input
      value={draft ?? deal.nextStep ?? ''}
      placeholder="What happens next"
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() !== (deal.nextStep ?? '')) onSave(draft.trim() || null);
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
  const found = findDeal(crm.workspaces, dealId);
  const options = crm.workspaces.flatMap((ws) => ws.deals.map((deal) => ({ deal, pipeline: ws.pipeline.name })));
  useWidgetMeta(found?.deal.name ?? 'Deal');
  const editable = !host.readOnly;
  const save = async (patch: Parameters<typeof crm.saveDeal>[1]) => {
    if (!found) return;
    try { setError(null); await crm.saveDeal(found.deal.id, patch); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the deal.'); }
  };

  const picker = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" align="start" disabled={!editable || crm.loading} aria-label="Deal" className="max-w-full">
          <span className="truncate">Deal: {found?.deal.name ?? 'Choose…'}</span>
          <ChevronDown size={12} />
        </Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" width="standard" align="start">
        {!options.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No deals yet. Add one in CRM.</p>}
        {options.map(({ deal, pipeline }) => (
          <DropdownMenuItem key={deal.id} className={MENU_ROW} onSelect={() => setParams({ dealId: deal.id })}>
            <span className="flex-1 truncate">{deal.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{deal.account ?? pipeline}</span>
          </DropdownMenuItem>
        ))}
      </MenuShell>
    </DropdownMenu>
  );

  if (crm.loading) return <p className="text-xs text-muted-foreground">Loading deal…</p>;
  if (!found) {
    return (
      <div className="space-y-2">
        {picker}
        {dealId && <p className="text-xs text-muted-foreground">This deal is not available. It may have been deleted, or it belongs to another Space.</p>}
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
                {deal.outcome === 'won' ? 'Won' : deal.outcome === 'lost' ? 'Lost' : deal.stage?.label ?? '—'}<ChevronDown size={12} />
              </Button>
            </DropdownMenuTrigger>
            <MenuShell as="dropdown" width="standard" align="start">
              {[...ws.stages, { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' }].map((stage) => (
                <DropdownMenuItem key={stage.id} className={MENU_ROW} onSelect={() => void save({ stage: stage.id })}>
                  <span className="flex-1">{stage.label}</span>{(deal.stageId === stage.id || deal.outcome === stage.id) && <span>✓</span>}
                </DropdownMenuItem>
              ))}
            </MenuShell>
          </DropdownMenu>
        </Row>
        <Row label={t('Close date')}>{deal.closeDate ? relativeDay(deal.closeDate, ws.today, locale, t) : '—'}</Row>
        <Row label={t('Health')}><HealthBadge level={deal.health.level} score={deal.health.score} t={t} /></Row>
        <Row label={t('Owner')}>{deal.ownerName ?? '—'}</Row>
        <Row label={t('Next step')}><NextStep deal={deal} disabled={!editable} onSave={(text) => void save({ nextStep: text })} /></Row>
      </div>
      {error && <p role="alert" className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
