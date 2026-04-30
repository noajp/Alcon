'use client';

import { useRef, useState, useEffect } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { MainContent } from '@/components/layout/MainContent';
import { CreateView, type CreateType } from '@/components/create/CreateView';
import type { NavigationState } from '@/types/navigation';
import { useObjects, createDocument } from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { AuthPage } from '@/auth/AuthPage';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [createType, setCreateType] = useState<CreateType | null>(null);

  const { data: explorerData, loading, error, refetch } = useObjects();
  const creatingNoteRef = useRef(false);

  const handleCreateNew = async (type: 'system' | 'object' | 'note') => {
    if (type === 'note') {
      if (creatingNoteRef.current) return;
      creatingNoteRef.current = true;
      try {
        const doc = await createDocument({ parent_id: null, type: 'page', title: '' });
        setActiveView('documents');
        setNavigation((prev) => ({ ...prev, documentId: doc.id }));
      } catch (err) {
        console.error('Failed to create note:', err);
      } finally {
        creatingNoteRef.current = false;
      }
      return;
    }
    setCreateType(type);
  };

  const handleCreated = (objectId: string) => {
    setCreateType(null);
    setActiveView('projects');
    setNavigation({ objectId });
    refetch();
  };

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
      {/* Body: sidebar flush to left + content island */}
      <div className="flex-1 flex overflow-hidden">
        {/* Icon Bar — flush to left/top/bottom edge */}
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

        {/* Right side: Main Content as a floating island. rounded-2xl (16px) = 2x inner card radius (8px) */}
        <div className="flex-1 flex flex-col overflow-hidden py-2.5 pr-2 pl-0.5">
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-card rounded-2xl border border-border/60 shadow-[var(--shadow-island)]">
          {createType ? (
            <CreateView
              type={createType}
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
            />
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
