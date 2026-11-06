'use client';

import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { SidebarFold } from '@/Function/shared/SidebarFold';
import { FollowSection } from '@/shell/sidebar/FollowSection';
import { MeFooter } from '@/shell/sidebar/MeFooter';
import { requestElementDetail, requestObjectPage } from '@/Function/shared/element/elementDetailRequest';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { Input } from '@/ui/input';
import { FONT } from '@/shared/designTokens';

import { DomainAgentSettings } from '@/ActivitySpace/execution/domain/DomainAgentSettings';
import { SettingsModal } from '@/Function/settings/SettingsModal';
import { useActiveSpaceScope } from '@/Function/space/data';
import { NavAutomationIcon, NavStrategyIcon } from './sidebar/NavIcons';
import { DomainNavigationRow } from './sidebar/DomainNavigationRow';
import { useWorkspaceActions } from '@/shell/WorkspaceActionsContext';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { Domain, DomainPrivacy } from '@/hooks/useSupabase';
import { ArrowLeft, Plus, Bot, Settings, Users, Search, FilePlus, FolderPlus, FileUp } from '@/ui/icons';
import { updateDomain, deleteDomain, leaveDomain } from '@/hooks/useSupabase';
import { domainHasObjectsMessage, useDomainRole, type DomainRole } from '@/hooks/domainData';
import { countDomainObjects } from '@/hooks/useObjectArchive';
import { ConfirmDialog } from '@/Function/shared/ConfirmDialog';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ObjectIcon } from '@/shell/icons';
import { DomainIcon } from '@/Function/shared/conceptIcons';
import { useDomains, reorderDomains } from '@/hooks/useSupabase';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { getActiveDomainId, setActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT } from '@/Function/space/domainsStore';
import { SpaceSwitcher } from '@/Function/space/SpaceSwitcher';

import { MODE_META, railModeOf } from '@/shell/railApps';
import { viewInScope } from '@/Function/space/spaceScope';
import type { RailMode } from '@/shell/railApps';
import { CREATE_ELEMENT_EVENT, type CreateElementDetail } from '@/shell/QuickAddElementLauncher';
import { useCalendarDay } from '@/ActivitySpace/sustainment/calendar/calendarStore';
import { SettingsSidebarPanel } from '@/Function/settings/SettingsSidebarPanel';
import { TeamSettings } from '@/Function/settings/TeamSettings';
import { SidebarRow } from '@/Function/shared/SidebarRow';
import { createDeckHere, createFolderHere, pickDeckFile } from '@/ActivitySpace/sustainment/slides/SlidesSidebar';
import { useSlidesReady } from '@/ActivitySpace/sustainment/slides/sync';
import type { NavigationState } from '@/types/navigation';
import { useI18n } from '@/Function/i18n/I18nProvider';

export type { NavigationState };

interface AppSidebarProps {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  activeView: string;
  onViewChange: (view: string) => void;
  /** Settings opens in place; Back returns to the view it came from — see
   *  page.tsx's handleOpenSettings / handleCloseSettings. */
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onRefresh?: () => void;
  width: number;
  collapsed: boolean;
  overlay: boolean;
  onCreateNew?: (type: 'domain' | 'object' | 'note') => void;
  onSearch?: () => void;
}

/** The tools under Strategy at the top of the sidebar. */
const SIDEBAR_TOOLS: RailMode[] = ['files', 'reviews', 'audit', 'team', 'tables'];

// The sidebar's top is fixed (Strategy and the tools); under it, the open
// surface's own list.

// Workspace — Strategy and Execution in one sidebar, a section each.
// Strategy is what we're trying to achieve and how we intend to win: one
// row opens the Strategies (view id 'strategy'), which nest without limit.
// Phase is reached from a Strategy or a Domain, not from here. Execution is the fighting:
// the Domain tree, whose rows carry the D/O/E surfaces below.

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_WIDTH_KEY = 'alcon:sidebarWidth';




