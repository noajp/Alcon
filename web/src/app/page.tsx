'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { AppSidebar } from '@/shell/AppSidebar';
import { ModeRail } from '@/shell/ModeRail';
import { DiscoverModal } from '@/shell/DiscoverModal';
import { MainContent } from '@/shell/MainContent';
import { CreateView, type CreateType, type CreateResult } from '@/shell/CreateView';
import { CommandPalette } from '@/shell/CommandPalette';
import { AlconCopilotPanel } from '@/alcon/copilot';
import { WindowTabBar, type AppTab } from '@/shell/WindowTabBar';
import type { NavigationState } from '@/types/navigation';
import { useDomains, useObjects, createObject, updateObject, createDomain, createActivitySpace, useActivitySpaces, fetchAllWorkers, type Worker } from '@/hooks/useSupabase';
import { QuickAddObjectPopup } from '@/alcon/object/QuickAddObjectPopup';
import { useAuthContext } from '@/providers/AuthProvider';
import { AuthPage } from '@/auth/AuthPage';
import { getActiveDomainId, setActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT, CREATE_DOMAIN_EVENT } from '@/alcon/domain/domainsStore';
import { getActiveSpaceId, setActiveSpaceId, ACTIVE_SPACE_CHANGE_EVENT } from '@/alcon/space/activeSpaceStore';
import { OnboardingCreate } from '@/alcon/space/OnboardingCreate';

export default function Home() {
  const { isAuthenticated, loading: authLoading } = useAuthContext();

  if (!authLoading && !isAuthenticated) return <AuthPage />;
  // Assume the happy path during the (usually instant) session check and
  // paint the app shell — if it turns out logged-out, the line above flips
  // to AuthPage on the next render.
  if (authLoading) return <AppShellSkeleton />;

  return <AppContent />;
}

