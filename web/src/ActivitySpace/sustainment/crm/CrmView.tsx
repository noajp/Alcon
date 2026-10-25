'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, ChevronDown, Columns3, Filter, Layers, List, PenLine, Plus, Settings2, Users, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { DateField } from '@/Function/shared/date';
import { PageHead, PageLayout, PageSection } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { RailRow } from '@/Function/shared/RailRow';
import { IndexList, IndexRow } from '@/Function/shared/IndexList';
import { ToolPage, type ToolView } from '@/Function/shared/tool/ToolPage';
import { PlacePage as SharedPlacePage } from '@/Function/shared/tool/PlacePage';
import { CrmIcon } from '@/Function/shared/conceptIcons';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { NavigationState } from '@/types/navigation';
import { useCrm, type Crm } from '@/hooks/useCrm';
import { forecastFor, inList, searchDeals, type CrmDealRecord, type CrmHealthLevel, type CrmList, type CrmWorkspace } from './crmModel';
import { crmRoute, routeTo, type CrmRoute, type CrmViewId } from './crmRoute';
import { useCrmScope } from './crmScope';
import { HealthDot, money } from './crmFormat';
import { CrmToday } from './CrmToday';
import { CrmPipeline } from './CrmPipeline';
import { CrmDeals } from './CrmDeals';
import { CrmCompanies, CrmCompanyPage, CrmContactPage, CrmContacts } from './CrmDirectory';
import { CrmForecast } from './CrmForecast';
import { CrmSettings } from './CrmSettings';
import { CrmDealPage } from './CrmDealPage';
import { CrmCapture } from './CaptureDialog';
import { CrmPicker } from './CrmPicker';

// The CRM App. Read through a scope (whose records — see crmScope): the
// scope's overview, Today, the deals (a list across pipelines or
// one pipeline's board), the forecast, the ledgers; a deal, company or
// contact opens as a page of its own.

const LIST_LABEL: Record<CrmList, string> = {
  mine: 'My deals', 'at-risk': 'At risk', 'closing-soon': 'Closing soon', renewing: 'Renewing', 'no-next-step': 'No next step', stale: 'Going quiet', won: 'Won', lost: 'Lost', incomplete: 'Missing details',
};
const LISTS = Object.keys(LIST_LABEL) as CrmList[];
const HEALTH_ORDER: CrmHealthLevel[] = ['risk', 'watch', 'healthy', 'incomplete'];
const HEALTH_LABEL: Record<CrmHealthLevel, string> = { risk: 'At risk', watch: 'Watch', healthy: 'Healthy', incomplete: 'Missing details', closed: 'Closed' };

