'use client';

import { useMemo, useState } from 'react';
import { BarChart3, Check, ChevronDown, ClipboardList, Columns3, Filter, Layers, List, MoreHorizontal, PenLine, Plus, Settings2, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { DateField } from '@/Function/shared/date';
import { PageHead } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { RailRow } from '@/Function/shared/RailRow';
import { ToolPage, type ToolView } from '@/Function/shared/tool/ToolPage';
import { PlacePage as SharedPlacePage } from '@/Function/shared/tool/PlacePage';
import { CrmIcon } from '@/Function/shared/conceptIcons';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { NavigationState } from '@/types/navigation';
import { useCrm, type Crm } from '@/hooks/useCrm';
import { inList, searchDeals, todayQueue, type CrmDealRecord, type CrmList, type CrmWorkspace } from './crmModel';
import { crmRoute, routeTo, PIPELINE_VIEWS, type CrmRoute, type CrmViewId } from './crmRoute';
import { money } from './crmFormat';
import { CrmToday } from './CrmToday';
import { CrmPipeline } from './CrmPipeline';
import { CrmDeals } from './CrmDeals';
import { CrmCompanies, CrmCompanyPage, CrmContactPage, CrmContacts } from './CrmDirectory';
import { CrmForecast } from './CrmForecast';
import { CrmSettings } from './CrmSettings';
import { CrmDealPage } from './CrmDealPage';
import { CrmCapture } from './CaptureDialog';
import { CrmPicker } from './CrmPicker';

// The CRM App, in the App's three levels (see crmRoute):
//   a pipeline is a container, read through its views (the tabs);
//   Today, Companies and Contacts are the other places in the sidebar;
//   a deal, a company or a contact opens as a page of its own.

const LIST_LABEL: Record<CrmList, string> = {
  mine: 'My deals', 'at-risk': 'At risk', 'closing-soon': 'Closing soon', 'no-next-step': 'No next step', stale: 'Going quiet', won: 'Won', lost: 'Lost', incomplete: 'Missing details',
};
const LISTS = Object.keys(LIST_LABEL) as CrmList[];

// The pipeline's views. Overview is its page — head and Properties — the
// rest are readings of its deals.
const PIPELINE_TABS: readonly (ToolView & { id: typeof PIPELINE_VIEWS[number] })[] = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'deals', label: 'Deals', icon: List, description: 'Every deal in this pipeline.' },
  { id: 'board', label: 'Board', icon: Columns3, wide: true, description: 'Every open deal, by stage. Drag a card to move it.' },
  { id: 'forecast', label: 'Forecast', icon: BarChart3, description: 'What the open pipeline is expected to bring in.' },
];

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

/** A place that is not a pipeline: Today, Companies, Contacts. */
function PlacePage(props: Omit<React.ComponentProps<typeof SharedPlacePage>, 'icon' | 'container'>) {
  return <SharedPlacePage icon={CrmIcon} container="crm" {...props} />;
}

