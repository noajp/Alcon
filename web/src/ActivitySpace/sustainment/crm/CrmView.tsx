'use client';

import { useMemo, useState } from 'react';
import { PenLine, Plus, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DateField } from '@/Function/shared/date';
import { useEscapeLayer } from '@/Function/shared/keyboard/useEscapeLayer';
import { CrmIcon } from '@/Function/shared/conceptIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { NavigationState } from '@/types/navigation';
import { inList, searchDeals, type CrmList } from './crmModel';
import { crmRoute, routeTo, type CrmRoute, type CrmViewId } from './crmRoute';
import { useCrm, type Crm } from './useCrm';
import { CrmToday } from './CrmToday';
import { CrmPipeline } from './CrmPipeline';
import { CrmDeals } from './CrmDeals';
import { CrmAccounts } from './CrmAccounts';
import { CrmForecast } from './CrmForecast';
import { CrmSettings } from './CrmSettings';
import { CrmDealPanel } from './CrmDealPanel';
import { CrmCapture } from './CaptureDialog';

const TITLES: Record<CrmViewId, string> = {
  today: 'Today', pipeline: 'Pipeline', deals: 'Deals', accounts: 'Accounts', forecast: 'Forecast', settings: 'Pipeline settings',
};
const LIST_LABEL: Record<CrmList, string> = {
  'at-risk': 'At risk', 'closing-soon': 'Closing soon', 'no-next-step': 'No next step', stale: 'Going quiet', won: 'Won', lost: 'Lost', incomplete: 'Missing details',
};
const INPUT = 'h-8 w-full min-w-0 rounded-sm bg-muted/30 px-2 text-sm outline-none hover:bg-muted/40 focus:bg-muted/60';

