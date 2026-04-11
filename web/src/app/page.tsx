'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { BreadcrumbBar } from '@/components/layout/BreadcrumbBar';
import { MainContent } from '@/components/layout/MainContent';
import type { NavigationState } from '@/components/layout/AppSidebar';
import { useObjects } from '@/hooks/useSupabase';
import type { AlconObjectWithChildren } from '@/types/database';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { AuthPage } from '@/components/auth/AuthPage';

// Helper to count all objects recursively
function countObjects(objects: AlconObjectWithChildren[]): number {
  return objects.reduce((count, obj) => {
    return count + 1 + (obj.children ? countObjects(obj.children) : 0);
  }, 0);
}

export default function Home() {
  const { isAuthenticated, loading: authLoading } = useAuthContext();

  // Show auth page if not logged in
  if (!authLoading && !isAuthenticated) {
    return <AuthPage />;
  }

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return <AppContent />;
}

function AppContent() {
  const [activeView, setActiveView] = useState('projects');
  const [navigation, setNavigation] = useState<NavigationState>({
    objectId: null,
  });

  // Sidebar state
  // Total width = icon bar (48px) + panel width
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

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

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
  }, [sidebarWidth]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeRef.current) return;
    const delta = e.clientX - resizeRef.current.startX;
    const newWidth = Math.max(200, Math.min(400, resizeRef.current.startWidth + delta));
    setSidebarWidth(newWidth);
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    resizeRef.current = null;
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

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
          <button
            onClick={() => refetch()}
            className="px-3 py-1.5 bg-muted hover:bg-accent text-foreground rounded text-xs transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const toggleSidebar = () => setSidebarCollapsed(prev => !prev);
  const togglePanel = () => setPanelVisible(prev => !prev);

  return (
    <div className="h-screen flex overflow-hidden bg-background text-foreground">
      {/* Sidebar: icon bar always visible, panel hides on small screens */}
      <div className="relative flex flex-shrink-0">
        <AppSidebar
          navigation={navigation}
          onNavigate={handleNavigate}
          activeView={activeView}
          onViewChange={setActiveView}
          explorerData={explorerData}
          onRefresh={refetch}
          width={sidebarWidth}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />

        {/* Resize handle */}
        {!sidebarCollapsed && (activeView === 'projects' || activeView === 'actions') && (
          <div
            className={`absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize z-20 ${
              isResizing ? 'bg-primary' : 'hover:bg-primary'
            }`}
            onMouseDown={handleResizeStart}
          />
        )}
      </div>

      {/* Right side: Breadcrumb + Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Breadcrumb Bar */}
        <BreadcrumbBar
          activeView={activeView}
          navigation={navigation}
          onNavigate={handleNavigate}
          explorerData={explorerData}
          sidebarVisible={!sidebarCollapsed}
          panelVisible={panelVisible}
          onToggleSidebar={toggleSidebar}
          onTogglePanel={togglePanel}
        />

        {/* Main Content */}
        <MainContent
          activeActivity={activeView}
          navigation={navigation}
          onNavigate={handleNavigate}
          explorerData={explorerData}
          onRefresh={refetch}
        />
      </div>
    </div>
  );
}