function CrmSurface({ crm, navigation, onNavigate, onViewChange, onOpenElement }: SurfaceProps & { crm: Crm }) {
  const { t, locale } = useI18n();
  const route = crmRoute(navigation.crm);
  const go = (patch: Partial<CrmRoute>) => onNavigate({ crm: routeTo(route, patch) });
  const [captureFor, setCaptureFor] = useState<string | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const workspace = crm.workspace;
  const pipeline = crm.pipeline;

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
    if (route.owner) deals = deals.filter(deal => deal.ownerId === route.owner);
    return deals;
  }, [workspace, route.query, route.stage, route.list, route.account, route.owner, crm.me]);
  // Today is personal by default: my deals and the ones nobody owns yet.
  const todayWorkspace = useMemo<CrmWorkspace | null>(() => workspace && !everyone && crm.me
    ? { ...workspace, deals: workspace.deals.filter(deal => !deal.ownerId || deal.ownerId === crm.me) } : workspace, [workspace, everyone, crm.me]);

  const openDeal = (dealId: string) => go({ dealId, companyId: null, contactId: null });
  const openDealRecord = (deal: CrmDealRecord) => go({ dealId: deal.id, companyId: null, contactId: null, pipelineId: deal.pipeline_id === crm.pipeline?.id ? route.pipelineId : deal.pipeline_id });
  const openInitiative = onViewChange ? (id: string) => { onNavigate({ strategyId: id }); onViewChange('strategy'); } : undefined;
  const closeRecord = () => go({ dealId: null, companyId: null, contactId: null });
  const recordLabel = pipeline?.record_label;

  const headerActions = workspace && <>
    <Button variant="ghost" size="sm" onClick={() => setCaptureFor(route.dealId ?? null)}><PenLine size={14} />{t('Capture')}</Button>
    <Button variant="secondary" size="sm" onClick={() => setCreating(true)}><Plus size={14} />{recordLabel ? t('New {name}', { name: recordLabel }) : t('New deal')}</Button>
  </>;

  const dialogs = <>
    {workspace && capture !== undefined && <CrmCapture crm={crm} initialDealId={capture} onClose={closeCapture}
      onApplied={dealId => { setCaptureFor(undefined); go({ dealId, capture: false }); }} />}
    {workspace && creating && <NewDeal crm={crm} onClose={() => setCreating(false)} onCreated={dealId => { setCreating(false); go({ dealId }); }} />}
    {route.settings && pipeline && <Dialog open onOpenChange={open => { if (!open) go({ settings: false }); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogTitle>{t('Pipeline settings')}</DialogTitle>
        <DialogDescription>{t('The pipeline’s stages, currency and rhythm.')}</DialogDescription>
        <CrmSettings crm={crm} onSelectPipeline={pipelineId => go({ pipelineId })} />
      </DialogContent>
    </Dialog>}
  </>;

  // ── A record's page ─────────────────────────────────────────────────
  const selected = workspace && route.dealId ? workspace.deals.find(deal => deal.id === route.dealId) ?? null : null;
  if (selected) return <>
    <CrmDealPage key={selected.id} crm={crm} deal={selected} onBack={closeRecord} onOpenPipeline={() => go({ dealId: null, view: 'overview' })}
      onCapture={dealId => setCaptureFor(dealId)} onOpenElement={onOpenElement} onOpenInitiative={openInitiative}
      onOpenCompany={companyId => go({ companyId, dealId: null })} onOpenContact={contactId => go({ contactId, dealId: null })} />
    {dialogs}
  </>;
  if (route.companyId) return <>
    <CrmCompanyPage key={route.companyId} crm={crm} companyId={route.companyId} onBack={closeRecord} onOpenCompanies={() => go({ view: 'companies' })}
      onOpenDeal={openDealRecord} onOpenContact={contactId => go({ contactId, companyId: null })} />
    {dialogs}
  </>;
  if (route.contactId) return <>
    <CrmContactPage key={route.contactId} crm={crm} contactId={route.contactId} onBack={closeRecord} onOpenContacts={() => go({ view: 'contacts' })}
      onOpenDeal={openDealRecord} onOpenCompany={companyId => go({ companyId, contactId: null })} />
    {dialogs}
  </>;

  const status = <>
    {crm.loading && <p role="status" className="py-6 text-sm text-muted-foreground">{t('Loading your pipeline…')}</p>}
    {crm.error && <div role="alert" className="space-y-2"><p className="text-sm text-[var(--status-danger)]">{t('Could not load your pipeline.')} {crm.error instanceof Error ? crm.error.message : ''}</p>
      <Button onClick={() => void crm.refetch()}>{t('Retry')}</Button></div>}
  </>;

  // ── The places beside the pipelines ─────────────────────────────────
  if (route.view === 'today') return <>
    <PlacePage title={t('Today')} actions={<>
      {workspace && crm.me && <div role="group" aria-label={t('Whose deals')} className="mr-2 flex gap-1">
        <Button shape="tab" size="sm" variant={!everyone ? 'secondary' : 'ghost'} aria-pressed={!everyone} onClick={() => setEveryone(false)}>{t('Mine')}</Button>
        <Button shape="tab" size="sm" variant={everyone ? 'secondary' : 'ghost'} aria-pressed={everyone} onClick={() => setEveryone(true)}>{t('Everyone')}</Button>
      </div>}
      {headerActions}
    </>}>
      {status}
      {todayWorkspace && <CrmToday crm={crm} workspace={todayWorkspace} pipelineDeals={workspace?.deals.length ?? 0} onShowEveryone={() => setEveryone(true)}
        onOpen={openDeal} onCapture={() => setCaptureFor(null)} onList={list => go({ view: 'deals', list })} />}
    </PlacePage>
    {dialogs}
  </>;
  if (route.view === 'companies') return <>
    <PlacePage title={t('Companies')}>{status}{workspace && <CrmCompanies crm={crm} query={route.query ?? ''} selectedId={null} onOpen={companyId => go({ companyId })} />}</PlacePage>
    {dialogs}
  </>;
  if (route.view === 'contacts') return <>
    <PlacePage title={t('Contacts')}>{status}{workspace && <CrmContacts crm={crm} query={route.query ?? ''} selectedId={null} onOpen={contactId => go({ contactId })} />}</PlacePage>
    {dialogs}
  </>;

  // ── The pipeline ────────────────────────────────────────────────────
  const view = (PIPELINE_VIEWS as readonly string[]).includes(route.view) ? route.view : 'overview';
  const open = workspace?.deals.filter(deal => deal.outcome === 'open') ?? [];
  const weighted = workspace?.totals.find(total => total.currency === workspace.primaryCurrency)?.weightedPipeline ?? null;
  const views = PIPELINE_TABS.map(tab => ({
    ...tab,
    label: tab.id === 'deals' && recordLabel ? recordLabel : tab.label,
    badge: tab.id === 'deals' ? workspace?.deals.length || null : tab.id === 'board' ? open.length || null : null,
  }));
  const chips = [
    route.stage !== undefined && route.stage !== null && { key: 'stage', label: `${t('Stage')}: ${t(workspace?.stages.find(stage => stage.id === route.stage)?.label ?? route.stage)}` },
    route.list && { key: 'list', label: t(LIST_LABEL[route.list]) },
    route.account !== undefined && route.account !== null && { key: 'account', label: `${t('Company')}: ${crm.companies.find(company => company.id === route.account)?.name ?? t('No company')}` },
    route.owner && { key: 'owner', label: `${t('Owner')}: ${crm.people.find(person => person.id === route.owner)?.name ?? ''}` },
    route.query && { key: 'query', label: `“${route.query}”` },
  ].filter(Boolean) as { key: 'stage' | 'list' | 'account' | 'owner' | 'query'; label: string }[];
  const filtering = view === 'deals' || view === 'board';

  // What narrows the deals: a stage, a list, whose. A filter, where the
  // Elements list has its own — not a place in the sidebar.
  const filterMenu = workspace && filtering && <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="sm" variant={chips.length ? 'secondary' : 'ghost'}><Filter size={14} />{t('Filter')}{chips.length > 0 && <span className="tabular-nums text-muted-foreground">{chips.length}</span>}<ChevronDown size={12} /></Button></DropdownMenuTrigger>
    <MenuShell as="dropdown" width="wide" align="end">
      <p className="px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">{t('Stage')}</p>
      {workspace.stages.map(stage => <DropdownMenuItem key={stage.id} className={MENU_ROW} onSelect={() => go({ stage: route.stage === stage.id ? null : stage.id })}>
        <span className="min-w-0 flex-1 truncate">{t(stage.label)}</span><span className="flex w-4 justify-end">{route.stage === stage.id && <Check size={12} />}</span></DropdownMenuItem>)}
      <p className="px-2 pb-1 pt-2 text-[11px] text-muted-foreground">{t('Lists')}</p>
      {LISTS.filter(list => list !== 'mine' || crm.me).map(list => <DropdownMenuItem key={list} className={MENU_ROW} onSelect={() => go({ list: route.list === list ? null : list })}>
        <span className="min-w-0 flex-1 truncate">{t(LIST_LABEL[list])}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{workspace.deals.filter(deal => inList(deal, list, workspace.today, workspace.params.horizonDays, crm.me)).length}</span>
        <span className="flex w-4 justify-end">{route.list === list && <Check size={12} />}</span></DropdownMenuItem>)}
      {crm.people.length > 1 && <>
        <p className="px-2 pb-1 pt-2 text-[11px] text-muted-foreground">{t('Owner')}</p>
        {crm.people.map(person => <DropdownMenuItem key={person.id} className={MENU_ROW} onSelect={() => go({ owner: route.owner === person.id ? null : person.id })}>
          <span className="min-w-0 flex-1 truncate">{person.name}</span><span className="flex w-4 justify-end">{route.owner === person.id && <Check size={12} />}</span></DropdownMenuItem>)}
      </>}
    </MenuShell>
  </DropdownMenu>;

  // The pipeline's facts, on the Overview. Pipeline and Domain switch in
  // place; the rest open its settings.
  const properties = pipeline && <RailCard title={t('Properties')}>
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
      { key: 'label', name: t('A deal is called'), value: pipeline.record_label ?? t('Deal'), placeholder: !pipeline.record_label },
      { key: 'currency', name: t('Currency'), value: pipeline.currency },
      { key: 'horizon', name: t('Forecast period'), value: t('{n} days', { n: pipeline.horizon_days }) },
      { key: 'follow', name: t('Going quiet after'), value: t('{n} days', { n: pipeline.follow_up_days }) },
      { key: 'stages', name: t('Stages'), value: String(workspace?.stages.length ?? 0) },
    ].map(row => <button key={row.key} type="button" className="w-full" onClick={() => go({ settings: true })}>
      <RailRow icon={<Settings2 className="size-3.5 text-muted-foreground" />} name={row.name} label={row.value} placeholder={row.placeholder} dense />
    </button>)}
    {workspace && <>
      <div className="mx-2 my-2 h-px bg-[var(--border-subtle)]" />
      <RailRow name={t('Open deals')} label={String(open.length)} dense />
      {weighted !== null && workspace.primaryCurrency && <RailRow name={t('Weighted')} label={money(weighted, workspace.primaryCurrency, locale, true)} dense />}
    </>}
  </RailCard>;

  return <>
    <ToolPage icon={CrmIcon} tool={t('CRM')} crumb={pipeline?.name} storageKey="crm-pipeline" home="overview"
      views={views} activeView={view} onSelectView={id => go({ view: id as CrmViewId })}
      actions={<>
        {headerActions}
        {pipeline && <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('More')}><MoreHorizontal size={14} /></Button></DropdownMenuTrigger>
          <MenuShell as="dropdown" align="end">
            <DropdownMenuItem className="gap-2" onSelect={() => go({ settings: true })}><Settings2 size={12} />{t('Pipeline settings')}</DropdownMenuItem>
          </MenuShell>
        </DropdownMenu>}
      </>}
      viewControls={filterMenu}
      head={<PageHead key={pipeline?.id ?? 'none'} icon={<CrmIcon size={18} />} title={pipeline?.name ?? t('CRM')}
        description={t('What needs you today, and where every deal in this pipeline stands.')}
        canEdit={!!pipeline} titleLabel={t('Pipeline name')} titlePlaceholder={t('Pipeline name…')}
        descriptionLabel={t('Description')} descriptionPlaceholder=""
        onSaveTitle={async name => { if (pipeline) await crm.savePipeline(pipeline.id, { name }); }} />}
      properties={properties}>
      <div className="@container/crm space-y-6">
        {filtering && chips.length > 0 && <div className="flex flex-wrap items-center gap-2">
          {chips.map(chip => <Button key={chip.key} size="xs" variant="secondary" aria-label={t('Clear filter {name}', { name: chip.label })}
            onClick={() => go(chip.key === 'query' ? { query: '' } : { [chip.key]: null })}>{chip.label}<X size={12} /></Button>)}
          <span className="text-xs text-muted-foreground">{t('{n} deals', { n: filtered.length })}</span>
        </div>}
        {status}
        {workspace && view === 'overview' && <PipelineOverview workspace={workspace} open={open.length} onDeals={() => go({ view: 'deals' })} onBoard={() => go({ view: 'board' })} onToday={() => go({ view: 'today' })} />}
        {workspace && view === 'deals' && <CrmDeals deals={filtered} today={workspace.today} onOpen={openDeal} selectedId={null}
          emptyLabel={workspace.deals.length ? t('No deals match these filters.') : t('No deals yet. Use Capture or New deal to add one.')} />}
        {workspace && view === 'board' && <CrmPipeline crm={crm} workspace={workspace} deals={filtered} onOpen={openDeal} selectedId={null} />}
        {workspace && view === 'forecast' && <CrmForecast workspace={workspace} onOpenInitiative={openInitiative} />}
      </div>
    </ToolPage>
    {dialogs}
  </>;
}

