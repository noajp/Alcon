'use client';

import { useState } from 'react';
import {
  ActivityBar,
  Sidebar,
  MainContent,
  AIPanel,
} from '@/components/layout';
import type { NavigationState } from '@/components/layout/Sidebar';

export default function Home() {
  const [activeActivity, setActiveActivity] = useState('projects');
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [navigation, setNavigation] = useState<NavigationState>({
    departmentId: 'dept-1',
    teamId: 'team-dev-1',
    projectId: 'project-dev-1',
    sectionId: null,
  });

  const handleNavigate = (nav: Partial<NavigationState>) => {
    setNavigation((prev) => ({ ...prev, ...nav }));
  };

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--bg-primary)]">
      {/* Activity Bar - VSCode style fixed left bar */}
      <ActivityBar
        activeId={activeActivity}
        onActivityChange={setActiveActivity}
      />

      {/* Sidebar - Changes based on activity */}
      <Sidebar
        activeActivity={activeActivity}
        navigation={navigation}
        onNavigate={handleNavigate}
      />

      {/* Main Content */}
      <MainContent
        activeActivity={activeActivity}
        navigation={navigation}
        onNavigate={handleNavigate}
      />

      {/* AI Panel */}
      <AIPanel
        isOpen={isAIPanelOpen}
        onToggle={() => setIsAIPanelOpen(false)}
      />

      {/* Floating AI Button */}
      <button
        onClick={() => setIsAIPanelOpen(!isAIPanelOpen)}
        className={`fixed bottom-6 right-6 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-xl transition-all ${
          isAIPanelOpen
            ? 'bg-[var(--accent-primary)] text-white'
            : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)]'
        }`}
        title="Toggle AI Assistant"
      >
        🤖
      </button>
    </div>
  );
}
