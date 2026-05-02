'use client';

import { cn } from '@/lib/utils';

interface LayoutToggleProps {
  sidebarVisible: boolean;
  panelVisible: boolean;
  onToggleSidebar: () => void;
  onTogglePanel: () => void;
}

export function LayoutToggle({
  sidebarVisible,
  panelVisible,
  onToggleSidebar,
  onTogglePanel,
}: LayoutToggleProps) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded p-0.5">
      {/* Left sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className={cn(
          'w-6 h-5 rounded-sm flex items-center justify-center transition-colors',
          sidebarVisible ? 'bg-background' : 'hover:bg-background/50'
        )}
        title="Toggle Sidebar"
      >
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="text-muted-foreground">
          <rect x="0.5" y="0.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
          <rect x="0.5" y="0.5" width="4" height="9" rx="1" fill={sidebarVisible ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      {/* Bottom panel toggle */}
      <button
        onClick={onTogglePanel}
        className={cn(
          'w-6 h-5 rounded-sm flex items-center justify-center transition-colors',
          panelVisible ? 'bg-background' : 'hover:bg-background/50'
        )}
        title="Toggle Panel"
      >
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="text-muted-foreground">
          <rect x="0.5" y="0.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
          <rect x="0.5" y="6.5" width="13" height="3" fill={panelVisible ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      {/* Right panel toggle (placeholder for future) */}
      <button
        className="w-6 h-5 rounded-sm flex items-center justify-center transition-colors hover:bg-background/50 opacity-50"
        title="Toggle Right Panel (Coming soon)"
        disabled
      >
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="text-muted-foreground">
          <rect x="0.5" y="0.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
          <rect x="9.5" y="0.5" width="4" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      {/* Full screen layout */}
      <button
        onClick={() => {
          if (sidebarVisible) onToggleSidebar();
          if (panelVisible) onTogglePanel();
        }}
        className={cn(
          'w-6 h-5 rounded-sm flex items-center justify-center transition-colors',
          !sidebarVisible && !panelVisible ? 'bg-background' : 'hover:bg-background/50'
        )}
        title="Maximize Editor"
      >
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="text-muted-foreground">
          <rect x="0.5" y="0.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1" fill={!sidebarVisible && !panelVisible ? 'currentColor' : 'none'} fillOpacity="0.3" />
        </svg>
      </button>
    </div>
  );
}
