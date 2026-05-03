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
  const initialTabRef = useRef<AppTab | null>(null);
  if (initialTabRef.current === null) initialTabRef.current = makeNewTab('projects');
  const [tabs, setTabs] = useState<AppTab[]>(() => [initialTabRef.current!]);
  const [activeTabId, setActiveTabId] = useState<string>(() => initialTabRef.current!.id);

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];
  const activeView = activeTab.activeView;
  const navigation = activeTab.navigation;

  const setActiveView = (view: string) => {
    setTabs(prev => prev.map(t => (t.id === activeTab.id ? { ...t, activeView: view } : t)));
  };
  const setNavigation = (next: NavigationState | ((prev: NavigationState) => NavigationState)) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== activeTab.id) return t;
      const value = typeof next === 'function' ? (next as (p: NavigationState) => NavigationState)(t.navigation) : next;
      return { ...t, navigation: value };
    }));
  };

  const handleCreateTab = () => {
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
  // Refs let event handlers / effects read latest values without stale closures
  const isSwitchingRef = useRef(false);
  const navigationRef = useRef<NavigationState>({ objectId: null });
  const activeDomainIdRef = useRef(getActiveDomainId() ?? '');

  // Keep activeDomainIdRef in sync
  useEffect(() => { activeDomainIdRef.current = activeDomainId; }, [activeDomainId]);

  // Sync active domain from localStorage and listen for switches
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

  // Listen for create-domain shortcut from DomainsView buttons
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
      setNavigation({ objectId: result.id });
      refetch();
    }
  };

  // Keep navigationRef in sync so the effect below reads the latest value
  useEffect(() => { navigationRef.current = navigation; }, [navigation]);

  // Auto-select first object on initial load; after system switch reset nav + pick first object
  useEffect(() => {
    if (isSwitchingRef.current) {
      // New data arrived for the switched system — finish transition atomically
      isSwitchingRef.current = false;
      setIsSwitching(false);
      setNavigation({ objectId: explorerData?.objects?.[0]?.id ?? null });
    } else if (explorerData?.objects?.length > 0 && !navigationRef.current.objectId) {
      setNavigation({ objectId: explorerData.objects[0].id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorerData]);

  // Fallback: if fetch errored while switching, clear the spinner so the error UI can show
  useEffect(() => {
    if (error && isSwitchingRef.current) {
      isSwitchingRef.current = false;
      setIsSwitching(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const handleNavigate = (nav: Partial<NavigationState>) => {
    setNavigation((prev) => ({ ...prev, ...nav }));
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
      <div className="flex-1 flex overflow-hidden">
        <AppSidebar
          navigation={navigation}
          onNavigate={handleNavigate}
          activeView={activeView}
          onViewChange={setActiveView}
          explorerData={explorerData}
          onRefresh={refetch}
          width={260}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          onCreateNew={handleCreateNew}
        />

        <div className="flex-1 flex flex-col overflow-hidden py-2.5 pr-2 pl-0">
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-card rounded-lg border border-border/30 shadow-[var(--shadow-island)]">
          <WindowTabBar
            tabs={tabs}
            activeTabId={activeTab.id}
            onSelect={setActiveTabId}
            onClose={handleCloseTab}
            onCreate={handleCreateTab}
            explorerData={explorerData}
          />
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
            <MainContent
              activeActivity={activeView}
              navigation={navigation}
              onNavigate={handleNavigate}
              onViewChange={setActiveView}
              explorerData={explorerData}
              onRefresh={refetch}
              pendingNewNote={pendingNewNote}
              onNewNoteHandled={() => setPendingNewNote(0)}
              activeDomainId={activeDomainId}
            />
          )}
        </div>
        </div>
      </div>

      {/* Global ⌘K command palette */}
      <CommandPalette onNavigate={handleNavigate} onViewChange={setActiveView} />
    </div>
  );
}
