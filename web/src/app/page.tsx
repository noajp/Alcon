'use client';

import { useState, useEffect, useRef } from 'react';
import { AppSidebar } from '@/shell/AppSidebar';
import { MainContent } from '@/shell/MainContent';
import { CreateView, type CreateType, type CreateResult } from '@/shell/CreateView';
import { CommandPalette } from '@/shell/CommandPalette';
import { WindowTabBar, type AppTab } from '@/shell/WindowTabBar';
import type { NavigationState } from '@/types/navigation';
import { useObjects } from '@/hooks/useSupabase';
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

function AppContent() {
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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [createType, setCreateType] = useState<CreateType | null>(null);
  const [pendingNewNote, setPendingNewNote] = useState(0);
  const [activeDomainId, setActiveDomainIdState] = useState<string>(
    () => getActiveDomainId() ?? ''
  );
  const [isSwitching, setIsSwitching] = useState(false);
  const isSwitchingRef = useRef(false);
  const activeDomainIdRef = useRef(getActiveDomainId() ?? '');

  useEffect(() => { activeDomainIdRef.current = activeDomainId; }, [activeDomainId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id) return;
      if (id === activeDomainIdRef.current) return;
      isSwitchingRef.current = true;
      setIsSwitching(true);
      setActiveDomainIdState(id);
    };
    window.addEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
  }, []);

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

  const { data: explorerData, loading, error, refetch } = useObjects(activeDomainId || null);

  const handleCreateNew = (type: 'domain' | 'object' | 'note') => {
    if (type === 'note') {
      setActiveView('note');
      setPendingNewNote((n) => n + 1);
      return;
    }
    setCreateType(type);
  };

  const handleCreated = (result: CreateResult) => {
    setCreateType(null);
    if (result.type === 'object') {
      setActiveView('projects');
      setActiveNavigation({ objectId: result.id });
      refetch();
    }
  };

  // After a Domain switch, clear every tab's objectId so users land on the
  // new Domain's Object list instead of being thrown into a stale selection.
  // No initial auto-select — tabs default to the Domain Object list (no
  // Object selected) so users explicitly drill into an Object before they
  // can create Elements (D > O > E).
  useEffect(() => {
    if (isSwitchingRef.current) {
      isSwitchingRef.current = false;
      setIsSwitching(false);
      setTabs(prev => prev.map(t => ({ ...t, navigation: { ...t.navigation, objectId: null } })));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorerData]);

  useEffect(() => {
    if (error && isSwitchingRef.current) {
      isSwitchingRef.current = false;
      setIsSwitching(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

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
      <div className="flex-1 flex overflow-hidden">
        <AppSidebar
          navigation={activeTab.navigation}
          onNavigate={setActiveNavigation}
          activeView={activeTab.activeView}
          onViewChange={setActiveView}
          explorerData={explorerData}
          onRefresh={refetch}
          width={260}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          onCreateNew={handleCreateNew}
        />

        <div className="flex-1 flex flex-col overflow-hidden pt-2 pr-2 pb-2.5 pl-0">
        <WindowTabBar
          tabs={tabs}
          activeTabId={activeTab.id}
          onSelect={setActiveTabId}
          onClose={handleCloseTab}
          onCreate={handleCreateTab}
          explorerData={explorerData}
        />
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-card rounded-lg border border-border/30 shadow-[var(--shadow-island)]">
          {isSwitching ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-border border-t-muted-foreground rounded-full animate-spin" />
                <span className="text-xs text-muted-foreground">Loading...</span>
              </div>
            </div>
          ) : createType ? (
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
