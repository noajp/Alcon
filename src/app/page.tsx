'use client';

import { useState } from 'react';
import {
  ActivityBar,
  Sidebar,
  MainContent,
  AIPanel,
} from '@/components/layout';
import type { NavigationState } from '@/components/layout/Sidebar';
import { useCompanyHierarchy } from '@/hooks/useSupabase';

export default function Home() {
  const [activeActivity, setActiveActivity] = useState('projects');
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [navigation, setNavigation] = useState<NavigationState>({
    departmentId: null,
    teamId: null,
    projectId: null,
    sectionId: null,
  });

  // Supabaseからデータを取得
  const { data: company, loading, error, refetch } = useCompanyHierarchy();

  const handleNavigate = (nav: Partial<NavigationState>) => {
    setNavigation((prev) => ({ ...prev, ...nav }));
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-[var(--text-muted)]">Loading...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <div className="text-[var(--status-error)] text-xl mb-2">Error</div>
          <div className="text-[var(--text-muted)]">{error.message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--bg-primary)]">
      {/* Activity Bar */}
      <ActivityBar
        activeId={activeActivity}
        onActivityChange={setActiveActivity}
      />

      {/* Sidebar */}
      <Sidebar
        activeActivity={activeActivity}
        navigation={navigation}
        onNavigate={handleNavigate}
        company={company}
      />

      {/* Main Content */}
      <MainContent
        activeActivity={activeActivity}
        navigation={navigation}
        onNavigate={handleNavigate}
        company={company}
        onRefresh={refetch}
      />

      {/* AI Panel */}
      <AIPanel
        isOpen={isAIPanelOpen}
        onToggle={() => setIsAIPanelOpen(false)}
      />

      {/* Floating AI Button */}
      <button
        onClick={() => setIsAIPanelOpen(!isAIPanelOpen)}
        className={`
          fixed bottom-6 right-6 w-14 h-14 rounded-2xl shadow-lg
          flex items-center justify-center text-xl transition-all duration-300
          ${isAIPanelOpen
            ? 'bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-[0_0_30px_rgba(59,130,246,0.5)]'
            : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)] hover:border-[var(--accent-primary)] hover:shadow-[0_0_20px_rgba(59,130,246,0.3)]'
          }
        `}
        title="AI Assistant"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
          <circle cx="8.5" cy="14.5" r="1.5" fill="currentColor" />
          <circle cx="15.5" cy="14.5" r="1.5" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