// First-paint app shell — a sidebar + island silhouette shown while auth /
// domains / objects resolve, instead of a bare centered spinner. Reads as
// "the app is here, filling in" rather than "still loading" (Linear's
// inlined-app-shell idea). Pure CSS, no data, so it paints immediately.
function AppShellSkeleton() {
  return (
    <div className="h-screen flex overflow-hidden bg-[var(--content-bg)]" aria-hidden>
      {/* Sidebar silhouette */}
      <div className="w-[260px] shrink-0 flex flex-col gap-4 p-3 animate-pulse">
        <div className="h-7 w-32 rounded-md bg-muted/70" />
        <div className="flex flex-col gap-1.5 mt-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-7 rounded-md bg-muted/50" style={{ width: `${70 - i * 8}%` }} />
          ))}
        </div>
        <div className="h-3 w-20 rounded bg-muted/40 mt-3" />
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-7 rounded-md bg-muted/40" style={{ width: `${85 - i * 6}%` }} />
          ))}
        </div>
      </div>
      {/* Main island silhouette */}
      <div className="flex-1 flex flex-col overflow-hidden pr-1.5 pb-1.5 pl-0">
        <div className="h-10 flex items-center gap-2 px-1.5">
          <div className="h-7 w-44 rounded-md bg-muted/60 animate-pulse" />
        </div>
        <div className="flex-1 rounded-lg border border-border/30 bg-white dark:bg-card shadow-[var(--shadow-island)] p-4">
          <div className="flex flex-col gap-2.5 animate-pulse">
            <div className="h-5 w-40 rounded bg-muted/50 mb-2" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-full bg-muted/50 shrink-0" />
                <div className="h-4 rounded bg-muted/40" style={{ width: `${55 + ((i * 7) % 35)}%` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function makeNewTab(activeView = 'my-elements'): AppTab {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    activeView,
    navigation: { objectId: null },
    lastHomeView: activeView,
  };
}

// Below this viewport width the left sidebar auto-collapses so list/board
// content keeps a usable width (matches Linear's narrow-window behavior).
const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1024;

function AppContent() {
  const { user } = useAuthContext();

  // ── ActivitySpace: the top-level org context (company / enterprise) ──
  const [activeSpaceId, setActiveSpaceIdState] = useState<string>(() => getActiveSpaceId() ?? '');
  const activeSpaceIdRef = useRef(getActiveSpaceId() ?? '');
  const { data: spaces, loading: spacesLoading, refetch: refetchSpaces } = useActivitySpaces();
  const activeSpaceExists = useMemo(
    () => !!activeSpaceId && spaces.some((s) => s.id === activeSpaceId),
    [activeSpaceId, spaces],
  );
  const effectiveActiveSpaceId = activeSpaceExists ? activeSpaceId : (spaces[0]?.id ?? '');

  const setResolvedSpaceId = (id: string) => {
    activeSpaceIdRef.current = id;
    setActiveSpaceIdState(id);
  };

  useEffect(() => {
    if (spacesLoading || !spaces.length) return;
    if (!activeSpaceExists) {
      const first = spaces[0].id;
      setResolvedSpaceId(first);
      setActiveSpaceId(first);
    }
  }, [activeSpaceExists, spaces, spacesLoading]);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id || id === activeSpaceIdRef.current) return;
      setResolvedSpaceId(id);
    };
    window.addEventListener(ACTIVE_SPACE_CHANGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ACTIVE_SPACE_CHANGE_EVENT, handler as EventListener);
  }, []);

  // ── Domain: resolved WITHIN the active ActivitySpace ──
  const [activeDomainId, setActiveDomainIdState] = useState<string>(() => getActiveDomainId() ?? '');
  const activeDomainIdRef = useRef(getActiveDomainId() ?? '');
  const { data: allDomains, guestDomains, loading: domainsLoading, error: domainsError, refetch: refetchDomains } = useDomains();
  const domains = useMemo(
    () => (effectiveActiveSpaceId
      ? allDomains.filter((d) => d.activity_space_id === effectiveActiveSpaceId)
      : allDomains),
    [allDomains, effectiveActiveSpaceId],
  );
  // Viewable = active Space's Domains + guest Domains (invited individually).
  // A guest Domain can be the active Domain without joining its Space.
  const viewableDomains = useMemo(() => [...domains, ...guestDomains], [domains, guestDomains]);
  const activeDomainExists = useMemo(
    () => !!activeDomainId && viewableDomains.some((domain) => domain.id === activeDomainId),
    [activeDomainId, viewableDomains],
  );
  const effectiveActiveDomainId = activeDomainExists
    ? activeDomainId
    : (domains[0]?.id ?? guestDomains[0]?.id ?? '');

  const setResolvedDomainId = (id: string) => {
    activeDomainIdRef.current = id;
    setActiveDomainIdState(id);
  };

  useEffect(() => {
    if (domainsLoading || !viewableDomains.length) return;
    if (!activeDomainId || !activeDomainExists) {
      const first = viewableDomains[0].id;
      setResolvedDomainId(first);
      setActiveDomainId(first);
    }
  }, [activeDomainExists, activeDomainId, viewableDomains, domainsLoading]);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id || id === activeDomainIdRef.current) return;
      setResolvedDomainId(id);
    };
    window.addEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
  }, []);

  // ── Onboarding handlers ──
  const handleCreateSpace = async (name: string) => {
    if (!user) return;
    const space = await createActivitySpace({ name, user_id: user.id });
    setResolvedSpaceId(space.id);
    setActiveSpaceId(space.id);
    await refetchSpaces();
  };
  const handleCreateFirstDomain = async (name: string) => {
    if (!user || !effectiveActiveSpaceId) return;
    const domain = await createDomain({ name, user_id: user.id, activity_space_id: effectiveActiveSpaceId });
    setResolvedDomainId(domain.id);
    setActiveDomainId(domain.id);
    await refetchDomains();
  };

  // ── Gate ──
  if (spacesLoading) return <AppShellSkeleton />;

  // New user with no ActivitySpace → create one (this is where the app used to
  // dead-end on the loading skeleton).
  if (spaces.length === 0) {
    return (
      <OnboardingCreate
        title="Create your Space"
        subtitle="The top-level space for your organization — your Domains live inside it."
        label="Name"
        placeholder="Acme Inc."
        cta="Create Space"
        onCreate={handleCreateSpace}
      />
    );
  }

  if (domainsError) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center p-6 rounded-lg bg-card border border-border max-w-sm">
          <div className="text-destructive text-sm font-medium mb-2">Connection Error</div>
          <div className="text-muted-foreground text-xs mb-4">{domainsError.message}</div>
          <button onClick={() => refetchDomains()} className="px-3 py-1.5 bg-muted hover:bg-accent text-foreground rounded text-xs transition-colors">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (domainsLoading) return <AppShellSkeleton />;

  // Space exists but the user has no Domains at all (own or guest) → create the
  // first one. Guest Domains count as "viewable", so an invited-only user lands
  // straight in the app instead of being forced to create a Domain.
  if (viewableDomains.length === 0) {
    return (
      <OnboardingCreate
        title="Create your first Domain"
        subtitle="A Domain is a top-level container — a hospital, company, or operation."
        label="Name"
        placeholder="Engineering"
        cta="Create Domain"
        onCreate={handleCreateFirstDomain}
      />
    );
  }

  if (!effectiveActiveDomainId) return <AppShellSkeleton />;

  return (
    <WorkspaceContent
      activeDomainId={effectiveActiveDomainId}
      refetchDomains={refetchDomains}
      onActiveDomainChange={setResolvedDomainId}
    />
  );
}

