'use client';

import { useState, useEffect } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { MainContent } from '@/components/layout/MainContent';
import type { NavigationState } from '@/components/layout/AppSidebar';
import { useObjects } from '@/hooks/useSupabase';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { AuthPage } from '@/components/auth/AuthPage';

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

function AppContent() {
  const [activeView, setActiveView] = useState('projects');
  const [navigation, setNavigation] = useState<NavigationState>({ objectId: null });
  const [panelVisible, setPanelVisible] = useState(false);

  const { data: explorerData, loading, error, refetch } = useObjects();

  // Auto-select first object on initial load
  useEffect(() => {
    if (explorerData?.objects?.length > 0 && !navigation.objectId) {
      setNavigation({ objectId: explorerData.objects[0].id });
    }
  }, [explorerData, navigation.objectId]);

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
      {/* Body: sidebar + content (Apple-style island layout, equal padding on all sides) */}
      <div className="flex-1 flex overflow-hidden gap-1 p-1">
        {/* Icon Bar */}
        <AppSidebar
          navigation={navigation}
          onNavigate={handleNavigate}
          activeView={activeView}
          onViewChange={setActiveView}
          explorerData={explorerData}
          onRefresh={refetch}
          width={260}
          collapsed={false}
          onToggleCollapse={() => {}}
        />

        {/* Right side: Main Content as a floating island. rounded-2xl (16px) = 2x inner card radius (8px) */}
        <div className="flex-1 flex flex-col overflow-hidden bg-card rounded-2xl border border-border/60 shadow-[var(--shadow-island)]">
          <MainContent
            activeActivity={activeView}
            navigation={navigation}
            onNavigate={handleNavigate}
            onViewChange={setActiveView}
            explorerData={explorerData}
            onRefresh={refetch}
          />
        </div>
      </div>
    </div>
  );
}
