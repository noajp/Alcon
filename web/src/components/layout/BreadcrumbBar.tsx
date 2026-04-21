'use client';

import { useState, useEffect } from 'react';
import type { AlconObjectWithChildren, ExplorerData } from '@/hooks/useSupabase';
import type { NavigationState } from './AppSidebar';
import { ChevronRight, Search, Home, FileText } from 'lucide-react';
import { ObjectIcon } from '@/components/icons';
import { LayoutToggle } from './LayoutToggle';

interface BreadcrumbBarProps {
  activeView: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  explorerData: ExplorerData;
  sidebarVisible: boolean;
  panelVisible: boolean;
  onToggleSidebar: () => void;
  onTogglePanel: () => void;
}

// Build path from root to target object
function buildObjectPath(objects: AlconObjectWithChildren[], targetId: string): { id: string; name: string }[] {
  const findPath = (objs: AlconObjectWithChildren[], path: { id: string; name: string }[]): { id: string; name: string }[] | null => {
    for (const obj of objs) {
      const currentPath = [...path, { id: obj.id, name: obj.name }];
      if (obj.id === targetId) return currentPath;
      if (obj.children) {
        const found = findPath(obj.children, currentPath);
        if (found) return found;
      }
    }
    return null;
  };
  return findPath(objects, []) || [];
}

// View labels
// My Tasks icon (matches sidebar)
const MyTasksIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4"/>
    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
  </svg>
);

const VIEW_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  home: { label: 'Home', icon: <Home size={14} /> },
  mytasks: { label: 'My Tasks', icon: <MyTasksIcon /> },
  actions: { label: 'Actions', icon: <FileText size={14} /> },
  projects: { label: 'Objects', icon: <ObjectIcon size={14} /> },
  settings: { label: 'Settings', icon: null },
  account: { label: 'Account', icon: null },
};

export function BreadcrumbBar({
  activeView,
  navigation,
  onNavigate,
  explorerData,
  sidebarVisible,
  panelVisible,
  onToggleSidebar,
  onTogglePanel,
}: BreadcrumbBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Build breadcrumb segments
  const segments: { id: string | null; label: string; icon?: React.ReactNode }[] = [];

  if (activeView === 'projects' && navigation.objectId) {
    const objectPath = buildObjectPath(explorerData.objects, navigation.objectId);
    objectPath.forEach(seg => {
      segments.push({ id: seg.id, label: seg.name, icon: <ObjectIcon size={12} /> });
    });
  } else {
    const viewInfo = VIEW_LABELS[activeView];
    if (viewInfo) {
      segments.push({ id: null, label: viewInfo.label, icon: viewInfo.icon });
    }
  }

  return (
    <>
      <div className="h-10 flex items-center justify-between px-4 bg-[var(--content-bg)] border-b border-border">
        {/* Left: Breadcrumb path */}
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {segments.map((segment, index) => (
            <div key={index} className="flex items-center gap-1 min-w-0">
              {index > 0 && <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />}
              <button
                onClick={() => {
                  if (segment.id) {
                    onNavigate({ objectId: segment.id });
                  }
                }}
                className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[13px] transition-colors min-w-0 ${
                  index === segments.length - 1
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 cursor-pointer'
                }`}
              >
                {segment.icon && <span className="flex-shrink-0">{segment.icon}</span>}
                <span className="truncate">{segment.label}</span>
              </button>
            </div>
          ))}
        </div>

        {/* Right: Search + Layout controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors"
            title="Search (⌘K)"
          >
            <Search size={14} />
            <kbd className="hidden sm:inline px-1 py-0.5 text-[10px] font-medium text-muted-foreground bg-muted rounded border border-border">⌘K</kbd>
          </button>
          <div className="w-px h-5 bg-border mx-1" />
          <LayoutToggle
            sidebarVisible={sidebarVisible}
            panelVisible={panelVisible}
            onToggleSidebar={onToggleSidebar}
            onTogglePanel={onTogglePanel}
          />
        </div>
      </div>

      {/* Search Modal */}
      {searchOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-[100]" onClick={() => setSearchOpen(false)}>
          <div className="w-full max-w-lg bg-popover rounded-lg border border-border shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search size={16} className="text-muted-foreground" />
              <input
                type="text"
                placeholder="Search..."
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-foreground text-sm placeholder:text-muted-foreground focus:outline-none"
              />
              <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground bg-muted rounded border border-border">esc</kbd>
            </div>
            <div className="p-8 text-center text-muted-foreground text-sm">Type to search...</div>
          </div>
        </div>
      )}
    </>
  );
}
