'use client';

import { useMemo, useState } from 'react';
import { BarChart3, Building2, Calendar, Check, ClipboardList, Coins, Columns3, Layers, List, PenLine, Plus, Settings2, Tag, Users, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { PageHead } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { RailRow } from '@/Function/shared/RailRow';
import { ToolPage, type ToolView } from '@/Function/shared/tool/ToolPage';
import { DateField } from '@/Function/shared/date';
import { useEscapeLayer } from '@/Function/shared/keyboard/useEscapeLayer';
import { CrmIcon } from '@/Function/shared/conceptIcons';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { NavigationState } from '@/types/navigation';
import { useCrm, type Crm } from '@/hooks/useCrm';
import { money } from './crmFormat';
import { inList, searchDeals, todayQueue, type CrmDealRecord, type CrmList, type CrmWorkspace } from './crmModel';
import { crmRoute, routeTo, type CrmRoute, type CrmViewId } from './crmRoute';
import { CrmToday } from './CrmToday';
import { CrmPipeline } from './CrmPipeline';
import { CrmDeals } from './CrmDeals';
import { CrmCompanies, CrmCompanyPanel, CrmContactPanel, CrmContacts } from './CrmDirectory';
import { CrmForecast } from './CrmForecast';
import { CrmSettings } from './CrmSettings';
import { CrmDealPanel } from './CrmDealPanel';
import { CrmCapture } from './CaptureDialog';
import { CrmPicker } from './CrmPicker';

// The CRM's views — the tabs. Today is the Overview: the pipeline's head and
// Properties, then what needs you today.
const CRM_VIEWS: readonly (ToolView & { id: CrmViewId })[] = [
  { id: 'today', label: 'Overview', icon: ClipboardList },
  { id: 'pipeline', label: 'Pipeline', icon: Columns3, wide: true, description: 'Every open deal, by stage.' },
  { id: 'deals', label: 'Deals', icon: List, description: 'Every deal in this pipeline.' },
  { id: 'companies', label: 'Companies', icon: Building2, description: 'The companies your deals are with.' },
  { id: 'contacts', label: 'Contacts', icon: Users, description: 'The people at those companies.' },
  { id: 'forecast', label: 'Forecast', icon: BarChart3, description: 'What the open pipeline is expected to bring in.' },
  { id: 'settings', label: 'Settings', icon: Settings2, description: 'The pipeline’s stages, currency and rhythm.' },
];
const LIST_LABEL: Record<CrmList, string> = {
  mine: 'My deals', 'at-risk': 'At risk', 'closing-soon': 'Closing soon', 'no-next-step': 'No next step', stale: 'Going quiet', won: 'Won', lost: 'Lost', incomplete: 'Missing details',
};
const INPUT = 'h-8 w-full min-w-0 rounded-sm bg-muted/30 px-2 text-sm outline-none hover:bg-muted/40 focus:bg-muted/60';

function NewDeal({ crm, onClose, onCreated }: { crm: Crm; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const workspace = crm.workspace!;
  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [closeDate, setCloseDate] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(crm.me);
  const [stageId, setStageId] = useState(workspace.stages[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stage = workspace.stages.find(item => item.id === stageId) ?? workspace.stages[0];
  const amountValue = amount.trim() ? Number(amount.replace(/,/g, '')) : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    if (amountValue !== null && (!Number.isFinite(amountValue) || amountValue < 0)) { setError(t('Enter the amount as a number.')); return; }
    setSaving(true); setError(null);
    try {
      onCreated(await crm.saveDeal(null, { name: name.trim(), companyId, companyName, amount: amountValue, stage: stage?.id, probability: stage?.probability ?? null, closeDate, ownerId }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Could not save. Try again.')); setSaving(false); }
  }
  const label = crm.pipeline?.record_label;
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogTitle>{label ? t('New {name}', { name: label }) : t('New deal')}</DialogTitle>
      <DialogDescription>{t('The essentials. Add the rest from the deal, or use Capture to fill it from notes.')}</DialogDescription>
      <form onSubmit={submit} className="space-y-3">
        <input autoFocus required aria-label={t('Deal name')} placeholder={t('Deal name')} className={`${INPUT} h-9 text-base font-medium`} value={name} onChange={event => setName(event.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <CrmPicker block label={t('Company')} value={companyId} placeholder={companyName ?? t('Company')} options={crm.companies.map(company => ({ id: company.id, label: company.name }))}
            onChange={id => { setCompanyId(id); setCompanyName(null); }} onCreate={text => { setCompanyName(text); setCompanyId(null); }} />
          <div className="flex items-center gap-2">
            <input aria-label={t('Amount')} placeholder={t('Amount')} inputMode="decimal" className={INPUT} value={amount} onChange={event => setAmount(event.target.value)} />
            <span className="text-xs text-muted-foreground">{crm.pipeline?.currency}</span>
          </div>
          <CrmPicker block label={t('Owner')} value={ownerId} placeholder={t('Unassigned')} options={crm.people.map(person => ({ id: person.id, label: person.name }))} onChange={setOwnerId} />
          <DateField aria-label={t('Close date')} value={closeDate} onChange={setCloseDate} placeholder={t('Close date')} block />
        </div>
        <div className="flex flex-wrap gap-1">
          {workspace.stages.map(item => <Button key={item.id} type="button" shape="tab" size="xs" variant={item.id === stage?.id ? 'secondary' : 'ghost'} aria-pressed={item.id === stage?.id} onClick={() => setStageId(item.id)}>{t(item.label)}</Button>)}
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
  /** Opens an Element over the CRM (the next step lives in Execution). */
  onOpenElement?: (id: string) => void;
}

export function CrmView(props: SurfaceProps) {
  // One mount per Space: its pipelines and records belong to it.
  const spaceId = useActiveSpaceId();
  return <CrmMount key={spaceId ?? 'none'} {...props} />;
}

function CrmMount(props: SurfaceProps) {
  const crm = useCrm(crmRoute(props.navigation.crm).pipelineId, { seed: true });
  return <CrmSurface crm={crm} {...props} />;
}

function CrmSurface({ crm, navigation, onNavigate, onViewChange, onOpenElement }: SurfaceProps & { crm: Crm }) {
  const { t, locale } = useI18n();
  const route = crmRoute(navigation.crm);
  const go = (patch: Partial<CrmRoute>) => onNavigate({ crm: routeTo(route, patch) });
  const [captureFor, setCaptureFor] = useState<string | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const workspace = crm.workspace;

  // Capture opens from the header (local state) or from the sidebar (a route
  // request, cleared when the dialog closes).
  const capture = captureFor !== undefined ? captureFor : route.capture && workspace ? route.dealId ?? null : undefined;
  const closeCapture = () => { setCaptureFor(undefined); if (route.capture) go({ capture: false }); };

  const filtered = useMemo(() => {
    if (!workspace) return [];
    let deals = searchDeals(workspace.deals, route.query ?? '');
    if (route.stage !== undefined && route.stage !== null) deals = deals.filter(deal => deal.outcome === 'open' && deal.stage?.id === route.stage);
    if (route.list) deals = deals.filter(deal => inList(deal, route.list!, workspace.today, workspace.params.horizonDays, crm.me));
    if (route.account !== undefined && route.account !== null) deals = deals.filter(deal => (deal.companyId ?? '') === route.account);
    return deals;
  }, [workspace, route.query, route.stage, route.list, route.account, crm.me]);
  // Today is personal by default: my deals and the ones nobody owns yet.
  const todayWorkspace = useMemo<CrmWorkspace | null>(() => workspace && !everyone && crm.me
    ? { ...workspace, deals: workspace.deals.filter(deal => !deal.ownerId || deal.ownerId === crm.me) } : workspace, [workspace, everyone, crm.me]);

  const selected = workspace && route.dealId ? workspace.deals.find(deal => deal.id === route.dealId) ?? null : null;
  const panelOpen = !!selected || !!route.companyId || !!route.contactId;
  // Escape closes the panel, except while typing in one of its fields — a draft is not thrown away.
  useEscapeLayer(panelOpen && capture === undefined && !creating, () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))) return;
    go({ dealId: null, companyId: null, contactId: null });
  });
  const openDeal = (dealId: string) => go({ dealId, companyId: null, contactId: null });
  const openDealRecord = (deal: CrmDealRecord) => go({ dealId: deal.id, companyId: null, contactId: null, pipelineId: deal.pipeline_id === crm.pipeline?.id ? route.pipelineId : deal.pipeline_id });
  const openInitiative = onViewChange ? (id: string) => { onNavigate({ strategyId: id }); onViewChange('strategy'); } : undefined;

  const view: CrmViewId = route.view;
  const recordLabel = crm.pipeline?.record_label;
  const pipeline = crm.pipeline;
  // Each tab carries the count that says whether it is worth opening — what
  // the sidebar used to show beside each view.
  const views = useMemo(() => {
    const deals = workspace?.deals ?? [];
    const queue = workspace ? todayQueue(deals.filter(deal => !crm.me || !deal.ownerId || deal.ownerId === crm.me)) : [];
    const overdue = queue.filter(deal => deal.action!.urgency === 'overdue').length;
    const badges: Partial<Record<CrmViewId, React.ReactNode>> = workspace ? {
      today: queue.length ? <span className={overdue ? 'text-[var(--status-danger)]' : undefined}>{queue.length}</span> : null,
      pipeline: deals.filter(deal => deal.outcome === 'open').length || null,
      deals: deals.length || null,
      companies: crm.companies.length || null,
      contacts: crm.contacts.length || null,
      forecast: (() => {
        const weighted = workspace.totals.find(total => total.currency === workspace.primaryCurrency)?.weightedPipeline ?? null;
        return weighted && workspace.primaryCurrency ? money(weighted, workspace.primaryCurrency, locale, true) : null;
      })(),
    } : {};
    return CRM_VIEWS.map(item => ({ ...item, label: item.id === 'deals' && recordLabel ? recordLabel : item.label, badge: badges[item.id] }));
  }, [recordLabel, workspace, crm.me, crm.companies.length, crm.contacts.length, locale]);
  const chips = [
    route.stage !== undefined && route.stage !== null && { key: 'stage', label: `${t('Stage')}: ${t(workspace?.stages.find(stage => stage.id === route.stage)?.label ?? route.stage)}` },
    route.list && { key: 'list', label: t(LIST_LABEL[route.list]) },
    route.account !== undefined && route.account !== null && { key: 'account', label: `${t('Company')}: ${crm.companies.find(company => company.id === route.account)?.name ?? t('No company')}` },
    route.query && { key: 'query', label: `“${route.query}”` },
  ].filter(Boolean) as { key: 'stage' | 'list' | 'account' | 'query'; label: string }[];
  const showChips = chips.length > 0 && (view === 'deals' || view === 'pipeline');
  const openPipeline = workspace?.deals.filter(deal => deal.outcome === 'open') ?? [];
  const weighted = workspace?.totals.find(total => total.currency === workspace.primaryCurrency)?.weightedPipeline ?? null;

  // The pipeline's facts — what every view reads through. Switching pipeline
  // and its Domain happen here; the rest opens Settings, where they are edited.
  const properties = pipeline && <RailCard title={t('Properties')}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="w-full" aria-label={t('Pipeline')}>
          <RailRow icon={<Layers className="size-3.5 text-muted-foreground" />} name={t('Pipeline')} label={pipeline.name} dense />
        </button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="start">
        {crm.pipelines.map(item => <DropdownMenuItem key={item.id} className="gap-2" onSelect={() => go({ pipelineId: item.id })}>
          <span className="min-w-0 flex-1 truncate">{item.name}</span>{item.id === pipeline.id && <Check size={12} />}
        </DropdownMenuItem>)}
        <DropdownMenuItem className="gap-2 text-muted-foreground" onSelect={() => go({ view: 'settings' })}><Settings2 size={12} />{t('Pipeline settings')}</DropdownMenuItem>
      </MenuShell>
    </DropdownMenu>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="w-full" aria-label={t('Domain')}>
          <RailRow icon={<Layers className="size-3.5 text-muted-foreground" />} name={t('Domain')}
            label={crm.domains.find(domain => domain.id === pipeline.domain_id)?.name ?? t('Whole Space')} placeholder={!pipeline.domain_id} dense />
        </button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="start">
        <DropdownMenuItem className="gap-2" onSelect={() => void crm.savePipeline(pipeline.id, { domain_id: null })}>
          <span className="min-w-0 flex-1 truncate">{t('Whole Space')}</span>{!pipeline.domain_id && <Check size={12} />}
        </DropdownMenuItem>
        {crm.domains.map(domain => <DropdownMenuItem key={domain.id} className="gap-2" onSelect={() => void crm.savePipeline(pipeline.id, { domain_id: domain.id })}>
          <span className="min-w-0 flex-1 truncate">{domain.name}</span>{domain.id === pipeline.domain_id && <Check size={12} />}
        </DropdownMenuItem>)}
      </MenuShell>
    </DropdownMenu>
    {[
      { key: 'label', icon: Tag, name: t('A deal is called'), value: pipeline.record_label ?? t('Deal'), placeholder: !pipeline.record_label },
      { key: 'currency', icon: Coins, name: t('Currency'), value: pipeline.currency },
      { key: 'horizon', icon: Calendar, name: t('Forecast period'), value: t('{n} days', { n: pipeline.horizon_days }) },
      { key: 'follow', icon: Calendar, name: t('Going quiet after'), value: t('{n} days', { n: pipeline.follow_up_days }) },
      { key: 'stages', icon: Columns3, name: t('Stages'), value: String(workspace?.stages.length ?? 0) },
    ].map(row => <button key={row.key} type="button" className="w-full" onClick={() => go({ view: 'settings' })}>
      <RailRow icon={<row.icon className="size-3.5 text-muted-foreground" />} name={row.name} label={row.value} placeholder={row.placeholder} dense />
    </button>)}
    {workspace && <>
      <div className="mx-2 my-2 h-px bg-[var(--border-subtle)]" />
      <RailRow name={t('Open deals')} label={String(openPipeline.length)} dense />
      {weighted !== null && workspace.primaryCurrency && <RailRow name={t('Weighted')} label={money(weighted, workspace.primaryCurrency, locale, true)} dense />}
    </>}
  </RailCard>;

  return <>
    <ToolPage icon={CrmIcon} tool={t('CRM')} crumb={pipeline?.name} storageKey="crm" home="today"
      views={views} activeView={view} onSelectView={id => go({ view: id as CrmViewId })}
      actions={workspace && <>
        <Button variant="ghost" size="sm" onClick={() => setCaptureFor(route.dealId ?? null)}><PenLine size={14} />{t('Capture')}</Button>
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}><Plus size={14} />{recordLabel ? t('New {name}', { name: recordLabel }) : t('New deal')}</Button>
      </>}
      viewControls={workspace && view === 'today' && crm.me && <div role="group" aria-label={t('Whose deals')} className="flex gap-1">
        <Button shape="tab" size="sm" variant={!everyone ? 'secondary' : 'ghost'} aria-pressed={!everyone} onClick={() => setEveryone(false)}>{t('Mine')}</Button>
        <Button shape="tab" size="sm" variant={everyone ? 'secondary' : 'ghost'} aria-pressed={everyone} onClick={() => setEveryone(true)}>{t('Everyone')}</Button>
      </div>}
      head={<PageHead key={pipeline?.id ?? 'none'} icon={<CrmIcon size={18} />} title={pipeline?.name ?? t('CRM')}
        description={t('What needs you today, and where every deal in this pipeline stands.')}
        canEdit={!!pipeline} titleLabel={t('Pipeline name')} titlePlaceholder={t('Pipeline name…')}
        descriptionLabel={t('Description')} descriptionPlaceholder=""
        onSaveTitle={async name => { if (pipeline) await crm.savePipeline(pipeline.id, { name }); }} />}
      properties={properties}
      panel={panelOpen && <div className="fixed inset-0 z-30 flex justify-end bg-black/20 md:static md:z-auto md:w-[420px] md:shrink-0 md:border-l md:border-[var(--border-subtle)] md:bg-transparent">
        <div className="h-full w-full max-w-md overflow-y-auto md:max-w-none">
          {selected ? <CrmDealPanel key={selected.id} crm={crm} deal={selected} onClose={() => go({ dealId: null })} onCapture={dealId => setCaptureFor(dealId)}
            onOpenElement={onOpenElement} onOpenInitiative={openInitiative} onOpenCompany={companyId => go({ companyId, dealId: null })} />
            : route.companyId ? <CrmCompanyPanel key={route.companyId} crm={crm} companyId={route.companyId} onClose={() => go({ companyId: null })}
              onOpenDeal={openDealRecord} onOpenContact={contactId => go({ contactId, companyId: null })} />
            : route.contactId ? <CrmContactPanel key={route.contactId} crm={crm} contactId={route.contactId} onClose={() => go({ contactId: null })}
              onOpenDeal={openDealRecord} onOpenCompany={companyId => go({ companyId, contactId: null })} /> : null}
        </div>
      </div>}>
      <div className="@container/crm space-y-6">
        {showChips && <div className="flex flex-wrap items-center gap-2">
          {chips.map(chip => <Button key={chip.key} size="xs" variant="secondary" aria-label={t('Clear filter {name}', { name: chip.label })}
            onClick={() => go(chip.key === 'query' ? { query: '' } : { [chip.key]: null })}>{chip.label}<X size={12} /></Button>)}
          <span className="text-xs text-muted-foreground">{t('{n} deals', { n: filtered.length })}</span>
        </div>}

        {crm.loading && <p role="status" className="py-6 text-sm text-muted-foreground">{t('Loading your pipeline…')}</p>}
        {crm.error && <div role="alert" className="space-y-2"><p className="text-sm text-[var(--status-danger)]">{t('Could not load your pipeline.')} {crm.error instanceof Error ? crm.error.message : ''}</p>
          <Button onClick={() => void crm.refetch()}>{t('Retry')}</Button></div>}

        {todayWorkspace && view === 'today' && <CrmToday crm={crm} workspace={todayWorkspace} pipelineDeals={workspace?.deals.length ?? 0} onShowEveryone={() => setEveryone(true)} onOpen={openDeal} onCapture={() => setCaptureFor(null)} onList={list => go({ view: 'deals', list })} />}
        {workspace && view === 'pipeline' && <CrmPipeline crm={crm} workspace={workspace} deals={filtered} onOpen={openDeal} selectedId={route.dealId ?? null} />}
        {workspace && view === 'deals' && <CrmDeals deals={filtered} today={workspace.today} onOpen={openDeal} selectedId={route.dealId ?? null}
          emptyLabel={workspace.deals.length ? t('No deals match these filters.') : t('No deals yet. Use Capture or New deal to add one.')} />}
        {workspace && view === 'companies' && <CrmCompanies crm={crm} query={route.query ?? ''} selectedId={route.companyId ?? null} onOpen={companyId => go({ companyId, dealId: null, contactId: null })} />}
        {workspace && view === 'contacts' && <CrmContacts crm={crm} query={route.query ?? ''} selectedId={route.contactId ?? null} onOpen={contactId => go({ contactId, dealId: null, companyId: null })} />}
        {workspace && view === 'forecast' && <CrmForecast workspace={workspace} onOpenInitiative={openInitiative} />}
        {view === 'settings' && <CrmSettings crm={crm} onSelectPipeline={pipelineId => go({ pipelineId })} />}
      </div>
    </ToolPage>

    {workspace && capture !== undefined && <CrmCapture crm={crm} initialDealId={capture} onClose={closeCapture}
      onApplied={dealId => { setCaptureFor(undefined); go({ dealId, capture: false }); }} />}
    {workspace && creating && <NewDeal crm={crm} onClose={() => setCreating(false)} onCreated={dealId => { setCreating(false); go({ dealId }); }} />}
  </>;
}
