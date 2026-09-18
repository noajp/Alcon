'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CornerDownRight, FolderInput, FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/ui/context-menu';
import { MenuShell } from '@/Function/shared/menu';
import { EmptyState } from '@/Function/shared/EmptyState';
import { QuickCreatePopup } from '@/Function/shared/QuickCreatePopup';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { formatRelative } from '@/Function/shared/dateUtils';
import { appDialog } from '@/Function/shared/appDialogStore';
import { RenameInput } from '@/ActivitySpace/sustainment/notebook/RenameInput';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useStrategies, useDomains, useObjects } from '@/hooks/useSupabase';
import { useInitiativeHealth } from '@/ActivitySpace/strategy/initiative/useInitiativeHealth';
import type { InitiativeHealth } from '@/ActivitySpace/strategy/initiative/initiativeHealthModel';
import { NavPortfolioIcon, NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import type { Portfolio, StrategyWithObjects } from '@/types/database';
import { createPortfolio, deletePortfolio, movePortfolio, PortfolioMoveRefused, setStrategyPortfolio, updatePortfolio, usePortfolios } from './data';
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
export function PortfolioView({ activePortfolioId, createRequested, onCreateHandled, onSelectPortfolio, onSelectStrategy }: {
  activePortfolioId: string | null;
  createRequested: boolean;
  onCreateHandled: () => void;
  onSelectPortfolio: (id: string | null) => void;
  onSelectStrategy: (id: string) => void;
}) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: portfolios, loading: portfoliosLoading, refetch } = usePortfolios(spaceId);
  const { data: allStrategies, loading: strategiesLoading } = useStrategies();
  // An Initiative reaches a Space through its Objects' Domains — the page
  // lists the ones with an Object in this Space (or none yet).
  const { data: domains } = useDomains();
  const { data: explorer } = useObjects();
  const strategies = useMemo(() => {
    const objectDomain = new Map<string, string | null>(explorer.objects.map((o) => [o.id, o.domain_id]));
    return initiativesInSpace(allStrategies, objectDomain, new Set(domains.map((d) => d.id)));
  }, [allStrategies, explorer.objects, domains]);
  const { byPortfolio, unassigned } = useMemo(() => groupByPortfolio(portfolios, strategies), [portfolios, strategies]);
  const tree = useMemo(() => buildPortfolioTree(portfolios), [portfolios]);
  const roots = useMemo(() => strategies.filter((s) => s.parentIds.length === 0), [strategies]);
  const { byId: healthById } = useInitiativeHealth(roots);

  // Creating: the sidebar "+" or the header "+" makes a top-level Portfolio;
  // a row's menu (or the detail page) makes one nested inside.
  const [localNew, setLocalNew] = useState<{ parentId: string | null } | null>(null);
  const newParent = localNew ? localNew.parentId : createRequested ? null : undefined;
  const closeNew = () => { setLocalNew(null); if (createRequested) onCreateHandled(); };

  const open = activePortfolioId ? findNode(tree, activePortfolioId) : null;
  const loading = portfoliosLoading || strategiesLoading;

  return (
    <div className="flex flex-col h-full bg-card">
      {open ? (
        <PortfolioDetail node={open} portfolios={portfolios} byPortfolio={byPortfolio} healthById={healthById}
          candidates={roots.filter((s) => s.portfolio_id !== open.portfolio.id)}
          onOpenPortfolio={onSelectPortfolio} onSelectStrategy={onSelectStrategy}
          onNewInside={() => setLocalNew({ parentId: open.portfolio.id })} />
      ) : (
        <>
          <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
            <NavPortfolioIcon size={12} />
            <span className="text-[12px] font-semibold text-foreground">{t('Portfolio')}</span>
            <div className="flex-1" />
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground" type="button"
              onClick={() => setLocalNew({ parentId: null })} title={t('New Portfolio')} aria-label={t('New Portfolio')}>
              <Plus size={14} />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? null : portfolios.length === 0 ? (
              <EmptyState icon={NavPortfolioIcon} title={t('Add Portfolios')}
                description={t('A Portfolio bundles Initiatives that serve one part of the Vision, so the Strategy reads as a few bets instead of a long list.')}
                hint={t('Portfolios nest, and an Initiative belongs to at most one Portfolio.')}
                cta={t('Create Portfolio')} onCta={() => setLocalNew({ parentId: null })} />
            ) : (
              <div className="px-4 py-3">
                <PortfolioTree tree={tree} portfolios={portfolios} byPortfolio={byPortfolio} healthById={healthById}
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

      {newParent !== undefined && spaceId && (
        <QuickCreatePopup
          open
          icon={<NavPortfolioIcon size={12} />}
          contextLabel={newParent ? t('New Portfolio in {name}', { name: portfolios.find((p) => p.id === newParent)?.name ?? '' }) : t('New Portfolio')}
          ariaLabel={t('New Portfolio')}
          namePlaceholder={t('Portfolio name…')}
          onClose={closeNew}
          onSubmit={async ({ name, description }) => {
            await createPortfolio({
              activity_space_id: spaceId, parent_id: newParent, name, description: description || null,
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

// ── The tree ────────────────────────────────────────────────────────────
function PortfolioTree({ tree, portfolios, byPortfolio, healthById, onOpen, onNewInside }: {
  tree: PortfolioNode[];
  portfolios: Portfolio[];
  byPortfolio: Map<string, StrategyWithObjects[]>;
  healthById: Map<string, InitiativeHealth>;
  onOpen: (id: string) => void;
  onNewInside: (id: string) => void;
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const isOpen = (id: string) => !folded.has(id);
  const rows = useMemo(() => flattenTree(tree, isOpen), [tree, folded]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      {rows.map((node) => (
        <PortfolioTreeRow key={node.portfolio.id} node={node} portfolios={portfolios} tree={tree}
          rollup={rollupPortfolio(node, byPortfolio, healthById)}
          open={isOpen(node.portfolio.id)}
          onToggle={() => setFolded((prev) => { const n = new Set(prev); if (n.has(node.portfolio.id)) n.delete(node.portfolio.id); else n.add(node.portfolio.id); return n; })}
          onOpen={() => onOpen(node.portfolio.id)} onNewInside={() => onNewInside(node.portfolio.id)} />
      ))}
    </div>
  );
}

function PortfolioTreeRow({ node, portfolios, tree, rollup, open, onToggle, onOpen, onNewInside }: {
  node: PortfolioNode; portfolios: Portfolio[]; tree: PortfolioNode[]; rollup: PortfolioRollup;
  open: boolean; onToggle: () => void; onOpen: () => void; onNewInside: () => void;
}) {
  const { t } = useI18n();
  const { portfolio } = node;
  const [renaming, setRenaming] = useState(false);
  const hasChildren = node.children.length > 0;
  return (
    <PortfolioMenu portfolio={portfolio} node={node} portfolios={portfolios} tree={tree}
      onRename={() => setRenaming(true)} onNewInside={onNewInside}>
      <div className="flex min-w-0 items-center gap-1 rounded-md pr-2 hover:bg-muted/40" style={{ paddingLeft: node.depth * 20 }}>
        <Button variant="ghost" size="icon-sm" onClick={onToggle} disabled={!hasChildren}
          className={hasChildren ? '' : 'invisible'}
          aria-label={`${t(open ? 'Collapse' : 'Expand')} ${portfolio.name}`} aria-expanded={hasChildren ? open : undefined}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Button>
        {renaming ? (
          <span className="flex min-w-0 flex-1 items-center gap-2.5 py-1"><NavPortfolioIcon size={16} />
            <RenameInput initial={portfolio.name} className="text-xs font-semibold"
              onCommit={async (v) => { setRenaming(false); if (v.trim() && v.trim() !== portfolio.name) await updatePortfolio(portfolio.id, { name: v.trim() }); }}
              onCancel={() => setRenaming(false)} />
          </span>
        ) : (
          <Button variant="ghost" size="md" align="start" onClick={onOpen} className="min-w-0 flex-1 gap-2.5 text-xs font-semibold text-foreground">
            <NavPortfolioIcon size={16} /><span className="truncate">{portfolio.name}</span>
            {portfolio.description && <span className="hidden min-w-0 truncate text-[12px] font-normal text-muted-foreground sm:inline">{portfolio.description}</span>}
          </Button>
        )}
        <RollupCell rollup={rollup} />
      </div>
    </PortfolioMenu>
  );
}

function PortfolioMenu({ portfolio, node, portfolios, tree, onRename, onNewInside, children }: {
  portfolio: Portfolio; node: PortfolioNode; portfolios: Portfolio[]; tree: PortfolioNode[];
  onRename: () => void; onNewInside: () => void; children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [moveOpen, setMoveOpen] = useState(false);
  const excluded = useMemo(() => subtreeIds(node), [node]);
  const targets = portfolios.filter((p) => !excluded.has(p.id) && p.id !== portfolio.parent_id);
  const remove = async () => {
    const nested = subtreeIds(node).size - 1;
    const msg = nested > 0
      ? t('Delete the Portfolio "{name}" and the {n} Portfolios inside it? Their Initiatives stay, outside any Portfolio.', { name: portfolio.name, n: String(nested) })
      : t('Delete the Portfolio "{name}"? Its Initiatives stay, outside any Portfolio.', { name: portfolio.name });
    if (!await appDialog.confirm(msg)) return;
    await deletePortfolio(portfolio.id);
  };
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onNewInside}><FolderPlus size={14} />{t('New Portfolio inside')}</ContextMenuItem>
          <ContextMenuItem onSelect={onRename}><Pencil size={14} />{t('Rename')}</ContextMenuItem>
          <ContextMenuItem onSelect={() => setMoveOpen(true)}><FolderInput size={14} />{t('Move into…')}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void remove()}><Trash2 size={14} />{t('Delete')}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {moveOpen && (
        <MovePicker targets={targets} allowTopLevel={portfolio.parent_id !== null} tree={tree}
          onPick={async (parentId) => { setMoveOpen(false); await movePortfolio(portfolio.id, parentId); }}
          onClose={() => setMoveOpen(false)} />
      )}
    </>
  );
}

// Where to nest a Portfolio: every other Portfolio outside its own subtree,
// plus the top level when it is nested now.
function MovePicker({ targets, allowTopLevel, tree, onPick, onClose }: {
  targets: Portfolio[]; allowTopLevel: boolean; tree: PortfolioNode[];
  onPick: (parentId: string | null) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const depthOf = (id: string) => findNode(tree, id)?.depth ?? 0;
  return (
    <Popover open onOpenChange={(v) => { if (!v) onClose(); }}>
      <PopoverTrigger asChild><span className="sr-only" /></PopoverTrigger>
      <MenuShell width="wide" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t('Move into…')} autoFocus />
          <CommandList>
            <CommandEmpty>{t('No matches.')}</CommandEmpty>
            {allowTopLevel && !q && (
              <CommandItem value="__top" onSelect={() => onPick(null)}><CornerDownRight size={12} /><span className="flex-1">{t('Top level')}</span></CommandItem>
            )}
            {targets.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => (
              <CommandItem key={p.id} value={`${p.name} ${p.id}`} onSelect={() => onPick(p.id)}>
                <span style={{ width: depthOf(p.id) * 10 }} /><NavPortfolioIcon size={12} /><span className="flex-1 truncate">{p.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </MenuShell>
    </Popover>
  );
}

function RollupCell({ rollup }: { rollup: PortfolioRollup }) {
  const { t } = useI18n();
  return (
    <div className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
      {rollup.progressPct !== null && (
        <span className="flex w-24 items-center gap-1.5">
          <SegmentedProgress value={rollup.progressPct} className="flex-1" />
          <span className="w-7 text-right">{rollup.progressPct}%</span>
        </span>
      )}
      {rollup.alerts > 0 && <span className="text-destructive">{t('{n} alerts', { n: String(rollup.alerts) })}</span>}
      <span className="w-6 text-right" title={t('Initiatives')}>{rollup.initiatives}</span>
    </div>
  );
}

// ── One Portfolio, opened ───────────────────────────────────────────────
function PortfolioDetail({ node, portfolios, byPortfolio, healthById, candidates, onOpenPortfolio, onSelectStrategy, onNewInside }: {
  node: PortfolioNode;
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
  const move = async (strategyId: string, portfolioId: string | null) => {
    setPickerOpen(false);
    setError(null);
    try { await setStrategyPortfolio(strategyId, portfolioId); }
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
        <div className="mx-auto w-full max-w-3xl px-8 py-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">{portfolio.name}</h1>
          <DescriptionField key={portfolio.id} portfolioId={portfolio.id} initial={portfolio.description ?? ''} />
          <div className="mt-4 flex items-center gap-4 text-[12px] text-muted-foreground tabular-nums">
            <span>{t('{n} Initiatives', { n: String(rollup.initiatives) })}</span>
            {rollup.progressPct !== null && <span>{t('{n}% done', { n: String(rollup.progressPct) })}</span>}
            {rollup.alerts > 0 && <span className="text-destructive">{t('{n} alerts', { n: String(rollup.alerts) })}</span>}
          </div>

          {node.children.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground/60">{t('Portfolios inside')}</h2>
              {node.children.map((child) => (
                <div key={child.portfolio.id} className="flex min-w-0 items-center gap-1 rounded-md pr-2 hover:bg-muted/40">
                  <Button variant="ghost" size="md" align="start" onClick={() => onOpenPortfolio(child.portfolio.id)} className="min-w-0 flex-1 gap-2.5 text-xs font-semibold text-foreground">
                    <NavPortfolioIcon size={16} /><span className="truncate">{child.portfolio.name}</span>
                  </Button>
                  <RollupCell rollup={rollupPortfolio(child, byPortfolio, healthById)} />
                </div>
              ))}
            </section>
          )}

          <section className="mt-8">
            <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground/60">{t('Initiatives')}</h2>
            {initiatives.length === 0 && (
              <p className="px-2 py-2 text-[12px] text-muted-foreground">{t('No Initiatives in this Portfolio yet.')}</p>
            )}
            {initiatives.map((s) => (
              <InitiativeRow key={s.id} strategy={s} health={healthById.get(s.id)} onOpen={() => onSelectStrategy(s.id)} onRemove={() => void move(s.id, null)} />
            ))}
            <Popover open={pickerOpen} onOpenChange={(v) => { setPickerOpen(v); if (!v) setQuery(''); }}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" align="start" className="mt-1 text-muted-foreground"><Plus size={12} />{t('Add Initiative')}</Button>
              </PopoverTrigger>
              <MenuShell width="wide" align="start">
                <Command shouldFilter={false}>
                  <CommandInput value={query} onValueChange={setQuery} placeholder={t('Find an Initiative…')} />
                  <CommandList>
                    <CommandEmpty>{t('No matches.')}</CommandEmpty>
                    {matches.map((s) => (
                      <CommandItem key={s.id} value={`${s.name} ${s.id}`} onSelect={() => void move(s.id, portfolio.id)}>
                        <NavStrategyIcon size={12} /><span className="flex-1 truncate">{s.name}</span>
                        {s.portfolio_id && <span className="text-[11px] text-muted-foreground">{t('In another Portfolio')}</span>}
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </MenuShell>
            </Popover>
            {error && <div className="px-2 py-1 text-[11px] text-destructive">{error}</div>}
          </section>
        </div>
      </div>
    </>
  );
}

// The Portfolio's description: what this bet is. Saves on blur.
function DescriptionField({ portfolioId, initial }: { portfolioId: string; initial: string }) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const next = text.trim();
    if (next === initial.trim()) return;
    try { await updatePortfolio(portfolioId, { description: next || null }); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : t("Couldn't save")); }
  };
  return (
    <div className="mt-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void save()} rows={2}
        aria-label={t('Description')}
        placeholder={t('What this Portfolio is a bet on, and what it should add up to.')}
        className="-mx-2 w-[calc(100%+1rem)] resize-none rounded-md bg-transparent px-2 py-1 text-[13px] leading-6 text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:bg-muted/30" />
      {error && <div className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}

function InitiativeRow({ strategy, health, onOpen, onRemove }: {
  strategy: StrategyWithObjects; health: InitiativeHealth | undefined; onOpen: () => void; onRemove?: () => void;
}) {
  const { t } = useI18n();
  const alerts = health ? health.risk.overdue + health.risk.stalled + health.risk.blocked : 0;
  const moved = health?.lastActivityAt != null ? formatRelative(new Date(health.lastActivityAt).toISOString()) : null;
  return (
    <div className="group flex min-w-0 items-center gap-1 rounded-md hover:bg-muted/40">
      <Button variant="ghost" size="md" align="start" onClick={onOpen} className="min-w-0 flex-1 gap-2.5 text-xs font-semibold text-foreground">
        <NavStrategyIcon size={16} /><span className="truncate">{strategy.name}</span>
      </Button>
      <div className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
        {health?.progressPct != null && (
          <span className="flex w-24 items-center gap-1.5">
            <SegmentedProgress value={health.progressPct} className="flex-1" />
            <span className="w-7 text-right">{health.progressPct}%</span>
          </span>
        )}
        {moved && <span className="hidden text-muted-foreground/70 sm:inline">{moved}</span>}
        {alerts > 0 && <span className="text-destructive">{t('{n} alerts', { n: String(alerts) })}</span>}
        <span className="w-6 text-right" title={t('Objects')}>{strategy.objectIds.length}</span>
      </div>
      {onRemove ? (
        <Button variant="ghost" size="icon-xs" onClick={onRemove} className="mr-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
          aria-label={t('Remove from Portfolio')} title={t('Remove from Portfolio')}><X size={12} /></Button>
      ) : <span className="mr-1 w-6 shrink-0" />}
    </div>
  );
}