// The deals' two readings — the tabs on Deals.
const DEAL_TABS: readonly ToolView[] = [
  { id: 'deals', label: 'List', icon: List },
  { id: 'board', label: 'Board', icon: Columns3, wide: true },
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

/** A place in the CRM that is not a record. */
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
  const scoped = useCrmScope(crm, route.pipelineId);
  const { pipeline, workspace, pooled } = scoped;

  // New deals and the board belong to one pipeline: keep the hook's pipeline
  // on one the scope holds, so a deal is never created outside the scope.
  useEffect(() => {
    if (pipeline && crm.pipeline && crm.pipeline.id !== pipeline.id) onNavigate({ crm: routeTo(route, { pipelineId: pipeline.id }) });
  }, [pipeline, crm.pipeline, route, onNavigate]);

  // Capture opens from the header (local state) or from a route request.
  const capture = captureFor !== undefined ? captureFor : route.capture && workspace ? route.dealId ?? null : undefined;
  const closeCapture = () => { setCaptureFor(undefined); if (route.capture) go({ capture: false }); };

  // The deals a list reads: the board's pipeline, or every pipeline in the scope.
  const listSource = route.view === 'board' ? workspace : route.pipelineId ? workspace : pooled;
  const filtered = useMemo(() => {
    if (!listSource) return [];
    let deals = searchDeals(listSource.deals, route.query ?? '');
    if (route.stage !== undefined && route.stage !== null) deals = deals.filter(deal => deal.outcome === 'open' && deal.stage?.id === route.stage);
    if (route.list) deals = deals.filter(deal => inList(deal, route.list!, listSource.today, listSource.params.horizonDays, crm.me));
    if (route.account !== undefined && route.account !== null) deals = deals.filter(deal => (deal.companyId ?? '') === route.account);
    if (route.owner) deals = deals.filter(deal => deal.ownerId === route.owner);
    return deals;
  }, [listSource, route.query, route.stage, route.list, route.account, route.owner, crm.me]);
  // Today is personal by default: my deals and the ones nobody owns yet.
  const todayWorkspace = useMemo<CrmWorkspace | null>(() => pooled && !everyone && crm.me
    ? { ...pooled, deals: pooled.deals.filter(deal => !deal.ownerId || deal.ownerId === crm.me) } : pooled, [pooled, everyone, crm.me]);

  const openDeal = (dealId: string) => go({ dealId, companyId: null, contactId: null });
  const openDealRecord = (deal: CrmDealRecord) => go({ dealId: deal.id, companyId: null, contactId: null });
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
    {route.settings && <Dialog open onOpenChange={open => { if (!open) go({ settings: false }); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogTitle>{t('Pipeline settings')}</DialogTitle>
        <DialogDescription>{t('The pipeline’s stages, currency and rhythm.')}</DialogDescription>
        {crm.pipeline ? <CrmSettings crm={crm} onSelectPipeline={pipelineId => go({ pipelineId })} /> : <p className="text-sm text-muted-foreground">{t('Loading your pipeline…')}</p>}
      </DialogContent>
    </Dialog>}
  </>;

  // ── A record's page ─────────────────────────────────────────────────
  const selected = route.dealId ? crm.workspaces.flatMap(item => item.deals).find(deal => deal.id === route.dealId) ?? null : null;
  if (selected) {
    return <>
      <CrmDealPage key={selected.id} crm={crm} deal={selected} onBack={closeRecord}
        onOpenPipeline={() => go({ dealId: null, view: 'board', pipelineId: selected.pipelineId })}
        onCapture={dealId => setCaptureFor(dealId)} onOpenElement={onOpenElement} onOpenInitiative={openInitiative}
        onOpenCompany={companyId => go({ companyId, dealId: null })} onOpenContact={contactId => go({ contactId, dealId: null })} onOpenDeal={openDeal} />
      {dialogs}
    </>;
  }
  if (route.companyId) return <>
    <CrmCompanyPage key={route.companyId} crm={crm} companyId={route.companyId} onBack={closeRecord} onOpenCompanies={() => go({ view: 'companies' })}
      onOpenDeal={openDealRecord} onOpenContact={contactId => go({ contactId, companyId: null })} onOpenElement={onOpenElement} />
    {dialogs}
  </>;
  if (route.contactId) return <>
    <CrmContactPage key={route.contactId} crm={crm} contactId={route.contactId} onBack={closeRecord} onOpenContacts={() => go({ view: 'contacts' })}
      onOpenDeal={openDealRecord} onOpenCompany={companyId => go({ companyId, contactId: null })} onOpenElement={onOpenElement} />
    {dialogs}
  </>;

  const status = <>
    {crm.loading && <p role="status" className="py-6 text-sm text-muted-foreground">{t('Loading your pipeline…')}</p>}
    {crm.error && <div role="alert" className="space-y-2"><p className="text-sm text-[var(--status-danger)]">{t('Could not load your pipeline.')} {crm.error instanceof Error ? crm.error.message : ''}</p>
      <Button onClick={() => void crm.refetch()}>{t('Retry')}</Button></div>}
    {!crm.loading && !crm.error && !scoped.pipelines.length && <div className="space-y-3 py-6">
      <p className="text-sm text-muted-foreground">{t('No pipeline in this scope yet.')}</p>
      <Button variant="secondary" onClick={() => go({ settings: true })}><Settings2 size={14} />{t('Pipeline settings')}</Button>
    </div>}
  </>;

  // ── The scope's overview ────────────────────────────────────────────
  if (route.view === 'home') return <>
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
      <header className="flex h-[50px] flex-shrink-0 items-center gap-1.5 border-b border-border/60 bg-card pl-4 pr-2">
        <CrmIcon size={12} /><span className="text-[12px] font-semibold text-foreground">{t('CRM')}</span>
        <span className="min-w-0 truncate text-[12px] text-muted-foreground">{scoped.scopeName}</span>
        <div className="flex-1" />
        {headerActions && <div className="flex shrink-0 items-center gap-1.5">{headerActions}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageLayout rail={<RailCard title={t('Properties')}>
          <RailRow icon={<Layers className="size-3.5 text-muted-foreground" />} name={t('Scope')} dense label={scoped.scopeName} placeholder={scoped.scope === null} />
          <RailRow icon={<Columns3 className="size-3.5 text-muted-foreground" />} name={t('Pipelines')} dense label={String(scoped.pipelines.length)} placeholder={!scoped.pipelines.length} />
          <button type="button" className="w-full" onClick={() => go({ view: 'companies' })}><RailRow icon={<Building2 className="size-3.5 text-muted-foreground" />} name={t('Companies')} dense label={String(scoped.companies.length)} placeholder={!scoped.companies.length} /></button>
          <button type="button" className="w-full" onClick={() => go({ view: 'contacts' })}><RailRow icon={<Users className="size-3.5 text-muted-foreground" />} name={t('Contacts')} dense label={String(scoped.contacts.length)} placeholder={!scoped.contacts.length} /></button>
        </RailCard>}>
          <PageHead icon={<CrmIcon size={18} />} title={scoped.scopeName === t('Everything') ? t('CRM') : scoped.scopeName}
            description={t('Where every deal in this scope stands, pipeline by pipeline.')} canEdit={false}
            titleLabel={t('CRM')} titlePlaceholder="" descriptionLabel="" descriptionPlaceholder="" onSaveTitle={() => {}} />
          <div className="@container/crm space-y-8">
            {status}
            {pooled && <ScopeOverview workspaces={scoped.workspaces} pooled={pooled} locale={locale} onOpenPipeline={id => go({ view: 'board', pipelineId: id })} onOpenList={list => go({ view: 'deals', list, pipelineId: null })} />}
          </div>
        </PageLayout>
      </div>
    </div>
    {dialogs}
  </>;

  // ── Today ───────────────────────────────────────────────────────────
  if (route.view === 'today') return <>
    <PlacePage title={t('Today')} actions={<>
      {pooled && crm.me && <div role="group" aria-label={t('Whose deals')} className="mr-2 flex gap-1">
        <Button shape="tab" size="sm" variant={!everyone ? 'secondary' : 'ghost'} aria-pressed={!everyone} onClick={() => setEveryone(false)}>{t('Mine')}</Button>
        <Button shape="tab" size="sm" variant={everyone ? 'secondary' : 'ghost'} aria-pressed={everyone} onClick={() => setEveryone(true)}>{t('Everyone')}</Button>
      </div>}
      {headerActions}
    </>}>
      {status}
      {todayWorkspace && <CrmToday crm={crm} workspace={todayWorkspace} pipelineDeals={pooled?.deals.length ?? 0} onShowEveryone={() => setEveryone(true)}
        onOpen={openDeal} onCapture={() => setCaptureFor(null)} onList={list => go({ view: 'deals', list, pipelineId: null })} />}
    </PlacePage>
    {dialogs}
  </>;

  // ── The ledgers ─────────────────────────────────────────────────────
  if (route.view === 'companies') return <>
    <PlacePage title={t('Companies')}>{status}{pooled && <CrmCompanies crm={{ ...crm, companies: scoped.companies }} query={route.query ?? ''} selectedId={null} onOpen={companyId => go({ companyId })} />}</PlacePage>
    {dialogs}
  </>;
  if (route.view === 'contacts') return <>
    <PlacePage title={t('Contacts')}>{status}{pooled && <CrmContacts crm={{ ...crm, contacts: scoped.contacts }} query={route.query ?? ''} selectedId={null} onOpen={contactId => go({ contactId })} />}</PlacePage>
    {dialogs}
  </>;

  // ── Forecast: each pipeline in the scope, in its own currency ───────
  if (route.view === 'forecast') return <>
    <PlacePage title={t('Forecast')} actions={headerActions}>
      {status}
      <div className="space-y-12">{scoped.workspaces.map(item => <section key={item.pipeline.id} className="space-y-4">
        {scoped.workspaces.length > 1 && <h2 className="text-[15px] font-medium">{item.pipeline.name}</h2>}
        <CrmForecast workspace={item} onOpenInitiative={openInitiative} />
      </section>)}</div>
    </PlacePage>
    {dialogs}
  </>;

  // ── Deals: a list across the scope, or one pipeline's board ─────────
  const view: 'deals' | 'board' = route.view === 'board' ? 'board' : 'deals';
  const chips = [
    route.stage !== undefined && route.stage !== null && { key: 'stage', label: `${t('Stage')}: ${t(workspace?.stages.find(stage => stage.id === route.stage)?.label ?? route.stage)}` },
    route.list && { key: 'list', label: t(LIST_LABEL[route.list]) },
    route.account !== undefined && route.account !== null && { key: 'account', label: `${t('Company')}: ${crm.companies.find(company => company.id === route.account)?.name ?? t('No company')}` },
    route.owner && { key: 'owner', label: `${t('Owner')}: ${crm.people.find(person => person.id === route.owner)?.name ?? ''}` },
    route.query && { key: 'query', label: `“${route.query}”` },
  ].filter(Boolean) as { key: 'stage' | 'list' | 'account' | 'owner' | 'query'; label: string }[];
  const boardOf = view === 'board' || !!route.pipelineId;

  // What narrows the deals: a stage (one pipeline's), a list, whose.
  const filterMenu = listSource && <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="sm" variant={chips.length ? 'secondary' : 'ghost'}><Filter size={14} />{t('Filter')}{chips.length > 0 && <span className="tabular-nums text-muted-foreground">{chips.length}</span>}<ChevronDown size={12} /></Button></DropdownMenuTrigger>
    <MenuShell as="dropdown" width="wide" align="end">
      {boardOf && workspace && <>
        <p className="px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">{t('Stage')}</p>
        {workspace.stages.map(stage => <DropdownMenuItem key={stage.id} className={MENU_ROW} onSelect={() => go({ stage: route.stage === stage.id ? null : stage.id })}>
          <span className="min-w-0 flex-1 truncate">{t(stage.label)}</span><span className="flex w-4 justify-end">{route.stage === stage.id && <Check size={12} />}</span></DropdownMenuItem>)}
      </>}
      <p className="px-2 pb-1 pt-2 text-[11px] text-muted-foreground">{t('Lists')}</p>
      {LISTS.filter(list => list !== 'mine' || crm.me).map(list => <DropdownMenuItem key={list} className={MENU_ROW} onSelect={() => go({ list: route.list === list ? null : list })}>
        <span className="min-w-0 flex-1 truncate">{t(LIST_LABEL[list])}</span>
        <span className="flex w-4 justify-end">{route.list === list && <Check size={12} />}</span></DropdownMenuItem>)}
      {crm.people.length > 1 && <>
        <p className="px-2 pb-1 pt-2 text-[11px] text-muted-foreground">{t('Owner')}</p>
        {crm.people.map(person => <DropdownMenuItem key={person.id} className={MENU_ROW} onSelect={() => go({ owner: route.owner === person.id ? null : person.id })}>
          <span className="min-w-0 flex-1 truncate">{person.name}</span><span className="flex w-4 justify-end">{route.owner === person.id && <Check size={12} />}</span></DropdownMenuItem>)}
      </>}
    </MenuShell>
  </DropdownMenu>;
  // Which pipeline the board shows, when the scope holds more than one.
  const pipelinePicker = scoped.pipelines.length > 1 && <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><Columns3 size={14} />{boardOf ? pipeline?.name : t('All pipelines')}<ChevronDown size={12} /></Button></DropdownMenuTrigger>
    <MenuShell as="dropdown" align="end">
      {view === 'deals' && <DropdownMenuItem className={MENU_ROW} onSelect={() => go({ pipelineId: null })}><span className="min-w-0 flex-1 truncate">{t('All pipelines')}</span><span className="flex w-4 justify-end">{!route.pipelineId && <Check size={12} />}</span></DropdownMenuItem>}
      {scoped.pipelines.map(item => <DropdownMenuItem key={item.id} className={MENU_ROW} onSelect={() => go({ pipelineId: item.id })}>
        <span className="min-w-0 flex-1 truncate">{item.name}</span><span className="flex w-4 justify-end">{boardOf && pipeline?.id === item.id && <Check size={12} />}</span></DropdownMenuItem>)}
    </MenuShell>
  </DropdownMenu>;

  return <>
    <ToolPage icon={CrmIcon} tool={t('CRM')} crumb={boardOf ? pipeline?.name : scoped.scopeName} storageKey="crm-deals" home="deals"
      views={DEAL_TABS.map(tab => ({ ...tab, label: tab.id === 'deals' && recordLabel ? recordLabel : tab.label }))} activeView={view}
      onSelectView={id => go({ view: id as CrmViewId })}
      actions={headerActions}
      viewControls={<div className="flex items-center gap-1">{pipelinePicker}{filterMenu}</div>}>
      <div className="@container/crm space-y-6">
        {chips.length > 0 && <div className="flex flex-wrap items-center gap-2">
          {chips.map(chip => <Button key={chip.key} size="xs" variant="secondary" aria-label={t('Clear filter {name}', { name: chip.label })}
            onClick={() => go(chip.key === 'query' ? { query: '' } : { [chip.key]: null })}>{chip.label}<X size={12} /></Button>)}
          <span className="text-xs text-muted-foreground">{t('{n} deals', { n: filtered.length })}</span>
        </div>}
        {status}
        {listSource && view === 'deals' && <CrmDeals deals={filtered} today={listSource.today} onOpen={openDeal} selectedId={null}
          emptyLabel={listSource.deals.length ? t('No deals match these filters.') : t('No deals yet. Use Capture or New deal to add one.')} />}
        {workspace && view === 'board' && <CrmPipeline crm={crm} workspace={workspace} deals={filtered} onOpen={openDeal} selectedId={null} />}
      </div>
    </ToolPage>
    {dialogs}
  </>;
}

/** The scope's overview: the totals that say how the deals stand (per
 *  currency, never summed across), their health, and each pipeline. */
function ScopeOverview({ workspaces, pooled, locale, onOpenPipeline, onOpenList }: {
  workspaces: CrmWorkspace[]; pooled: CrmWorkspace; locale: string;
  onOpenPipeline: (id: string) => void; onOpenList: (list: CrmList) => void;
}) {
  const { t } = useI18n();
  const open = pooled.deals.filter(deal => deal.outcome === 'open');
  const won = forecastFor(pooled.deals, pooled.primaryCurrency, pooled.today, 3);
  const health = HEALTH_ORDER.map(level => ({ level, count: open.filter(deal => deal.health.level === level).length }));
  const metric = (label: string, value: string, hint?: string) => <div className="min-w-0 space-y-1">
    <dt className="truncate text-xs text-muted-foreground">{label}</dt>
    <dd className="truncate text-xl font-semibold tabular-nums">{value}</dd>
    {hint && <dd className="truncate text-xs text-muted-foreground">{hint}</dd>}
  </div>;
  if (!pooled.deals.length) return <p className="text-sm text-muted-foreground">{t('No deals yet. Use Capture or New deal to add one.')}</p>;
  return <>
    {pooled.totals.map(total => <dl key={total.currency} className="grid grid-cols-2 gap-6 @2xl/crm:grid-cols-4">
      {metric(t('Open pipeline'), money(total.pipeline, total.currency, locale, true), t('{n} open deals', { n: total.openCount }))}
      {metric(t('Weighted'), money(total.weightedPipeline, total.currency, locale, true), t('Weighted by likelihood'))}
      {metric(t('Forecast · next {n} days', { n: pooled.params.horizonDays }), money(total.forecast, total.currency, locale, true))}
      {metric(t('Won'), money(total.currency === pooled.primaryCurrency ? won.months.reduce((sum, month) => sum + month.won, 0) : total.won, total.currency, locale, true), total.currency === pooled.primaryCurrency ? t('Last 3 months') : undefined)}
    </dl>)}

    <PageSection title={t('Health')}>
      <div className="max-w-xl space-y-2">
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          {health.map(({ level, count }) => count ? <span key={level} className={level === 'risk' ? 'bg-[var(--status-danger)]' : level === 'watch' ? 'bg-[var(--status-warning)]' : level === 'healthy' ? 'bg-[var(--status-success)]' : 'bg-muted-foreground/40'} style={{ width: `${(count / Math.max(1, open.length)) * 100}%` }} /> : null)}
        </div>
        <ul className="grid grid-cols-2 gap-1 @xl/crm:grid-cols-4">{health.map(({ level, count }) => <li key={level}>
          <button type="button" disabled={!count || (level !== 'risk' && level !== 'incomplete')} onClick={() => onOpenList(level === 'risk' ? 'at-risk' : 'incomplete')}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs enabled:hover:bg-muted/40 disabled:cursor-default">
            <HealthDot level={level} /><span className="flex-1 truncate">{t(HEALTH_LABEL[level])}</span><span className="tabular-nums text-muted-foreground">{count}</span>
          </button>
        </li>)}</ul>
      </div>
    </PageSection>

    <PageSection title={t('Pipelines')}>
      <IndexList headers={[t('Name'), t('Health'), t('Open deals')]}>
        {workspaces.map(item => {
          const itemOpen = item.deals.filter(deal => deal.outcome === 'open');
          const risk = itemOpen.filter(deal => deal.health.level === 'risk').length;
          const totals = item.totals.find(total => total.currency === item.primaryCurrency);
          const healthy = itemOpen.length ? Math.round((itemOpen.filter(deal => deal.health.level === 'healthy').length / itemOpen.length) * 100) : null;
          return <IndexRow key={item.pipeline.id} icon={<Columns3 size={13} />} name={item.pipeline.name}
            description={totals && item.primaryCurrency ? money(totals.weightedPipeline, item.primaryCurrency, locale, true) : undefined}
            health={<div className="flex min-w-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
              {healthy === null ? <span className="text-muted-foreground/60">{t('No open deals')}</span>
                : <span className="flex w-24 shrink-0 items-center gap-1.5"><SegmentedProgress value={healthy} className="flex-1" /><span className="w-7 text-right">{healthy}%</span></span>}
              {risk > 0 && <span className="text-[var(--status-danger)]">{t('{n} at risk', { n: risk })}</span>}
            </div>}
            count={itemOpen.length} onOpen={() => onOpenPipeline(item.pipeline.id)} />;
        })}
      </IndexList>
    </PageSection>
  </>;
}
