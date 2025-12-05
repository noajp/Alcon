'use client';

import { useState } from 'react';
import {
  ActivityBar,
  Sidebar,
  MainContent,
  AIPanel,
  StatusBar,
  TitleBar,
} from '@/components/layout';

export default function Home() {
  const [activeActivity, setActiveActivity] = useState('home');
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(true);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Title Bar */}
      <TitleBar
        onToggleAI={() => setIsAIPanelOpen(!isAIPanelOpen)}
        isAIPanelOpen={isAIPanelOpen}
      />

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar */}
        <ActivityBar
          activeId={activeActivity}
          onActivityChange={setActiveActivity}
        />

        {/* Sidebar */}
        <Sidebar activeActivity={activeActivity} />

        {/* Main Content */}
        <MainContent activeActivity={activeActivity} />

        {/* AI Panel */}
        <AIPanel
          isOpen={isAIPanelOpen}
          onToggle={() => setIsAIPanelOpen(false)}
        />
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}
