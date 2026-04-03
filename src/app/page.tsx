'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  TitleBar,
  ActivityBar,
  Sidebar,
  MainContent,
  LayoutToggle,
} from '@/components/layout';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import type { NavigationState } from '@/components/layout/Sidebar';
import { useObjects } from '@/hooks/useSupabase';
import type { AlconObjectWithChildren } from '@/types/database';
import { Document } from '@carbon/icons-react';

// Helper to count all objects recursively
function countObjects(objects: AlconObjectWithChildren[]): number {
  return objects.reduce((count, obj) => {
    return count + 1 + (obj.children ? countObjects(obj.children) : 0);
  }, 0);
}

export default function Home() {
  const [activeActivity, setActiveActivity] = useState('projects');
  const [activeActionFeature, setActiveActionFeature] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<NavigationState>({
    objectId: null,
  });

  // Sidebar resize state
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [panelVisible, setPanelVisible] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const { data: explorerData, loading, error, refetch } = useObjects();

  const handleNavigate = (nav: Partial<NavigationState>) => {
    setNavigation((prev) => ({ ...prev, ...nav }));
  };

  const handleSearch = (query: string) => {
    console.log('Search:', query);
  };

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startWidth: sidebarWidth,
    };
  }, [sidebarWidth]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeRef.current) return;

    const delta = e.clientX - resizeRef.current.startX;
    const newWidth = Math.max(180, Math.min(400, resizeRef.current.startWidth + delta));
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

  // Toggle sidebar visibility
  const toggleSidebar = () => {
    setSidebarVisible(prev => !prev);
  };

  // Toggle panel visibility
  const togglePanel = () => {
    setPanelVisible(prev => !prev);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
      {/* Title Bar - spans full width above the content area */}
      <TitleBar
        rightContent={
          <LayoutToggle
            sidebarVisible={sidebarVisible}
            panelVisible={panelVisible}
            onToggleSidebar={toggleSidebar}
            onTogglePanel={togglePanel}
          />
        }
      />

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar */}
        <ActivityBar
          activeId={activeActivity}
          onActivityChange={(id) => {
            setActiveActivity(id);
          }}
        />

        {/* Actions Feature Bar - thin secondary bar */}
        {activeActivity === 'actions' && (
          <div className="flex flex-col items-center w-12 bg-background border-r border-border/60 py-3">
            <button
              type="button"
              onClick={() => setActiveActionFeature(activeActionFeature === 'notes' ? null : 'notes')}
              className={`
                group relative w-9 h-9 flex items-center justify-center rounded-xl cursor-pointer
                transition-all duration-200
                ${activeActionFeature === 'notes'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                }
              `}
              title="Notes"
            >
              <Document size={18} />
              <span className="absolute left-full ml-3 px-2.5 py-1.5 bg-popover text-popover-foreground text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 shadow-xl pointer-events-none border border-border/60">
                Notes
              </span>
            </button>
          </div>
        )}

        {/* Sidebar with resize handle - Show for projects OR when notes feature is active in actions */}
        {/* Hidden on small/medium screens (< lg) - closes before columns */}
        {sidebarVisible && (activeActivity === 'projects' || (activeActivity === 'actions' && activeActionFeature === 'notes')) && (
          <div className="relative hidden lg:flex" style={{ width: sidebarWidth }}>
            <Sidebar
              activeActivity={activeActivity === 'projects' ? 'projects' : 'notes'}
              navigation={navigation}
              onNavigate={handleNavigate}
              explorerData={explorerData}
              onRefresh={refetch}
              width={sidebarWidth}
            />

            {/* Resize handle */}
            <div
              className={`absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize z-20 ${
                isResizing ? 'bg-primary' : 'hover:bg-primary'
              }`}
              onMouseDown={handleResizeStart}
            />
          </div>
        )}


        {/* Main Content */}
        <MainContent
          activeActivity={activeActivity}
          navigation={navigation}
          onNavigate={handleNavigate}
          explorerData={explorerData}
          onRefresh={refetch}
        />
      </div>

      {/* Status Bar */}
      <div className="h-6 bg-background border-t border-border/50 flex items-center justify-between px-4 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="font-medium">Alcon</span>
          <span className="text-border">·</span>
          <span>{explorerData.objects.length} objects</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