/** The pipeline's Overview body: the numbers that say how it is going, and
 *  the queue that says what needs doing. */
function PipelineOverview({ workspace, open, onDeals, onBoard, onToday }: { workspace: CrmWorkspace; open: number; onDeals: () => void; onBoard: () => void; onToday: () => void }) {
  const { t, locale } = useI18n();
  const totals = workspace.totals.find(total => total.currency === workspace.primaryCurrency);
  const queue = todayQueue(workspace.deals);
  const overdue = queue.filter(deal => deal.action!.urgency === 'overdue').length;
  const metric = (label: string, value: string, hint?: string, danger?: boolean) => <div className="min-w-0 space-y-1">
    <dt className="truncate text-xs text-muted-foreground">{label}</dt>
    <dd className={`truncate text-xl font-semibold tabular-nums ${danger ? 'text-[var(--status-danger)]' : ''}`}>{value}</dd>
    {hint && <dd className="truncate text-xs text-muted-foreground">{hint}</dd>}
  </div>;
  if (!workspace.deals.length) return <p className="text-sm text-muted-foreground">{t('No deals yet. Use Capture or New deal to add one.')}</p>;
  return <div className="space-y-6">
    <dl className="grid grid-cols-2 gap-6 @2xl/crm:grid-cols-4">
      {metric(t('Open pipeline'), totals ? money(totals.pipeline, workspace.primaryCurrency, locale, true) : '—', t('{n} open deals', { n: open }))}
      {metric(t('Forecast · next {n} days', { n: workspace.params.horizonDays }), totals ? money(totals.forecast, workspace.primaryCurrency, locale, true) : '—', t('Weighted by likelihood'))}
      {metric(t('Weighted'), totals ? money(totals.weightedPipeline, workspace.primaryCurrency, locale, true) : '—')}
      {metric(t('Needs attention'), String(queue.length), overdue ? t('{n} overdue', { n: overdue }) : t('Nothing overdue'), overdue > 0)}
    </dl>
    <div className="-ml-2.5 flex flex-wrap gap-0.5">
      <Button variant="ghost" size="sm" onClick={onToday}>{t('Today')}</Button>
      <Button variant="ghost" size="sm" onClick={onDeals}>{t('Deals')}</Button>
      <Button variant="ghost" size="sm" onClick={onBoard}>{t('Board')}</Button>
    </div>
  </div>;
}
