'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/ui/context-menu';
import { MenuShell } from '@/Function/shared/menu';
import { EmptyState } from '@/Function/shared/EmptyState';
import { QuickCreatePopup } from '@/Function/shared/QuickCreatePopup';
import { appDialog } from '@/Function/shared/appDialogStore';
import { RenameInput } from '@/ActivitySpace/sustainment/notebook/RenameInput';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useStrategies, useDomains, useObjects } from '@/hooks/useSupabase';
import { NavPortfolioIcon, NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import type { Portfolio, StrategyWithObjects } from '@/types/database';
import { createPortfolio, deletePortfolio, PortfolioMoveRefused, setStrategyPortfolio, updatePortfolio, usePortfolios } from './data';
import { groupByPortfolio, initiativesInSpace } from './portfolioGroups';

// Strategy > Portfolio — the Space's Initiatives bundled into named
// Portfolios. Each Portfolio row folds open on its Initiatives; the picker
// at its foot moves a root Initiative in (an Initiative sits in at most one
// Portfolio). Root Initiatives outside every Portfolio are listed last.
export function PortfolioView({ createRequested, onCreateHandled, onSelectStrategy }: {
  createRequested: boolean;
  onCreateHandled: () => void;
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
  const [localNewOpen, setLocalNewOpen] = useState(false);
  const newOpen = localNewOpen || createRequested;
  const closeNew = () => { setLocalNewOpen(false); if (createRequested) onCreateHandled(); };
  const { groups, unassigned } = useMemo(() => groupByPortfolio(portfolios, strategies), [portfolios, strategies]);
  const loading = portfoliosLoading || strategiesLoading;

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavPortfolioIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">{t('Portfolio')}</span>
        <div className="flex-1" />
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" type="button"
          onClick={() => setLocalNewOpen(true)} title={t('New Portfolio')} aria-label={t('New Portfolio')}>
          <Plus size={14} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? null : portfolios.length === 0 ? (
          <EmptyState icon={NavPortfolioIcon} title={t('Add Portfolios')}
            description={t('A Portfolio bundles Initiatives that serve one part of the Vision, so the Strategy reads as a few bets instead of a long list.')}
            hint={t('An Initiative belongs to at most one Portfolio.')}
            cta={t('Create Portfolio')} onCta={() => setLocalNewOpen(true)} />
        ) : (
          <div className="px-4 py-3">
            {groups.map(({ portfolio, initiatives }) => (
              <PortfolioRow key={portfolio.id} portfolio={portfolio} initiatives={initiatives}
                candidates={strategies.filter((s) => s.parentIds.length === 0 && s.portfolio_id !== portfolio.id)}
                onSelectStrategy={onSelectStrategy} />
            ))}
            {unassigned.length > 0 && (
              <div className="mt-4">
                <div className="px-2 h-6 flex items-center text-[11px] font-semibold tracking-wide text-muted-foreground/60">{t('Not in a Portfolio')}</div>
                {unassigned.map((s) => (
                  <InitiativeRow key={s.id} strategy={s} onOpen={() => onSelectStrategy(s.id)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {newOpen && spaceId && (
        <QuickCreatePopup
          open
          icon={<NavPortfolioIcon size={12} />}
          contextLabel={t('New Portfolio')}
          ariaLabel={t('New Portfolio')}
          namePlaceholder={t('Portfolio name…')}
          onClose={closeNew}
          onSubmit={async ({ name, description }) => {
            await createPortfolio({ activity_space_id: spaceId, name, description: description || null, order_index: portfolios.length });
            await refetch();
            closeNew();
          }}
        />
      )}
    </div>
  );
}

function PortfolioRow({ portfolio, initiatives, candidates, onSelectStrategy }: {
  portfolio: Portfolio;
  initiatives: StrategyWithObjects[];
  candidates: StrategyWithObjects[];
  onSelectStrategy: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
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
  const remove = async () => {
    if (!await appDialog.confirm(t('Delete the Portfolio "{name}"? Its Initiatives stay, outside any Portfolio.', { name: portfolio.name }))) return;
    try { await deletePortfolio(portfolio.id); }
    catch (e) { setError(e instanceof Error ? e.message : t("Couldn't save")); }
  };

  return (
    <div className="mb-2 rounded-lg border border-border/60">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex min-w-0 items-center gap-1 pl-1 pr-2 h-10">
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen((v) => !v)}
              aria-label={`${t(open ? 'Collapse' : 'Expand')} ${portfolio.name}`} aria-expanded={open}>
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </Button>
            <NavPortfolioIcon size={14} />
            {renaming ? (
              <RenameInput initial={portfolio.name} className="text-[13px] font-semibold"
                onCommit={async (v) => { setRenaming(false); if (v.trim() && v.trim() !== portfolio.name) await updatePortfolio(portfolio.id, { name: v.trim() }); }}
                onCancel={() => setRenaming(false)} />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{portfolio.name}</span>
            )}
            {portfolio.description && !renaming && (
              <span className="hidden min-w-0 truncate text-[12px] text-muted-foreground sm:block">{portfolio.description}</span>
            )}
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{initiatives.length}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setRenaming(true)}><Pencil size={14} />{t('Rename')}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void remove()}><Trash2 size={14} />{t('Delete')}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open && (
        <div className="border-t border-border/40 px-2 pb-2 pt-1">
          {initiatives.map((s) => (
            <InitiativeRow key={s.id} strategy={s} onOpen={() => onSelectStrategy(s.id)} onRemove={() => void move(s.id, null)} />
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
        </div>
      )}
    </div>
  );
}

function InitiativeRow({ strategy, onOpen, onRemove }: { strategy: StrategyWithObjects; onOpen: () => void; onRemove?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="group flex min-w-0 items-center gap-1 rounded-md hover:bg-muted/40">
      <Button variant="ghost" size="md" align="start" onClick={onOpen} className="min-w-0 flex-1 gap-2.5 text-xs font-semibold text-foreground">
        <NavStrategyIcon size={16} /><span className="truncate">{strategy.name}</span>
        <span className="ml-auto text-[11px] font-normal tabular-nums text-muted-foreground">{strategy.objectIds.length}</span>
      </Button>
      {onRemove && (
        <Button variant="ghost" size="icon-xs" onClick={onRemove} className="mr-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
          aria-label={t('Remove from Portfolio')} title={t('Remove from Portfolio')}><X size={12} /></Button>
      )}
    </div>
  );
}
