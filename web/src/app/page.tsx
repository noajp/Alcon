'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { AppSidebar } from '@/shell/AppSidebar';
import { MainContent } from '@/shell/MainContent';
import { CreateView, type CreateType, type CreateResult } from '@/shell/CreateView';
import { CommandPalette } from '@/shell/CommandPalette';
import { WindowTabBar, type AppTab } from '@/shell/WindowTabBar';
import type { NavigationState } from '@/types/navigation';
import { useDomains, useObjects } from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { AuthPage } from '@/auth/AuthPage';
import { getActiveDomainId, setActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT, CREATE_DOMAIN_EVENT } from '@/alcon/domain/domainsStore';

export default function Home() {
  const { isAuthenticated, loading: authLoading } = useAuthContext();

  if (!authLoading && !isAuthenticated) return <AuthPage />;
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return <AppContent />;
}

function makeNewTab(activeView = 'projects'): AppTab {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    activeView,
    navigation: { objectId: null },
  };
}

// Below this viewport width the left sidebar auto-collapses so list/board
// content keeps a usable width (matches Linear's narrow-window behavior).
const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1024;

function AppContent() {
  const [activeDomainId, setActiveDomainIdState] = useState<string>(
    () => getActiveDomainId() ?? ''
  );
  const activeDomainIdRef = useRef(getActiveDomainId() ?? '');
  const { data: domains, loading: domainsLoading, error: domainsError, refetch: refetchDomains } = useDomains();
  const activeDomainExists = useMemo(
    () => !!activeDomainId && domains.some((domain) => domain.id === activeDomainId),
    [activeDomainId, domains],
  );
  const effectiveActiveDomainId = activeDomainExists
    ? activeDomainId
    : (!activeDomainId ? domains[0]?.id ?? '' : '');

  const setResolvedDomainId = (id: string) => {
    activeDomainIdRef.current = id;
    setActiveDomainIdState(id);
  };

  useEffect(() => {
    if (domainsLoading || !domains.length) return;
    if (!activeDomainId) {
      const first = domains[0].id;
      setResolvedDomainId(first);
      setActiveDomainId(first);
      return;
    }
    if (!activeDomainExists) {
      const first = domains[0].id;
      setResolvedDomainId(first);
      setActiveDomainId(first);
    }
  }, [activeDomainExists, activeDomainId, domains, domainsLoading]);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id || id === activeDomainIdRef.current) return;
      setResolvedDomainId(id);
    };
    window.addEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
  }, []);

  if (domainsLoading || !effectiveActiveDomainId) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-border border-t-muted-foreground rounded-full animate-spin" />
          <span className="text-xs text-muted-foreground">Loading...</span>
        </div>
      </div>
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
  if (initialTabRef.current === null) initialTabRef.current = makeNewTab('projects');
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
    const tab = makeNewTab('projects');
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
  const [createType, setCreateType] = useState<CreateType | null>(null);
  const [pendingNewNote, setPendingNewNote] = useState(0);
  const previousDomainIdRef = useRef(activeDomainId);

  useEffect(() => {
    const handler = () => setCreateType('domain');
    window.addEventListener(CREATE_DOMAIN_EVENT, handler);
    return () => window.removeEventListener(CREATE_DOMAIN_EVENT, handler);
  }, []);

  useEffect(() => {
    const handler = () => setCreateType('object');
    window.addEventListener('alcon:create-object', handler);
    return () => window.removeEventListener('alcon:create-object', handler);
  }, []);

  // Narrow windows: auto-collapse the sidebar so list/board content keeps a
  // usable width. Only fires on crossing the breakpoint, so a manual toggle
  // still sticks within a given size band.
  useEffect(() => {
    let wasNarrow = window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
    const onResize = () => {
      const narrow = window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
      if (narrow !== wasNarrow) {
        wasNarrow = narrow;
        setSidebarCollapsed(narrow);
        setSidebarOverlay(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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

  // The collapsed sidebar is re-opened as a floating overlay (the WindowTabBar
  // reveal button). The sidebar only collapses via the narrow-window effect.
  const handleSidebarReveal = () => setSidebarOverlay(true);
  // Choosing anything from the sidebar dismisses the overlay, so the tap lands
  // straight on the chosen screen (a no-op while the sidebar is pinned).
  const handleSidebarViewChange = (view: string) => {
    setActiveView(view);
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
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-border border-t-muted-foreground rounded-full animate-spin" />
          <span className="text-xs text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
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
        />

        {sidebarCollapsed && sidebarOverlay && (
          <div
            className="absolute inset-0 z-40 bg-black/45"
            onClick={() => setSidebarOverlay(false)}
            aria-hidden="true"
          />
        )}

        <div className="flex-1 flex flex-col overflow-hidden pr-2 pb-2.5 pl-0">
        <WindowTabBar
          tabs={tabs}
          activeTabId={activeTab.id}
          onSelect={setActiveTabId}
          onClose={handleCloseTab}
          onCreate={handleCreateTab}
          explorerData={explorerData}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={handleSidebarReveal}
        />
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-card rounded-lg border border-border/30 shadow-[var(--shadow-island)]">
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
        </div>
      </div>

      {/* Global ⌘K command palette */}
      <CommandPalette onNavigate={setActiveNavigation} onViewChange={setActiveView} />
    </div>
  );
}
