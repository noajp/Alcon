'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CornerDownRight, FolderInput, FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { Popover, PopoverAnchor, PopoverTrigger } from '@/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/ui/context-menu';
import { MenuShell } from '@/Function/shared/menu';
import { EmptyState } from '@/Function/shared/EmptyState';
import { QuickCreatePopup } from '@/Function/shared/QuickCreatePopup';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { PageHead, PageLayout, PageSection } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { RailRow } from '@/Function/shared/RailRow';
import { ContentRow, ContentRowAction } from '@/Function/shared/ContentRow';
import { formatRelative } from '@/Function/shared/dateUtils';
import { appDialog } from '@/Function/shared/appDialogStore';
import { RenameInput } from '@/ActivitySpace/sustainment/notebook/RenameInput';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useStrategies, useDomains, useObjects } from '@/hooks/useSupabase';
import { useInitiativeHealth } from '@/ActivitySpace/strategy/initiative/useInitiativeHealth';
import type { InitiativeHealth } from '@/ActivitySpace/strategy/initiative/initiativeHealthModel';
import { NavPortfolioIcon, NavStrategyIcon, NavVisionIcon } from '@/shell/sidebar/NavIcons';
import type { Portfolio, StrategyWithObjects } from '@/types/database';
import { createPortfolio, deletePortfolio, movePortfolio, PortfolioMoveRefused, setStrategyPortfolio, updatePortfolio, usePortfolios } from './data';
import { resolveVision, useVisions } from '@/ActivitySpace/strategy/vision/data';
import { useActiveObjectCount } from '@/hooks/useObjectArchive';
import {
  buildPortfolioTree, findNode, flattenTree, groupByPortfolio, initiativesInSpace, portfolioPath, rollupPortfolio, subtreeIds,
  type PortfolioNode, type PortfolioRollup,
} from './portfolioGroups';