function WorkspaceContent({
  activeDomainId,
  refetchDomains,
  onActiveDomainChange,
}: {
  activeDomainId: string;
  refetchDomains: () => void | Promise<void>;
  onActiveDomainChange: (id: string) => void;
}) {
  // Browser-style window tabs — each tab carries its own activity + navigation
  // and renders its own MainContent in parallel so internal state (Domain
  // tab selection, expand state, scroll position, etc.) survives switches.
  const initialTabRef = useRef<AppTab | null>(null);
  if (initialTabRef.current === null) initialTabRef.current = makeNewTab();
  const [tabs, setTabs] = useState<AppTab[]>(() => [initialTabRef.current!]);
  const [activeTabId, setActiveTabId] = useState<string>(() => initialTabRef.current!.id);

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  // Per-tab updaters — operate on the tab id that's passed in, not whichever
  // tab happens to be active. Each tab's MainContent gets a stable handler
  // bound to its own id so background tabs can keep their state correctly.
  const updateTab = (id: string, partial: Partial<Omit<AppTab, 'id'>>) => {
    setTabs(prev => prev.map(t => (t.id === id ? { ...t, ...partial } : t)));
  };
  const updateTabNavigation = (id: string, partial: Partial<NavigationState>) => {
    setTabs(prev => prev.map(t => (
      t.id === id ? { ...t, navigation: { ...t.navigation, ...partial } } : t
    )));
  };

  // Active-tab convenience writers (for sidebar + command palette which target
  // the visible tab).
  const setActiveView = (view: string) => updateTab(activeTab.id, { activeView: view });
  const setActiveNavigation = (nav: Partial<NavigationState>) => updateTabNavigation(activeTab.id, nav);

  const handleCreateTab = () => {
    // New tabs land on the Domain Object list (no Object selected) —
    // users must explicitly click into an Object before they can create
    // Elements, matching the D > O > E philosophy.
    const tab = makeNewTab();
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  };
  const handleCloseTab = (tabId: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (tabId === activeTabId) {
        const fallback = next[Math.max(0, idx - 1)] ?? next[0];
        setActiveTabId(fallback.id);
      }
      return next;
    });
  };

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH,
  );
  // When collapsed, the sidebar can still be peeked as a floating overlay
  // (via the WindowTabBar reveal button) instead of pinning it back into flow.
  const [sidebarOverlay, setSidebarOverlay] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  // Alcon Copilot pane — open state shared by the WindowTabBar PanelRight
  // toggle, ⌘L, and the panel's own close button. localStorage round-trips
  // it across reloads.
  const [copilotOpen, setCopilotOpen] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem('alcon.copilot.open') === '1') setCopilotOpen(true); } catch { /* SSR */ }
  }, []);
  const handleCopilotOpenChange = (next: boolean) => {
    setCopilotOpen(next);
    try { localStorage.setItem('alcon.copilot.open', next ? '1' : '0'); } catch { /* ignore */ }
  };
  const [createType, setCreateType] = useState<CreateType | null>(null);
  const [pendingNewNote, setPendingNewNote] = useState(0);
  // Object QuickAdd popup state. Listens on the same `alcon:create-object`
  // event the sidebar / DomainView / ObjectsView already dispatch, but opens
  // the inline popup instead of the full-page CreateView form.
  const [objectPopupOpen, setObjectPopupOpen] = useState(false);
  const [objectPopupWorkers, setObjectPopupWorkers] = useState<Worker[]>([]);
  // Domains list for the Object popup's Domain pill + Type-catalog lookup.
  // WorkspaceContent doesn't already have this in scope, so subscribe here.
  const { data: domains } = useDomains();
  const previousDomainIdRef = useRef(activeDomainId);

  useEffect(() => {
    const handler = () => setCreateType('domain');
    window.addEventListener(CREATE_DOMAIN_EVENT, handler);
    return () => window.removeEventListener(CREATE_DOMAIN_EVENT, handler);
  }, []);

  useEffect(() => {
    const handler = () => setObjectPopupOpen(true);
    window.addEventListener('alcon:create-object', handler);
    return () => window.removeEventListener('alcon:create-object', handler);
  }, []);

  // Fetch the active Domain's workers when the popup opens (lazy — keeps the
  // first paint cheap and re-runs when the Domain changes).
  useEffect(() => {
    if (!objectPopupOpen) return;
    fetchAllWorkers(activeDomainId || null)
      .then(setObjectPopupWorkers)
      .catch((e) => console.error('Failed to load workers for object popup', e));
  }, [objectPopupOpen, activeDomainId]);

  const activeDomainObjectTypes = useMemo<string[]>(
    () => (activeDomainId ? domains.find((d) => d.id === activeDomainId)?.object_types ?? [] : []),
    [activeDomainId, domains],
  );

  // Narrow windows: auto-collapse the sidebar so list/board content keeps a
  // usable width; wide windows: pin it back. Only acts when the window
  // CROSSES the breakpoint, so a manual toggle still sticks within a given
  // size band. `wasNarrow` lives in a ref (not a closure local) so it can't
  // go stale across re-renders / HMR, and we sync once on mount so the
  // sidebar always matches the current width band on load.
  const wasNarrowRef = useRef<boolean | null>(null);
  useEffect(() => {
    const apply = () => {
      const narrow = window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
      if (wasNarrowRef.current === narrow) return;
      wasNarrowRef.current = narrow;
      setSidebarCollapsed(narrow);
      setSidebarOverlay(false);
    };
    apply(); // sync to the current width band immediately
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  const { data: explorerData, loading, error, refetch } = useObjects(activeDomainId);

  useEffect(() => {
    if (previousDomainIdRef.current === activeDomainId) return;
    previousDomainIdRef.current = activeDomainId;
    setTabs((prev) => prev.map((tab) => ({
      ...tab,
      navigation: { ...tab.navigation, objectId: null },
    })));
  }, [activeDomainId]);

  const handleCreateNew = (type: 'domain' | 'object' | 'note') => {
    if (type === 'note') {
      setActiveView('note');
      setPendingNewNote((n) => n + 1);
      return;
    }
    setCreateType(type);
  };

  const handleCreated = async (result: CreateResult) => {
    if (result.type === 'object') {
      setCreateType(null);
      setActiveView('projects');
      setActiveNavigation({ objectId: result.id });
      refetch();
      return;
    }
    await refetchDomains();
    onActiveDomainChange(result.id);
    setCreateType(null);
  };

  // PanelLeft button at the WindowTabBar's right edge. The right behaviour
  // depends on whether the window is wide enough to show the sidebar AND the
  // island side-by-side:
  // - Visible → hide it (island goes full-width).
  // - Hidden + WIDE window → pin it back in flow, so sidebar + island are
  //   both fully shown (no drawer, no dimmed island).
  // - Hidden + NARROW window → there isn't room for both, so reveal it as a
  //   floating drawer over a scrim (island dimmed behind, only sidebar
  //   interactive) instead of squishing the island.
  const handleSidebarToggle = () => {
    const narrow = typeof window !== 'undefined' && window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
    if (!sidebarCollapsed) {
      // Currently visible (pinned or overlay) → hide.
      setSidebarCollapsed(true);
      setSidebarOverlay(false);
    } else if (narrow) {
      setSidebarOverlay((v) => !v); // drawer reveal / dismiss
    } else {
      setSidebarCollapsed(false);   // wide → re-pin, both visible
      setSidebarOverlay(false);
    }
  };
  // Choosing anything from the sidebar dismisses the overlay, so the tap lands
  // straight on the chosen screen (a no-op while the sidebar is pinned).
  const handleSidebarViewChange = (view: string) => {
    if (view === 'home') {
      updateTab(activeTab.id, { activeView: activeTab.lastHomeView ?? 'my-elements' });
    } else if (view === 'room' || view === 'chat' || view === 'note') {
      updateTab(activeTab.id, { activeView: view });
    } else {
      updateTab(activeTab.id, { activeView: view, lastHomeView: view });
    }
    setSidebarOverlay(false);
  };
  const handleSidebarNavigate = (nav: Partial<NavigationState>) => {
    setActiveNavigation(nav);
    setSidebarOverlay(false);
  };
  const handleSidebarCreateNew = (type: 'domain' | 'object' | 'note') => {
    handleCreateNew(type);
    setSidebarOverlay(false);
  };

  if (loading) {
    return <AppShellSkeleton />;
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center p-6 rounded-lg bg-card border border-border max-w-sm">
          <div className="text-destructive text-sm font-medium mb-2">Connection Error</div>
          <div className="text-muted-foreground text-xs mb-4">{error.message}</div>
          <button onClick={() => refetch()} className="px-3 py-1.5 bg-muted hover:bg-accent text-foreground rounded text-xs transition-colors">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--content-bg)] text-foreground">
      <div className="relative flex-1 flex overflow-hidden">
        <ModeRail
          activeMode={
            activeTab.activeView === 'room' ? 'room' :
            activeTab.activeView === 'chat' ? 'chat' :
            activeTab.activeView === 'note' ? 'note' : 'home'
          }
          onChange={handleSidebarViewChange}
          onSearch={() => setDiscoverOpen(true)}
          onSettings={() => handleSidebarViewChange('settings')}
        />
        <div className="relative flex-1 flex overflow-hidden">
        <AppSidebar
          navigation={activeTab.navigation}
          onNavigate={handleSidebarNavigate}
          activeView={activeTab.activeView}
          onViewChange={handleSidebarViewChange}
          explorerData={explorerData}
          onRefresh={refetch}
          width={260}
          collapsed={sidebarCollapsed}
          overlay={sidebarCollapsed && sidebarOverlay}
          onCreateNew={handleSidebarCreateNew}
          onSearch={() => setDiscoverOpen(true)}
        />

        {sidebarCollapsed && sidebarOverlay && (
          <div
            className="absolute inset-0 z-40 bg-black/45"
            onClick={() => setSidebarOverlay(false)}
            aria-hidden="true"
          />
        )}

        <div className={`flex-1 flex flex-col overflow-hidden pr-1.5 pb-1.5 ${sidebarCollapsed ? 'pl-1.5' : 'pl-0'}`}>
        <WindowTabBar
          tabs={tabs}
          activeTabId={activeTab.id}
          onSelect={setActiveTabId}
          onClose={handleCloseTab}
          onCreate={handleCreateTab}
          explorerData={explorerData}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={handleSidebarToggle}
          copilotOpen={copilotOpen}
          onToggleCopilot={() => handleCopilotOpenChange(!copilotOpen)}
        />
        {/* MainContent + Copilot live side-by-side as two islands. When the
            Copilot is open it claims its own width on the right; otherwise
            MainContent fills the row. */}
        <div className="flex-1 flex overflow-hidden gap-1.5">
          <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-card rounded-lg border border-border/60 shadow-[var(--shadow-island)]">
            {createType ? (
              <CreateView
                type={createType}
                activeDomainId={activeDomainId}
                onCancel={() => setCreateType(null)}
                onCreated={handleCreated}
              />
            ) : (
              // Render every tab's content tree; only the active one is visible.
              // Hidden tabs stay mounted so their internal state (Domain tab,
              // expand state, scroll, edit drafts, etc.) survives a tab swap.
              tabs.map((tab) => {
                const isActive = tab.id === activeTab.id;
                return (
                  <div
                    key={tab.id}
                    className={isActive ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'}
                    aria-hidden={!isActive}
                  >
                    <MainContent
                      activeActivity={tab.activeView}
                      navigation={tab.navigation}
                      onNavigate={(nav) => updateTabNavigation(tab.id, nav)}
                      onViewChange={(view) => updateTab(tab.id, { activeView: view })}
                      explorerData={explorerData}
                      onRefresh={refetch}
                      pendingNewNote={isActive ? pendingNewNote : 0}
                      onNewNoteHandled={() => setPendingNewNote(0)}
                      activeDomainId={activeDomainId}
                    />
                  </div>
                );
              })
            )}
          </div>
          <AlconCopilotPanel open={copilotOpen} onOpenChange={handleCopilotOpenChange} />
        </div>
        </div>
        </div>
      </div>

      {/* Global ⌘K command palette */}
      <CommandPalette onNavigate={setActiveNavigation} onViewChange={setActiveView} />
      <DiscoverModal open={discoverOpen} onOpenChange={setDiscoverOpen} />

      {/* Quick-add Object popup — Linear-style, replaces the full-page Create
          Object form for the common case. */}
      <QuickAddObjectPopup
        open={objectPopupOpen}
        onClose={() => setObjectPopupOpen(false)}
        workers={objectPopupWorkers.map((w) => ({ id: w.id, name: w.name }))}
        domains={domains.map((d) => ({ id: d.id, name: d.name }))}
        types={activeDomainObjectTypes}
        defaultDomainId={activeDomainId || null}
        onSubmit={async (input) => {
          try {
            const created = await createObject({
              name: input.name,
              description: input.description ?? null,
              domain_id: input.domainId ?? null,
              domain_ids: input.domainId ? [input.domainId] : [],
            });
            // Persist fields createObject doesn't accept yet (type / lead /
            // due_date) via an immediate update — small price for one popup.
            if (input.type || input.leadWorkerId || input.dueDate) {
              try {
                await updateObject(created.id, {
                  type: input.type ?? null,
                  lead_id: input.leadWorkerId ?? null,
                  due_date: input.dueDate ?? null,
                });
              } catch (e) {
                console.warn('Object created but rich field update failed', e);
              }
            }
            // Pop the new Object into focus (existing flow used by CreateView).
            handleCreated({ type: 'object', id: created.id });
          } catch (e) {
            console.error('Failed to create Object', e);
          }
        }}
      />
    </div>
  );
}