function NewDeal({ crm, onClose, onCreated }: { crm: Crm; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const workspace = crm.workspace!;
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(workspace.primaryCurrency ?? '');
  const [closeDate, setCloseDate] = useState<string | null>(null);
  const [stageId, setStageId] = useState(workspace.stages[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stage = workspace.stages.find(item => item.id === stageId) ?? workspace.stages[0];
  const amountValue = amount.trim() ? Number(amount.replace(/,/g, '')) : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    if (amountValue !== null && (!Number.isFinite(amountValue) || amountValue < 0)) { setError(t('Enter the amount as a number.')); return; }
    if (currency.trim() && !/^[A-Za-z]{3}$/.test(currency.trim())) { setError(t('Currency must be a three-letter code, such as USD or JPY.')); return; }
    setSaving(true); setError(null);
    try {
      onCreated(await crm.saveDeal(null, {
        name: name.trim(), account: account.trim() || null, amount: amountValue, currency: currency.trim().toUpperCase() || null,
        stage: stage?.id ?? null, probability: stage?.probability ?? null, closeDate, lastContact: null,
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Could not save. Try again.')); setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogTitle>{t('New deal')}</DialogTitle>
      <DialogDescription>{t('The essentials. Add the rest from the deal, or use Capture to fill it from notes.')}</DialogDescription>
      <form onSubmit={submit} className="space-y-3">
        <input autoFocus required aria-label={t('Deal name')} placeholder={t('Deal name')} className={`${INPUT} h-9 text-base font-medium`} value={name} onChange={event => setName(event.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <input aria-label={t('Account')} placeholder={t('Account')} className={INPUT} value={account} onChange={event => setAccount(event.target.value)} />
          <div className="flex gap-2">
            <input aria-label={t('Amount')} placeholder={t('Amount')} inputMode="decimal" className={INPUT} value={amount} onChange={event => setAmount(event.target.value)} />
            <input aria-label={t('Currency')} placeholder="JPY" className={`${INPUT} w-16`} maxLength={3} value={currency} onChange={event => setCurrency(event.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workspace.stages.map(item => <Button key={item.id} type="button" shape="tab" size="xs" variant={item.id === stage?.id ? 'secondary' : 'ghost'} aria-pressed={item.id === stage?.id} onClick={() => setStageId(item.id)}>{t(item.label)}</Button>)}
          <span className="ml-auto"><DateField aria-label={t('Close date')} value={closeDate} onChange={setCloseDate} placeholder={t('Close date')} /></span>
        </div>
        {error && <p role="alert" className="text-sm text-[var(--status-danger)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>{t('Cancel')}</Button>
          <Button type="submit" variant="primary" disabled={saving || !name.trim()}>{saving ? t('Saving…') : t('Create deal')}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

interface SurfaceProps {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

export function CrmView(props: SurfaceProps) {
  const crm = useCrm({ restore: true });
  return <CrmSurface crm={crm} {...props} />;
}

function CrmSurface({ crm, navigation, onNavigate, onViewChange }: SurfaceProps & { crm: Crm }) {
  const { t } = useI18n();
  const route = crmRoute(navigation.crm);
  const go = (patch: Partial<CrmRoute>) => onNavigate({ crm: routeTo(route, patch) });
  const [captureFor, setCaptureFor] = useState<string | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const workspace = crm.workspace;

  // Capture opens from the header (local state) or from the sidebar (a route
  // request, cleared when the dialog closes).
  const capture = captureFor !== undefined ? captureFor : route.capture && workspace ? route.dealId ?? null : undefined;
  const closeCapture = () => { setCaptureFor(undefined); if (route.capture) go({ capture: false }); };

  const filtered = useMemo(() => {
    if (!workspace) return [];
    let deals = searchDeals(workspace.deals, route.query ?? '');
    if (route.stage !== undefined && route.stage !== null) deals = deals.filter(deal => deal.outcome === 'open' && (deal.stage?.id ?? '') === route.stage);
    if (route.list) deals = deals.filter(deal => inList(deal, route.list!, workspace.today, workspace.params.horizonDays));
    if (route.account !== undefined && route.account !== null) deals = deals.filter(deal => (deal.account?.toLowerCase() ?? '') === route.account);
    return deals;
  }, [workspace, route.query, route.stage, route.list, route.account]);

  const selected = workspace && route.dealId ? workspace.deals.find(deal => deal.id === route.dealId) ?? null : null;
  useEscapeLayer(!!selected && capture === undefined && !creating, () => go({ dealId: null }));
  const openDeal = (dealId: string) => go({ dealId });
  const openTable = crm.data && onViewChange ? () => { onViewChange('tables'); onNavigate({ tableId: crm.data!.table.id }); } : undefined;

  const view: CrmViewId = workspace ? route.view : 'settings';
  const chips = [
    route.stage !== undefined && route.stage !== null && { key: 'stage', label: `${t('Stage')}: ${t(workspace?.stages.find(stage => stage.id === route.stage)?.label ?? (route.stage || 'No stage'))}` },
    route.list && { key: 'list', label: t(LIST_LABEL[route.list]) },
    route.account !== undefined && route.account !== null && { key: 'account', label: `${t('Account')}: ${workspace?.deals.find(deal => (deal.account?.toLowerCase() ?? '') === route.account)?.account ?? t('No account')}` },
    route.query && { key: 'query', label: `“${route.query}”` },
  ].filter(Boolean) as { key: 'stage' | 'list' | 'account' | 'query'; label: string }[];
  const showChips = chips.length > 0 && (view === 'deals' || view === 'pipeline');

  return <div className="flex min-w-0 flex-1 overflow-hidden bg-card">
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className={`mx-auto space-y-6 px-4 py-6 sm:px-8 sm:py-8 ${view === 'pipeline' ? 'max-w-none' : 'max-w-6xl'}`}>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><CrmIcon size={16} />{t('CRM')}{crm.data && <span>· {crm.data.table.name}</span>}</div>
            <h1 className="text-2xl font-semibold">{t(TITLES[view])}</h1>
          </div>
          {workspace && <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setCaptureFor(route.dealId ?? null)}><PenLine size={14} />{t('Capture')}</Button>
            <Button variant="secondary" onClick={() => setCreating(true)}><Plus size={14} />{t('New deal')}</Button>
          </div>}
        </header>

        {showChips && <div className="flex flex-wrap items-center gap-2">
          {chips.map(chip => <Button key={chip.key} size="xs" variant="secondary" aria-label={t('Clear filter {name}', { name: chip.label })}
            onClick={() => go(chip.key === 'query' ? { query: '' } : { [chip.key]: null })}>{chip.label}<X size={12} /></Button>)}
          <span className="text-xs text-muted-foreground">{t('{n} deals', { n: filtered.length })}</span>
        </div>}

        {crm.loading && !workspace && <p role="status" className="py-6 text-sm text-muted-foreground">{t('Loading your pipeline…')}</p>}
        {crm.error && <div role="alert" className="space-y-2"><p className="text-sm text-[var(--status-danger)]">{t('Could not load your pipeline.')} {crm.error instanceof Error ? crm.error.message : ''}</p>
          <Button onClick={() => { crm.tables.refetch(); void crm.source.refetch(); }}>{t('Retry')}</Button></div>}

        {workspace && view === 'today' && <CrmToday crm={crm} workspace={workspace} onOpen={openDeal} onCapture={() => setCaptureFor(null)} onList={list => go({ view: 'deals', list })} />}
        {workspace && view === 'pipeline' && <CrmPipeline crm={crm} workspace={workspace} deals={filtered} onOpen={openDeal} selectedId={route.dealId ?? null} />}
        {workspace && view === 'deals' && <CrmDeals deals={filtered} today={workspace.today} onOpen={openDeal} selectedId={route.dealId ?? null}
          emptyLabel={workspace.deals.length ? t('No deals match these filters.') : t('No deals yet. Use Capture or New deal to add one.')} />}
        {workspace && view === 'accounts' && <CrmAccounts deals={searchDeals(workspace.deals, route.query ?? '')} today={workspace.today} onOpenAccount={account => go({ view: 'deals', account, stage: null, list: null })} />}
        {workspace && view === 'forecast' && <CrmForecast workspace={workspace} />}
        {view === 'settings' && !crm.loading && <CrmSettings crm={crm} onOpenTable={openTable} onDone={() => go({ view: 'today' })} />}
      </div>
    </div>

    {selected && <div className="fixed inset-0 z-30 flex justify-end bg-black/20 md:static md:z-auto md:w-[420px] md:shrink-0 md:border-l md:border-[var(--border-subtle)] md:bg-transparent">
      <div className="h-full w-full max-w-md md:max-w-none">
        <CrmDealPanel key={selected.id} crm={crm} deal={selected} onClose={() => go({ dealId: null })} onOpenTable={openTable} onCapture={dealId => setCaptureFor(dealId)} />
      </div>
    </div>}

    {workspace && capture !== undefined && <CrmCapture crm={crm} initialDealId={capture} onClose={closeCapture}
      onApplied={dealId => { setCaptureFor(undefined); go({ dealId, capture: false }); }} />}
    {workspace && creating && <NewDeal crm={crm} onClose={() => setCreating(false)} onCreated={dealId => { setCreating(false); go({ dealId }); }} />}
  </div>;
}