// Strategy > Portfolio — the Space's Initiatives bundled into Portfolios,
// which nest. The tree lists every Portfolio with what it adds up to
// (Initiatives, mean progress, alerts); opening one shows its description,
// the Portfolios inside it and its Initiatives with their health. An
// Initiative sits in at most one Portfolio. Root Initiatives outside every
// Portfolio are listed under the tree.
export function PortfolioView({ visionId, activePortfolioId, createRequested, onCreateHandled, onSelectPortfolio, onSelectStrategy, onRequestVision }: {
  /** The Vision whose Portfolios the page shows (null = the Space's first). */
  visionId: string | null;
  /** No Vision exists yet — the page asks for one first. */
  onRequestVision: () => void;
  activePortfolioId: string | null;
  createRequested: boolean;
  onCreateHandled: () => void;
  onSelectPortfolio: (id: string | null) => void;
  onSelectStrategy: (id: string) => void;
}) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: visions, loading: visionsLoading } = useVisions(spaceId);
  const vision = resolveVision(visions, visionId);
  const { data: allPortfolios, loading: portfoliosLoading, refetch } = usePortfolios(spaceId);
  // Portfolios belong to a Vision: the page is one Vision's tree.
  const portfolios = useMemo(() => allPortfolios.filter((p) => !!vision && p.vision_id === vision.id), [allPortfolios, vision]);
  const { data: allStrategies, loading: strategiesLoading } = useStrategies();
  // An Initiative reaches a Space through its Objects' Domains — the page
  // lists the ones with an Object in this Space (or none yet).
  const { data: domains } = useDomains();
  const { data: explorer } = useObjects();
  const strategies = useMemo(() => {
    const objectDomain = new Map<string, string | null>(explorer.objects.map((o) => [o.id, o.domain_id]));
    return initiativesInSpace(allStrategies, objectDomain, new Set(domains.map((d) => d.id)));
  }, [allStrategies, explorer.objects, domains]);
  // Inside the Vision: its Initiatives by Portfolio, and the ones placed
  // directly under the Vision.
  const { byPortfolio, unassigned } = useMemo(
    () => groupByPortfolio(portfolios, strategies.filter((s) => !!vision && s.vision_id === vision.id)),
    [portfolios, strategies, vision]);
  const tree = useMemo(() => buildPortfolioTree(portfolios), [portfolios]);
  const roots = useMemo(() => strategies.filter((s) => s.parentIds.length === 0), [strategies]);
  const { byId: healthById } = useInitiativeHealth(roots);

  // Creating: the sidebar "+" or the header "+" makes a top-level Portfolio;
  // a row's menu (or the detail page) makes one nested inside.
  const [localNew, setLocalNew] = useState<{ parentId: string | null } | null>(null);
  const newParent = localNew ? localNew.parentId : createRequested ? null : undefined;
  const closeNew = () => { setLocalNew(null); if (createRequested) onCreateHandled(); };
  // A request that arrives while the Space has no Vision cannot be served;
  // clear it so the card does not appear later, unasked.
  useEffect(() => {
    if (createRequested && !visionsLoading && !vision) onCreateHandled();
  }, [createRequested, visionsLoading, vision, onCreateHandled]);

  const open = activePortfolioId ? findNode(tree, activePortfolioId) : null;
  const loading = portfoliosLoading || strategiesLoading || visionsLoading;

  return (
    <div className="flex flex-col h-full bg-card">
      {open ? (
        <PortfolioDetail node={open} visionName={vision?.name ?? null} portfolios={portfolios} byPortfolio={byPortfolio} healthById={healthById}
          candidates={roots.filter((s) => s.portfolio_id !== open.portfolio.id)}
          onOpenPortfolio={onSelectPortfolio} onSelectStrategy={onSelectStrategy}
          onNewInside={() => setLocalNew({ parentId: open.portfolio.id })} />
      ) : (
        <>
          <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
            <NavPortfolioIcon size={12} />
            <span className="text-[12px] font-semibold text-foreground">{t('Portfolio')}</span>
            {vision && <span className="truncate text-[12px] text-muted-foreground">{vision.name}</span>}
            <div className="flex-1" />
            {vision && (
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" type="button"
                onClick={() => setLocalNew({ parentId: null })} title={t('New Portfolio')} aria-label={t('New Portfolio')}>
                <Plus size={14} />
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? null : !vision ? (
              <EmptyState icon={NavPortfolioIcon} title={t('Add a Vision first')}
                description={t('Portfolios belong to a Vision, the way Objects belong to a Domain.')}
                hint={t('A Space can hold several Visions.')}
                cta={t('Create Vision')} onCta={onRequestVision} />
            ) : portfolios.length === 0 && unassigned.length === 0 ? (
              <EmptyState icon={NavPortfolioIcon} title={t('Add Portfolios')}
                description={t('A Portfolio bundles Initiatives that serve one part of the Vision, so the Strategy reads as a few bets instead of a long list.')}
                hint={t('Portfolios nest, and an Initiative belongs to at most one Portfolio.')}
                cta={t('Create Portfolio')} onCta={() => setLocalNew({ parentId: null })} />
            ) : (
              <div className="px-4 py-3">
                <PortfolioTree tree={tree} byPortfolio={byPortfolio} healthById={healthById}
                  onOpen={onSelectPortfolio} onNewInside={(id) => setLocalNew({ parentId: id })} />
                {unassigned.length > 0 && (
                  <div className="mt-4">
                    <div className="px-2 h-6 flex items-center text-[11px] font-semibold tracking-wide text-muted-foreground/60">{t('Not in a Portfolio')}</div>
                    {unassigned.map((s) => (
                      <InitiativeRow key={s.id} strategy={s} health={healthById.get(s.id)} onOpen={() => onSelectStrategy(s.id)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {newParent !== undefined && spaceId && vision && (
        <QuickCreatePopup
          open
          icon={<NavPortfolioIcon size={12} />}
          contextLabel={newParent ? t('New Portfolio in {name}', { name: portfolios.find((p) => p.id === newParent)?.name ?? '' }) : t('New Portfolio')}
          ariaLabel={t('New Portfolio')}
          namePlaceholder={t('Portfolio name…')}
          onClose={closeNew}
          onSubmit={async ({ name, description }) => {
            await createPortfolio({
              activity_space_id: spaceId, vision_id: vision.id, parent_id: newParent, name, description: description || null,
              order_index: portfolios.filter((p) => (p.parent_id ?? null) === newParent).length,
            });
            await refetch();
            closeNew();
          }}
        />
      )}
    </div>
  );
}

// A Portfolio write from a menu has no field to show its error in; a failed
// one is reported in a dialog instead of vanishing.
function useGuardedWrite() {
  const { t } = useI18n();
  return async (write: () => Promise<unknown>) => {
    try { await write(); }
    catch (e) { await appDialog.alert(`${t("Couldn't save")}: ${e instanceof Error ? e.message : String(e)}`); }
  };
}

// ── The tree ────────────────────────────────────────────────────────────
function PortfolioTree({ tree, byPortfolio, healthById, onOpen, onNewInside }: {
  tree: PortfolioNode[];
  byPortfolio: Map<string, StrategyWithObjects[]>;
  healthById: Map<string, InitiativeHealth>;
  onOpen: (id: string) => void;
  onNewInside: (id: string) => void;
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const isOpen = (id: string) => !folded.has(id);
  const rows = useMemo(() => flattenTree(tree, (id) => !folded.has(id)), [tree, folded]);
  return (
    <div>
      {rows.map((node) => (
        <PortfolioTreeRow key={node.portfolio.id} node={node} tree={tree}
          rollup={rollupPortfolio(node, byPortfolio, healthById)}
          open={isOpen(node.portfolio.id)}
          onToggle={() => setFolded((prev) => { const n = new Set(prev); if (n.has(node.portfolio.id)) n.delete(node.portfolio.id); else n.add(node.portfolio.id); return n; })}
          onOpen={() => onOpen(node.portfolio.id)} onNewInside={() => onNewInside(node.portfolio.id)} />
      ))}
    </div>
  );
}

function PortfolioTreeRow({ node, tree, rollup, open, onToggle, onOpen, onNewInside }: {
  node: PortfolioNode; tree: PortfolioNode[]; rollup: PortfolioRollup;
  open: boolean; onToggle: () => void; onOpen: () => void; onNewInside: () => void;
}) {
  const { t } = useI18n();
  const { portfolio } = node;
  const [renaming, setRenaming] = useState(false);
  const guarded = useGuardedWrite();
  const hasChildren = node.children.length > 0;
  return (
    <PortfolioMenu portfolio={portfolio} node={node} tree={tree}
      onRename={() => setRenaming(true)} onNewInside={onNewInside}>
      <div>
        <ContentRow indent={node.depth * 20} icon={<NavPortfolioIcon size={16} />} name={portfolio.name} description={portfolio.description}
          onOpen={onOpen}
          body={renaming ? (
            <span className="flex h-8 min-w-0 flex-1 items-center gap-2.5 px-2"><span className="flex w-4 shrink-0 items-center justify-center"><NavPortfolioIcon size={16} /></span>
              <RenameInput initial={portfolio.name} className="text-[13px] font-medium"
                onCommit={(v) => { setRenaming(false); if (v.trim() && v.trim() !== portfolio.name) void guarded(() => updatePortfolio(portfolio.id, { name: v.trim() })); }}
                onCancel={() => setRenaming(false)} />
            </span>
          ) : undefined}
          meta={<RollupFigures rollup={rollup} />}>
          <button type="button" onClick={onToggle} disabled={!hasChildren}
            className={`flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground ${hasChildren ? '' : 'invisible'}`}
            aria-label={`${t(open ? 'Collapse' : 'Expand')} ${portfolio.name}`} aria-expanded={hasChildren ? open : undefined}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </ContentRow>
      </div>
    </PortfolioMenu>
  );
}

function PortfolioMenu({ portfolio, node, tree, onRename, onNewInside, children }: {
  portfolio: Portfolio; node: PortfolioNode; tree: PortfolioNode[];
  onRename: () => void; onNewInside: () => void; children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [moveOpen, setMoveOpen] = useState(false);
  const guarded = useGuardedWrite();
  const excluded = useMemo(() => subtreeIds(node), [node]);
  // Targets in tree order, so the picker's indentation reads as the tree.
  const targets = useMemo(
    () => flattenTree(tree, () => true).filter((n) => !excluded.has(n.portfolio.id) && n.portfolio.id !== portfolio.parent_id),
    [tree, excluded, portfolio.parent_id]);
  const remove = async () => {
    const nested = subtreeIds(node).size - 1;
    const msg = nested > 0
      ? t('Delete the Portfolio "{name}" and the {n} Portfolios inside it? Their Initiatives stay, outside any Portfolio.', { name: portfolio.name, n: String(nested) })
      : t('Delete the Portfolio "{name}"? Its Initiatives stay, outside any Portfolio.', { name: portfolio.name });
    if (!await appDialog.confirm(msg)) return;
    await guarded(() => deletePortfolio(portfolio.id));
  };
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        {/* Focus is not handed back to the row on close: Rename's input and the
            Move picker open from this menu and must keep it. */}
        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={onNewInside}><FolderPlus size={14} />{t('New Portfolio inside')}</ContextMenuItem>
          {/* After the menu has closed, so the input mounts into a settled focus. */}
          <ContextMenuItem onSelect={() => setTimeout(onRename, 0)}><Pencil size={14} />{t('Rename')}</ContextMenuItem>
          <ContextMenuItem onSelect={() => setTimeout(() => setMoveOpen(true), 0)}><FolderInput size={14} />{t('Move into…')}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void remove()}><Trash2 size={14} />{t('Delete')}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {moveOpen && (
        <MovePicker targets={targets} allowTopLevel={portfolio.parent_id !== null}
          onPick={(parentId) => { setMoveOpen(false); void guarded(() => movePortfolio(portfolio.id, parentId)); }}
          onClose={() => setMoveOpen(false)} />
      )}
    </>
  );
}

// Where to nest a Portfolio: every other Portfolio outside its own subtree,
// plus the top level when it is nested now.
function MovePicker({ targets, allowTopLevel, onPick, onClose }: {
  targets: PortfolioNode[]; allowTopLevel: boolean;
  onPick: (parentId: string | null) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  return (
    <Popover open onOpenChange={(v) => { if (!v) onClose(); }}>
      <PopoverAnchor className="h-0" />
      <MenuShell width="wide" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t('Move into…')} autoFocus />
          <CommandList>
            <CommandEmpty>{t('No matches.')}</CommandEmpty>
            {allowTopLevel && !q && (
              <CommandItem value="__top" onSelect={() => onPick(null)}><CornerDownRight size={12} /><span className="flex-1">{t('Top level')}</span></CommandItem>
            )}
            {targets.filter((n) => !q || n.portfolio.name.toLowerCase().includes(q)).map((n) => (
              <CommandItem key={n.portfolio.id} value={`${n.portfolio.name} ${n.portfolio.id}`} onSelect={() => onPick(n.portfolio.id)}>
                <span style={{ width: q ? 0 : n.depth * 10 }} /><NavPortfolioIcon size={12} /><span className="flex-1 truncate">{n.portfolio.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </MenuShell>
    </Popover>
  );
}

function RollupFigures({ rollup }: { rollup: PortfolioRollup }) {
  const { t } = useI18n();
  return (
    <>
      {rollup.progressPct !== null && (
        <span className="flex w-24 items-center gap-1.5">
          <SegmentedProgress value={rollup.progressPct} className="flex-1" />
          <span className="w-7 text-right">{rollup.progressPct}%</span>
        </span>
      )}
      {rollup.alerts > 0 && <span className="text-destructive">{t('{n} alerts', { n: String(rollup.alerts) })}</span>}
      <span className="w-6 text-right" title={t('Initiatives')}>{rollup.initiatives}</span>
    </>
  );
}

// ── One Portfolio, opened ───────────────────────────────────────────────
function PortfolioDetail({ node, visionName, portfolios, byPortfolio, healthById, candidates, onOpenPortfolio, onSelectStrategy, onNewInside }: {
  node: PortfolioNode;
  /** The Vision this Portfolio sits under. */
  visionName: string | null;
  portfolios: Portfolio[];
  byPortfolio: Map<string, StrategyWithObjects[]>;
  healthById: Map<string, InitiativeHealth>;
  candidates: StrategyWithObjects[];
  onOpenPortfolio: (id: string | null) => void;
  onSelectStrategy: (id: string) => void;
  onNewInside: () => void;
}) {
  const { t } = useI18n();
  const { portfolio } = node;
  const path = useMemo(() => portfolioPath(portfolios, portfolio.id), [portfolios, portfolio.id]);
  const initiatives = byPortfolio.get(portfolio.id) ?? [];
  const rollup = rollupPortfolio(node, byPortfolio, healthById);
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const matches = candidates.filter((s) => !q || s.name.toLowerCase().includes(q));
  const parent = path.length > 1 ? path[path.length - 2] : null;
  const move = async (strategyId: string, into: Portfolio | null) => {
    setPickerOpen(false);
    setError(null);
    try { await setStrategyPortfolio(strategyId, into); }
    catch (e) {
      setError(e instanceof PortfolioMoveRefused ? t("Only the Initiative's owner can move it.") : e instanceof Error ? e.message : t("Couldn't save"));
    }
  };

  return (
    <>
      <div className="h-[50px] flex items-center gap-1 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <button type="button" onClick={() => onOpenPortfolio(null)}
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
          <NavPortfolioIcon size={12} />{t('Portfolio')}
        </button>
        {path.map((p) => (
          <span key={p.id} className="flex min-w-0 items-center gap-1">
            <ChevronRight size={12} className="shrink-0 text-muted-foreground/60" />
            {p.id === portfolio.id ? (
              <span className="truncate px-1.5 text-[12px] font-semibold text-foreground">{p.name}</span>
            ) : (
              <button type="button" onClick={() => onOpenPortfolio(p.id)}
                className="truncate rounded px-1.5 py-0.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">{p.name}</button>
            )}
          </span>
        ))}
        <div className="flex-1" />
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" onClick={onNewInside}
          title={t('New Portfolio inside')} aria-label={t('New Portfolio inside')}><FolderPlus size={14} /></Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <PageLayout rail={
          <RailCard title={t('Properties')}>
            <RailRow icon={<NavVisionIcon size={14} />} name={t('Vision')} label={visionName ?? '—'} placeholder={!visionName} dense />
            {parent ? (
              <button type="button" className="w-full" onClick={() => onOpenPortfolio(parent.id)}>
                <RailRow icon={<NavPortfolioIcon size={14} />} name={t('Inside')} label={parent.name} dense />
              </button>
            ) : (
              <RailRow icon={<NavPortfolioIcon size={14} />} name={t('Inside')} label={t('Top level')} placeholder dense />
            )}
            <RailRow icon={<NavStrategyIcon size={14} />} name={t('Initiatives')} label={String(rollup.initiatives)} placeholder={rollup.initiatives === 0} dense />
            {rollup.progressPct !== null && (
              <RailRow name={t('Progress')} dense label={
                <span className="flex w-full items-center gap-2">
                  <SegmentedProgress value={rollup.progressPct} className="flex-1" />
                  <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{rollup.progressPct}%</span>
                </span>
              } />
            )}
            {rollup.alerts > 0 && (
              <RailRow name={t('Alerts')} dense label={<span className="text-destructive">{t('{n} alerts', { n: String(rollup.alerts) })}</span>} />
            )}
          </RailCard>
        }>
          <PageHead key={portfolio.id} icon={<NavPortfolioIcon size={18} />} title={portfolio.name} description={portfolio.description ?? ''} canEdit
            titleLabel={t('Portfolio name')} titlePlaceholder={t('Portfolio name…')}
            descriptionLabel={t('Description')} descriptionPlaceholder={t('What this Portfolio is a bet on, and what it should add up to.')}
            onSaveTitle={(name) => void updatePortfolio(portfolio.id, { name })}
            onSaveDescription={(description) => void updatePortfolio(portfolio.id, { description: description || null })} />

          {node.children.length > 0 && (
            <PageSection title={t('Portfolios inside')}>
              {node.children.map((child) => (
                <ContentRow key={child.portfolio.id} icon={<NavPortfolioIcon size={16} />} name={child.portfolio.name}
                  onOpen={() => onOpenPortfolio(child.portfolio.id)}
                  meta={<RollupFigures rollup={rollupPortfolio(child, byPortfolio, healthById)} />} />
              ))}
            </PageSection>
          )}

          <PageSection title={t('Initiatives')}>
            {initiatives.length === 0 && (
              <p className="px-2 py-2 text-[12px] text-muted-foreground">{t('No Initiatives in this Portfolio yet.')}</p>
            )}
            {initiatives.map((s) => (
              <InitiativeRow key={s.id} strategy={s} health={healthById.get(s.id)} onOpen={() => onSelectStrategy(s.id)} onRemove={() => void move(s.id, null)} />
            ))}
            <ButtonAppearanceProvider appearance="inline">
              <Popover open={pickerOpen} onOpenChange={(v) => { setPickerOpen(v); if (!v) setQuery(''); }}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" align="start" className="text-muted-foreground"><Plus size={13} strokeWidth={2.5} />{t('Add Initiative')}</Button>
                </PopoverTrigger>
                <MenuShell width="wide" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput value={query} onValueChange={setQuery} placeholder={t('Find an Initiative…')} />
                    <CommandList>
                      <CommandEmpty>{t('No matches.')}</CommandEmpty>
                      {matches.map((s) => (
                        <CommandItem key={s.id} value={`${s.name} ${s.id}`} onSelect={() => void move(s.id, portfolio)}>
                          <NavStrategyIcon size={12} /><span className="flex-1 truncate">{s.name}</span>
                          {s.portfolio_id && <span className="text-[11px] text-muted-foreground">{t('In another Portfolio')}</span>}
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                </MenuShell>
              </Popover>
            </ButtonAppearanceProvider>
            {error && <div className="px-2 py-1 text-[11px] text-destructive">{error}</div>}
          </PageSection>
        </PageLayout>
      </div>
    </>
  );
}

function InitiativeRow({ strategy, health, onOpen, onRemove }: {
  strategy: StrategyWithObjects; health: InitiativeHealth | undefined; onOpen: () => void; onRemove?: () => void;
}) {
  const { t } = useI18n();
  // Archived Objects stay linked but are not counted.
  const countObjects = useActiveObjectCount();
  const alerts = health ? health.risk.overdue + health.risk.stalled + health.risk.blocked : 0;
  const moved = health?.lastActivityAt != null ? formatRelative(new Date(health.lastActivityAt).toISOString()) : null;
  return (
    <ContentRow icon={<NavStrategyIcon size={16} />} name={strategy.name} onOpen={onOpen}
      meta={<>
        {health?.progressPct != null && (
          <span className="flex w-24 items-center gap-1.5">
            <SegmentedProgress value={health.progressPct} className="flex-1" />
            <span className="w-7 text-right">{health.progressPct}%</span>
          </span>
        )}
        {moved && <span className="hidden text-muted-foreground/70 sm:inline">{moved}</span>}
        {alerts > 0 && <span className="text-destructive">{t('{n} alerts', { n: String(alerts) })}</span>}
        <span className="w-6 text-right" title={t('Objects')}>{countObjects(strategy.objectIds)}</span>
      </>}
      actions={onRemove
        ? <ContentRowAction label={t('Remove from Portfolio')} onClick={onRemove}><X size={12} /></ContentRowAction>
        : <span className="w-6" />} />
  );
}