export function AppSidebar({
  navigation,
  onNavigate,
  activeView,
  onViewChange,
  onOpenSettings,
  onCloseSettings,
  collapsed,
  overlay,
  onCreateNew,
  onSearch,
}: AppSidebarProps) {
  const { openCreate } = useWorkspaceActions();
  const { t } = useI18n();
  // An audit Space (ADR 0048) lists its people without their load.
  const spaceScope = useActiveSpaceScope();
  const { guestDomains, refetch: refetchMemberDomains } = useDomains();
  const { data: visibleDomains, refetch: refetchVisibleDomains } = useSustainmentDomains();
  const domains = useMemo(() => [...visibleDomains].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)), [visibleDomains]);
  const refetchDomains = useCallback(async () => {
    await Promise.all([refetchMemberDomains(), refetchVisibleDomains()]);
  }, [refetchMemberDomains, refetchVisibleDomains]);
  // Locally-mirrored Domain order so a drag-reorder applies instantly on drop.
  // Without this the list would snap back to the server order for the frame
  // between releasing and refetchDomains() resolving — a visible flicker.
  // Kept in sync with the hook's data whenever it changes.
  const [orderedDomains, setOrderedDomains] = useState<Domain[]>(domains);
  // Synced while rendering rather than in an effect: the mirror and the list
  // it mirrors then reach the screen in the same commit, instead of the list
  // painting once with the old order and again with the new one.
  const [syncedDomains, setSyncedDomains] = useState<Domain[]>(domains);
  if (syncedDomains !== domains) {
    setSyncedDomains(domains);
    setOrderedDomains(domains);
  }
  const [activeDomainId, setActiveDomainIdState] = useState<string>(
    () => getActiveDomainId() ?? domains[0]?.id ?? ''
  );
  // Each Domain has its own expanded state — opening one no longer collapses the others.
  const [expandedDomainIds, setExpandedDomainIds] = useState<Set<string>>(
    () => new Set(activeDomainId ? [activeDomainId] : [])
  );
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState({ top: 0, left: 0 });
  const [settingsDomain, setSettingsDomain] = useState<Domain | null>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const railMode = railModeOf(activeView);
  const [draggingDomain, setDraggingDomain] = useState<Domain | null>(null);
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return SIDEBAR_MIN_WIDTH;
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH
      ? saved
      : SIDEBAR_MIN_WIDTH;
  });
  const [resizing, setResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }, [width]);

  // The "+" at the top of the sidebar creates whatever the current mode is
  // about: a Notebook, a Table, a scheduled Element, or (in the Workspace)
  // a Strategy, Domain or Object from a small menu. Modes with nothing to
  // create show no "+".
  const calendarDay = useCalendarDay();
  // Slides makes nothing until the Space's decks are loaded; the load would replace it.
  const slidesReady = useSlidesReady();
  const createLabel = ({
    notebook: 'Add Notebook', tables: 'Add Table', slides: 'Create new',
    calendar: 'Add schedule', workspace: 'Create new',
  } as Partial<Record<RailMode, string>>)[railMode ?? 'workspace'];
  const openCreateMenu = () => {
    if (railMode === 'tables') { openCreate('table'); return; }
    if (railMode === 'notebook') { openCreate('notebook'); return; }
    if (railMode === 'calendar') {
      window.dispatchEvent(new CustomEvent<CreateElementDetail>(CREATE_ELEMENT_EVENT, { detail: { dueDate: calendarDay } }));
      return;
    }
    const rect = createBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setCreateMenuPos({ top: rect.bottom + 4, left: rect.left });
    } else {
      setCreateMenuPos({ top: window.innerHeight - 250, left: 46 });
    }
    setCreateMenuOpen(true);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setResizing(true);
    // Resize by writing the width straight to the DOM during the drag.
    // Driving it through React state re-rendered the whole sidebar tree
    // on every pointermove, which made the drag stutter — commit to state
    // just once on release (that re-sync also persists to localStorage).
    let next = startW;
    const onMove = (ev: PointerEvent) => {
      next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startW + (ev.clientX - startX)));
      const el = sidebarRef.current;
      if (el) el.style.width = `${next}px`;
    };
    const onUp = () => {
      setResizing(false);
      setWidth(next);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const activeDomain = [...domains, ...guestDomains].find((d) => d.id === activeDomainId) ?? domains[0];

  // Same reason as the order mirror above: the open dialog picks up the row
  // it is editing as it is rendered, not a frame later.
  if (settingsDomain) {
    const fresh = [...domains, ...guestDomains].find((d) => d.id === settingsDomain.id);
    if (fresh && fresh !== settingsDomain) setSettingsDomain(fresh);
  }

  // The handler is declared outside the effect so the state it sets belongs to
  // an event, which is what it is — a Domain chosen on another surface.
  const onActiveDomainChanged = useCallback((e: Event) => {
    const id = (e as CustomEvent<string>).detail;
    if (id) setActiveDomainIdState(id);
  }, []);
  useEffect(() => {
    window.addEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, onActiveDomainChanged as EventListener);
    return () => window.removeEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, onActiveDomainChanged as EventListener);
  }, [onActiveDomainChanged]);

  // First-time / signed-in-fresh users start on the Individual Domain
  // (it's sorted to the top of `domains` by useDomains).
  // First-time / signed-in-fresh users start on the Individual Domain (it is
  // sorted to the top of `domains` by useDomains). The choice is made while
  // rendering so the list never paints with nothing selected.
  if (!activeDomainId && domains[0]) {
    const first = domains[0].id;
    setActiveDomainIdState(first);
    setExpandedDomainIds((prev) => (prev.has(first) ? prev : new Set(prev).add(first)));
  }
  // The choice also has to reach the shared store, which every other surface
  // reads. It cannot ride the render above: React throws away a render that
  // sets state during it, and effects are only queued from the render that
  // commits — so an effect keyed on that transient value would never run at
  // all. Keyed on the settled Domain instead, and silent when the store
  // already agrees, which is the case whenever the user picked it themselves.
  useEffect(() => {
    if (activeDomainId && getActiveDomainId() !== activeDomainId) setActiveDomainId(activeDomainId);
  }, [activeDomainId]);

  // When the active Domain changes (e.g. via DomainsView or another tab),
  // expand it additively — never collapse the rows the user already opened.
  const [expandedFor, setExpandedFor] = useState(activeDomainId);
  if (activeDomainId && expandedFor !== activeDomainId) {
    setExpandedFor(activeDomainId);
    setExpandedDomainIds((prev) => (prev.has(activeDomainId) ? prev : new Set(prev).add(activeDomainId)));
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { type?: string } | undefined;
    if (data?.type === 'domain') {
      setDraggingDomain(orderedDomains.find((d) => d.id === event.active.id) ?? null);
      return;
    }
  };
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    // ── Domain reorder branch ──
    if ((active.data.current as { type?: string } | undefined)?.type === 'domain') {
      setDraggingDomain(null);
      if (over && active.id !== over.id) {
        const oldIndex = orderedDomains.findIndex((d) => d.id === active.id);
        const newIndex = orderedDomains.findIndex((d) => d.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          const reordered = arrayMove(orderedDomains, oldIndex, newIndex);
          setOrderedDomains(reordered); // optimistic — instant, no flicker
          try {
            await reorderDomains(reordered.map((d, i) => ({ id: d.id, order_index: i })));
            void refetchDomains();
          } catch (err) {
            console.error('Failed to reorder domains:', err);
            void refetchDomains(); // roll back to server order on failure
          }
        }
      }
      return;
    }

  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingDomain(null)}
    >
      <div
        ref={sidebarRef}
        style={{
          width,
          transform: collapsed && !overlay ? 'translateX(-100%)' : 'translateX(0)',
        }}
        className={`app-sidebar flex flex-col flex-shrink-0 overflow-hidden ${
          collapsed
            ? 'absolute inset-y-0 left-0 z-50 h-full bg-background shadow-xl'
            : 'relative'
        } ${resizing ? '' : 'transition-transform duration-200 ease-out'}`}
      >
        {/* Header — fixed; only the navigation under it scrolls. The same
            height as the main island's header (50px), so the Space name and
            the island's title sit on one line. */}
        <ButtonAppearanceProvider appearance="navigation">
        <div className={`${collapsed ? 'mt-1.5' : ''} flex h-[50px] shrink-0 items-center pl-1 pr-2`}>
          {activeView === 'settings' ? (
            <Button variant="ghost" size="sm" align="start" onClick={onCloseSettings} className="text-muted-foreground">
              <ArrowLeft size={14} />{t('Back')}
            </Button>
          ) : (
            <div className="flex w-full items-center gap-1">
            <div className="min-w-0 flex-1">
              <SpaceSwitcher onSettings={onOpenSettings} />
            </div>
            {onSearch && (
              <button
                type="button"
                onClick={onSearch}
                title={t('Discover Domains and Objects')}
                aria-label={t('Discover')}
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
              >
                <Search size={15} />
              </button>
            )}
            {createLabel && (
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground"
                ref={createBtnRef}
                type="button"
                onClick={openCreateMenu}
                title={t(createLabel)}
                aria-label={t(createLabel)}
              >
                <Plus size={16} />
              </Button>
            )}
          </div>
          )}
        </div>
        {/* Pulled up so each mode's title (Workspace, Notebook …) sits just under
            the main island's header line, level with where its content starts. */}
        <nav className="-mt-4 flex-1 overflow-y-auto pb-3 pl-1 pr-2">

          {activeView === 'settings' ? (
            <SettingsSidebarPanel />
          ) : (
          <>


          {/* ── Workspace ── Strategy first (what we aim for: the Strategies,
              a list in the main island where their nesting shows), then
              Execution (the Domains, where
              the work is done). */}
          {/* The fixed top of every sidebar: Strategy, then the tools. What
              sits under it is the open surface's own list — the Domains for
              the Workspace, the tables for Table, and so on. */}
          <div className="mt-5">
            {viewInScope('strategy', spaceScope) && (
              <SidebarRow active={activeView === 'strategy'} icon={<NavStrategyIcon size={16} />} label={t('Strategy')}
                onClick={() => { onNavigate({ strategyId: null }); onViewChange('strategy'); }} />
            )}
            {viewInScope('automation', spaceScope) && (
              <SidebarRow active={activeView === 'automation'} icon={<NavAutomationIcon size={16} />} label={t('Automation')}
                onClick={() => onViewChange('automation')} />
            )}
            {SIDEBAR_TOOLS.filter((mode) => viewInScope(MODE_META[mode].defaultView, spaceScope)).map((mode) => {
              const { label, icon: Icon, defaultView } = MODE_META[mode];
              return <SidebarRow key={mode} active={railMode === mode} icon={<Icon size={16} />} label={t(label)}
                onClick={() => { if (railMode !== mode) onViewChange(defaultView); }} />;
            })}
          </div>

          {/* Under it, always the Workspace: what you follow, then the
              Domains. Each tool's own list is in the main pane. */}
          <>
          <FollowSection activeObjectId={navigation.objectId ?? null} onOpen={(f) => {
            if (f.domainId) setActiveDomainId(f.domainId);
            if (f.kind === 'element') requestElementDetail(f.id); else requestObjectPage();
            onNavigate({ objectId: f.objectId, objectDomainId: f.domainId ?? undefined });
            onViewChange('objects');
          }} />

          <SidebarFold id="execution-domains" label={t('Your Execution')}>

          {/* All domains — the name opens the overview; the chevron expands the tree.
              Opening one does NOT collapse the others (multiple expanded at a time).
              The fixed "Individual Domain" is sorted to the top by useDomains and gets a
              fixed person icon + "Individual Domain" label so it reads as locked / non-editable. */}
          <SortableContext items={orderedDomains.map((d) => d.id)} strategy={verticalListSortingStrategy}>
              {orderedDomains.map((d) => (
                <SortableDomainRow
                  key={d.id}
                  domain={d}
                  isActive={d.id === activeDomain?.id}
                  expanded={expandedDomainIds.has(d.id)}
                  activeView={activeView}
                  onOpen={() => {
                    setActiveDomainId(d.id);
                    onNavigate({ objectId: null });
                    onViewChange('domain-overview');
                  }}
                  onToggle={() => setExpandedDomainIds(prev => {
                    const next = new Set(prev);
                    if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                    return next;
                  })}
                  onOpenSettings={() => setSettingsDomain(d)}
                  onSelectExecItem={(viewId) => {
                    if (d.id !== activeDomain?.id) setActiveDomainId(d.id);
                    onNavigate({ objectId: null });
                    onViewChange(viewId);
                  }}
                />
              ))}
            </SortableContext>

          {/* Guest Domains — ones you were invited to individually (a domain
              member but NOT a member of their ActivitySpace). Listed inline with
              the active Space's Domains; a Domain invite never exposes the rest
              of a Space. */}
          {guestDomains.map(d => <DomainNavigationRow key={d.id} name={d.name} mark={<DomainMark domain={d} size={16} />}
            active={d.id === activeDomain?.id} expanded={expandedDomainIds.has(d.id)} activeView={activeView}
            onOpen={() => { setActiveDomainId(d.id); onNavigate({ objectId: null }); onViewChange('domain-overview'); }}
            onToggle={() => setExpandedDomainIds(prev => {
              const next = new Set(prev);
              if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
              return next;
            })}
            onSelect={view => { setActiveDomainId(d.id); onNavigate({ objectId: null }); onViewChange(view); }}
            onSettings={() => setSettingsDomain(d)}
          />)}
          </SidebarFold>

          </>

          </>
          )}
        </nav></ButtonAppearanceProvider>

        {/* Who you are, at the foot; it opens the Profile. */}
        <MeFooter active={railMode === 'personal'} onOpen={() => onViewChange('profile')} />


        {!collapsed && (
          <div
            onPointerDown={startResize}
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-border/40 active:bg-border/60"
            title={t('Drag to resize')}
          />
        )}
      </div>

      {/* Create menu popup — context-aware. Note mode lists File / Folder
          (driven through useNotes here); everything else keeps
          the original Domain / Object / Note menu. */}
      {createMenuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCreateMenuOpen(false)} />
          <div
            ref={createMenuRef}
            className="fixed w-52 bg-popover border border-border rounded-lg shadow-xl z-50 py-1 overflow-hidden"
            style={{ top: createMenuPos.top, left: createMenuPos.left }}
          >
            {railMode === 'slides' ? (
              <>
                {/* Slides: a deck in the open deck's folder, a folder, or a deck from a file. */}
                <CreateMenuItem
                  icon={<FilePlus size={16} />}
                  label={t('New deck')}
                  desc={t('In the open deck’s folder, or the first one')}
                  disabled={!slidesReady}
                  onClick={() => { setCreateMenuOpen(false); createDeckHere(); onViewChange('slides'); }}
                />
                <CreateMenuItem
                  icon={<FolderPlus size={16} />}
                  label={t('New folder')}
                  desc={t('A place to keep decks together')}
                  disabled={!slidesReady}
                  onClick={() => { setCreateMenuOpen(false); createFolderHere(); }}
                />
                <CreateMenuItem
                  icon={<FileUp size={16} />}
                  label={t('Open a deck file')}
                  desc={t('A .kata.json file, as a new deck')}
                  disabled={!slidesReady}
                  onClick={() => { setCreateMenuOpen(false); pickDeckFile(); onViewChange('slides'); }}
                />
              </>
            ) : (
              <>
                {/* A Strategy at the top; the page opens its create card once
                    mounted. */}
                <CreateMenuItem
                  icon={<NavStrategyIcon size={16} />}
                  label={t('Strategy')}
                  desc={t('What this Space aims for, and how it wins')}
                  onClick={() => { setCreateMenuOpen(false); onNavigate({ strategyId: null, strategyCreate: true }); onViewChange('strategy'); }}
                />
                <div className="my-1 h-px bg-border" />
                <CreateMenuItem
                  icon={<DomainIcon size={16} />}
                  label={t('Domain')}
                  desc={t('Top-level container')}
                  onClick={() => { setCreateMenuOpen(false); onCreateNew?.('domain'); }}
                />
                <CreateMenuItem
                  icon={<ObjectIcon size={14} />}
                  label={t('Object')}
                  desc={t('Mid-level structural unit')}
                  onClick={() => { setCreateMenuOpen(false); onCreateNew?.('object'); }}
                />
              </>
            )}
          </div>
        </>
      )}

      {settingsDomain && (
        <DomainSettingsModal
          domain={settingsDomain}
          onClose={() => setSettingsDomain(null)}
          onUpdated={(domain) => {
            setSettingsDomain(domain);
            void refetchDomains();
          }}
          onDeleted={() => {
            setSettingsDomain(null);
            void refetchDomains();
          }}
        />
      )}

      <DragOverlay dropAnimation={null}>
        {draggingDomain && (
          <div className="flex items-center gap-2.5 h-8 px-2.5 bg-sidebar-accent rounded-md shadow-xl shadow-black/30 scale-[1.03] cursor-grabbing">
            <DomainMark domain={draggingDomain} size={16} />
            <span className="text-[12px] font-semibold text-foreground">{draggingDomain.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// A draggable Domain row in the Workspace's Domains section. Whole row is the drag
// handle (PointerSensor's 4px activation distance keeps a plain click as a
// click). Reordering is persisted on drag end by the parent's handleDragEnd.
function SortableDomainRow({
  domain: d,
  isActive,
  expanded,
  activeView,
  onOpen,
  onToggle,
  onOpenSettings,
  onSelectExecItem,
}: {
  domain: Domain;
  isActive: boolean;
  expanded: boolean;
  activeView: string;
  onOpen: () => void;
  onToggle: () => void;
  onOpenSettings: () => void;
  onSelectExecItem: (viewId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: d.id,
    data: { type: 'domain' },
    // Snappier-but-smooth slide as neighbours shift out of the way.
    transition: { duration: 180, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // The lifted copy lives in the DragOverlay; collapse the source to a clean
    // gap so neighbours have a clear slot to slide into.
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group/domain relative"
    >
      <DomainNavigationRow name={d.name} mark={<DomainMark domain={d} size={16} />}
        active={isActive} expanded={expanded} activeView={activeView}
        onOpen={onOpen} onToggle={onToggle} onSelect={onSelectExecItem} onSettings={onOpenSettings}
        dragProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function DomainMark({ domain, size = 15 }: { domain: Domain; size?: number }) {
  // Domain is the size reference; the other sidebar glyphs are sized up to
  // match this concept icon. An uploaded image is a complete mark of its own;
  // otherwise the Domain's icon and colour are drawn as a Strategy's or an
  // Object's are (ItemIcon), with the Domain mark when it has none.
  if (domain.icon && /^(https?:|data:|\/)/.test(domain.icon)) {
    return (
      // A Domain icon is whatever file its owner uploaded. Routing it through
      // next/image would put every one of them through the deployment's image
      // optimizer, which is a billed service and a decision that is not this
      // component's to make. Same call as the avatar in Profile settings.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={domain.icon}
        alt=""
        className="rounded object-cover flex-shrink-0"
        style={{ width: size + 2, height: size + 2 }}
      />
    );
  }
  return <ItemIcon icon={domain.icon} color={domain.color} size={size} fallback={<DomainIcon size={size} />} />;
}


function DomainSettingsModal({
  domain,
  onClose,
  onUpdated,
  onDeleted,
}: {
  domain: Domain;
  onClose: () => void;
  onUpdated: (domain: Domain) => void;
  /** The Domain is gone for this viewer — deleted, or they left it. */
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'general' | 'members' | 'agent'>('general');
  // The viewer's own seat, read once for every tab. It answers the same
  // question RLS answers on write: owner/admin may change the Domain, only
  // an owner may delete it, and anyone else is a guest who can only leave.
  const role = useDomainRole(domain.id).data ?? null;
  const canEdit = role === 'owner' || role === 'admin';

  return (
    <SettingsModal
      mark={<DomainMark domain={domain} size={24} />}
      title={domain.name}
      subtitle={t('Domain settings')}
      onClose={onClose}
      sections={[
        { id: 'general', icon: <Settings size={15} />, title: t('General'), description: t(canEdit ? 'Name and privacy' : 'Name and membership') },
        { id: 'members', icon: <Users size={15} />, title: t('Members'), description: t('Manage team members') },
        { id: 'agent', icon: <Bot size={15} />, title: t('AI agent'), description: t('Execution settings') },
      ]}
      active={tab}
      onSelect={(id) => setTab(id as 'general' | 'members' | 'agent')}
    >
      {tab === 'general' ? (
        <DomainGeneralSettings domain={domain} role={role} onUpdated={onUpdated} onDeleted={onDeleted} />
      ) : tab === 'agent' ? (
        <DomainAgentSettings key={domain.id} domain={domain} canEdit={canEdit} />
      ) : (
        <TeamSettings domainId={domain.id} />
      )}
    </SettingsModal>
  );
}

function DomainGeneralSettings({
  domain,
  role,
  onUpdated,
  onDeleted,
}: {
  domain: Domain;
  role: DomainRole | null;
  onUpdated: (domain: Domain) => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const isOwner = role === 'owner';
  const canEdit = isOwner || role === 'admin';
  const [name, setName] = useState(domain.name);
  const [identifier, setIdentifier] = useState(domain.identifier ?? '');
  const [privacy, setPrivacy] = useState<DomainPrivacy>(domain.privacy ?? 'workspace');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyed on domain.id, not the domain object itself: onUpdated hands a new
  // `domain` object back down as this same prop after every save, and
  // resyncing on object identity would discard edits still in the fields.
  const [seededFor, setSeededFor] = useState(domain.id);
  if (seededFor !== domain.id) {
    setSeededFor(domain.id);
    setName(domain.name);
    setIdentifier(domain.identifier ?? '');
    setPrivacy(domain.privacy ?? 'workspace');
  }

  const canSave =
    name.trim() !== domain.name ||
    identifier.trim() !== (domain.identifier ?? '') ||
    privacy !== (domain.privacy ?? 'workspace');

  // Delete is offered to owners only, Leave to everyone else with a seat —
  // the same gates RLS applies, so nobody sees a button the database would
  // refuse.
  const [confirming, setConfirming] = useState<'delete' | 'leave' | null>(null);
  const [busy, setBusy] = useState(false);

  // A Domain that still has Objects (archived ones included) cannot be
  // deleted; say how many before asking to confirm. The database refuses it
  // too (domains_delete_guard), with the same message from deleteDomain.
  const askDelete = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const remaining = await countDomainObjects(domain.id);
      if (remaining > 0) setError(domainHasObjectsMessage(remaining));
      else setConfirming('delete');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('The Domain could not be deleted. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const runConfirmed = async () => {
    if (busy || !confirming) return;
    setBusy(true);
    setError(null);
    try {
      if (confirming === 'delete') await deleteDomain(domain.id);
      else await leaveDomain(domain.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(confirming === 'delete' ? 'The Domain could not be deleted. Try again.' : 'Could not leave the Domain. Try again.'));
      setBusy(false);
      setConfirming(null);
    }
  };

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateDomain(domain.id, {
        name: name.trim() || domain.name,
        identifier: identifier.trim() || null,
        privacy,
      });
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not update the Domain. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="mb-5">
        <h3 className={`${FONT.lg} text-foreground`}>{t('General')}</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {t(canEdit
            ? 'Configure this Domain’s name, identifier, and access mode.'
            : 'You were invited to this Domain. Only its owner or admin can change these settings.')}
        </p>
      </div>

      <fieldset disabled={!canEdit} className="space-y-5">
        <div>
          <label htmlFor="domain-settings-name" className="mb-1.5 block text-[12px] font-semibold text-foreground">{t('Name')}</label>
          <Input id="domain-settings-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label htmlFor="domain-settings-identifier" className="mb-1.5 block text-[12px] font-semibold text-foreground">{t('Identifier')}</label>
          <Input id="domain-settings-identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={t('e.g. MKT')} />
        </div>

        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-foreground">{t('Privacy')}</div>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['workspace', 'Workspace'],
              ['private', 'Private'],
            ] as [DomainPrivacy, string][]).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                shape="tab"
                variant={privacy === value ? 'secondary' : 'ghost'}
                aria-pressed={privacy === value}
                onClick={() => setPrivacy(value)}
                className="min-w-0 w-full truncate"
              >
                {t(label)}
              </Button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>
        )}

        {canEdit && (
          <div className="flex justify-end">
            <Button variant="primary" onClick={handleSave} disabled={!canSave || saving}>
              {t(saving ? 'Saving…' : 'Save changes')}
            </Button>
          </div>
        )}
      </fieldset>

      {/* Outside the fieldset: a guest's one available action must stay enabled. */}
      {isOwner ? (
        <div className="mt-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-foreground">{t('Delete Domain')}</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {t('Permanently delete this Domain for every member. Move or delete its Objects first.')}
            </p>
          </div>
          <Button variant="danger" className="shrink-0" onClick={() => { void askDelete(); }} disabled={busy}>
            {t('Delete')}
          </Button>
        </div>
      ) : role ? (
        <div className="mt-8 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-foreground">{t('Leave Domain')}</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {t('Remove yourself. The Domain and your past work stay as they are.')}
            </p>
          </div>
          <Button variant="danger" className="shrink-0" onClick={() => setConfirming('leave')} disabled={busy}>
            {t('Leave Domain')}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming === 'delete'}
        title={t('Delete “{name}”?', { name: domain.name })}
        description={t('Its members, Phases, and templates are deleted. Tables stay but are no longer in any Domain. This can’t be undone.')}
        busy={busy}
        onConfirm={() => { void runConfirmed(); }}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'leave'}
        title={t('Leave “{name}”?', { name: domain.name })}
        description={t('You lose access to this Domain until someone invites you again.')}
        confirmLabel={t('Leave Domain')}
        busy={busy}
        onConfirm={() => { void runConfirmed(); }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}


function CreateMenuItem({ icon, label, desc, onClick, disabled = false }: {
  icon: React.ReactNode; label: string; desc: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-start gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="mt-0.5 w-4 flex items-center justify-center text-muted-foreground">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        <span className="block text-[11px] text-muted-foreground truncate">{desc}</span>
      </span>
    </button>
  );
}
