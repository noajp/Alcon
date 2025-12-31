'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  TitleBar,
  ActivityBar,
  Sidebar,
  MainContent,
} from '@/components/layout';
import type { NavigationState } from '@/components/layout/Sidebar';
import { useObjects } from '@/hooks/useSupabase';

export default function Home() {
  const [activeActivity, setActiveActivity] = useState('projects');
  const [navigation, setNavigation] = useState<NavigationState>({
    objectId: null,
  });

  // Sidebar resize state
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const { data: objects, loading, error, refetch } = useObjects();

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
      <div className="h-screen flex items-center justify-center bg-[var(--bg-base)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[var(--border-default)] border-t-[var(--text-primary)] rounded-full animate-spin" />
          <span className="text-xs text-[var(--text-muted)]">Loading...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg-base)]">
        <div className="text-center p-6 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] max-w-sm">
          <div className="text-[var(--status-error)] text-sm font-medium mb-2">Connection Error</div>
          <div className="text-[var(--text-muted)] text-xs mb-4">{error.message}</div>
          <button
            onClick={() => refetch()}
            className="px-3 py-1.5 bg-[var(--bg-muted)] hover:bg-[var(--bg-subtle)] text-[var(--text-primary)] rounded text-xs transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--bg-base)]">
      {/* Title Bar */}
      <TitleBar onSearch={handleSearch} />

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar - narrower */}
        <ActivityBar
          activeId={activeActivity}
          onActivityChange={setActiveActivity}
        />

        {/* Sidebar with resize handle */}
        <div className="relative flex" style={{ width: sidebarWidth }}>
          <Sidebar
            activeActivity={activeActivity}
            navigation={navigation}
            onNavigate={handleNavigate}
            objects={objects}
            onRefresh={refetch}
            width={sidebarWidth}
          />

          {/* Resize handle */}
          <div
            className={`absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize z-20 group ${
              isResizing ? 'bg-[#3b82f6]' : 'hover:bg-[#3b82f6]/50'
            }`}
            onMouseDown={handleResizeStart}
          >
            {/* Visual indicator on hover */}
            <div className={`absolute inset-y-0 -left-0.5 -right-0.5 ${
              isResizing ? 'bg-[#3b82f6]/20' : 'group-hover:bg-[#3b82f6]/10'
            }`} />
          </div>
        </div>

        {/* Main Content */}
        <MainContent
          activeActivity={activeActivity}
          navigation={navigation}
          onNavigate={handleNavigate}
          objects={objects}
          onRefresh={refetch}
        />
      </div>
    </div>
  );
}
