'use client';

import { useState } from 'react';
import {
  TitleBar,
  ActivityBar,
  Sidebar,
  MainContent,
} from '@/components/layout';
import type { NavigationState } from '@/components/layout/Sidebar';
import { useCompanyHierarchy, useCompanyWithUnits } from '@/hooks/useSupabase';

export default function Home() {
  const [activeActivity, setActiveActivity] = useState('projects');
  const [navigation, setNavigation] = useState<NavigationState>({
    departmentId: null,
    teamId: null,
    projectId: null,
    sectionId: null,
  });

  // Use both hooks during transition - legacy for existing views, new for organization management
  const { data: company, loading, error, refetch } = useCompanyHierarchy();
  const { data: companyWithUnits, refetch: refetchUnits } = useCompanyWithUnits();

  // Combined refetch
  const handleRefresh = () => {
    refetch();
    refetchUnits();
  };

  const handleNavigate = (nav: Partial<NavigationState>) => {
    setNavigation((prev) => ({ ...prev, ...nav }));
  };

  const handleSearch = (query: string) => {
    console.log('Search:', query);
  };

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
          companyWithUnits={companyWithUnits}
          onRefresh={handleRefresh}
        />

        {/* Main Content */}
        <MainContent
          activeActivity={activeActivity}
          navigation={navigation}
          onNavigate={handleNavigate}
          company={company}
          companyWithUnits={companyWithUnits}
          onRefresh={handleRefresh}
        />
      </div>
    </div>
  );
}
