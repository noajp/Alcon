'use client';

import { useState } from 'react';

interface Tab {
  id: string;
  title: string;
  icon: string;
  type: 'task' | 'document' | 'home';
}

const sampleTabs: Tab[] = [
  { id: 'home', title: 'Home', icon: '&#127968;', type: 'home' },
  { id: 'task-1', title: 'API Design', icon: '&#128203;', type: 'task' },
];

interface MainContentProps {
  activeActivity: string;
}

export function MainContent({ activeActivity }: MainContentProps) {
  const [tabs, setTabs] = useState<Tab[]>(sampleTabs);
  const [activeTab, setActiveTab] = useState<string>('home');

  const closeTab = (tabId: string) => {
    setTabs(tabs.filter(t => t.id !== tabId));
    if (activeTab === tabId && tabs.length > 1) {
      const newActiveIndex = Math.max(0, tabs.findIndex(t => t.id === tabId) - 1);
      setActiveTab(tabs[newActiveIndex]?.id || tabs[0]?.id);
    }
  };

  const currentTab = tabs.find(t => t.id === activeTab);

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-primary)] overflow-hidden">
      {/* Tabs Bar */}
      <div className="h-[35px] flex items-end bg-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`
              h-[35px] flex items-center gap-2 px-3 cursor-pointer border-r border-[var(--border-color)]
              ${activeTab === tab.id
                ? 'bg-[var(--bg-primary)] text-[var(--text-primary)]'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }
            `}
            onClick={() => setActiveTab(tab.id)}
          >
            <span dangerouslySetInnerHTML={{ __html: tab.icon }} />
            <span className="text-[13px]">{tab.title}</span>
            <button
              className="ml-1 w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto p-6">
        {currentTab?.type === 'home' && <HomeView />}
        {currentTab?.type === 'task' && <TaskView />}
        {!currentTab && (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            No tab open
          </div>
        )}
      </div>
    </div>
  );
}

function HomeView() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-light text-[var(--text-primary)] mb-2">
          Good morning, TAKANORI
        </h1>
        <p className="text-[var(--text-secondary)]">
          Here&apos;s what needs your attention today
        </p>
      </div>

      {/* Today's Focus Card */}
      <div className="bg-[var(--bg-secondary)] rounded-lg p-5 mb-6 border border-[var(--border-color)]">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">&#127919;</span>
          <h2 className="text-lg font-medium">Today&apos;s Focus</h2>
        </div>

        <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 mb-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-medium text-[var(--text-primary)]">API Design Document</h3>
              <p className="text-sm text-[var(--text-secondary)]">Due: Today 17:00 (4h remaining)</p>
            </div>
            <span className="px-2 py-1 text-xs rounded bg-blue-900/30 text-blue-400">
              In Progress
            </span>
          </div>

          {/* Progress Bar */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
              <span>Progress</span>
              <span>80%</span>
            </div>
            <div className="h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden">
              <div className="h-full bg-[var(--accent-primary)] rounded-full" style={{ width: '80%' }} />
            </div>
          </div>

          {/* Dependencies */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--text-muted)]">Dependencies:</span>
            <span className="text-[var(--status-success)]">&#10003; Requirements</span>
            <span className="text-[var(--status-warning)]">&#9711; @Sato review</span>
          </div>
        </div>

        {/* AI Insight */}
        <div className="flex items-start gap-3 p-3 bg-[var(--accent-secondary)]/20 rounded-lg border border-[var(--accent-primary)]/30">
          <span className="text-lg">&#129302;</span>
          <div>
            <p className="text-sm text-[var(--text-primary)]">
              &quot;You&apos;re on track to complete this by 16:30. Consider taking a short break after the current section.&quot;
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-color)]">
          <div className="text-2xl font-light text-[var(--text-primary)]">3</div>
          <div className="text-sm text-[var(--text-secondary)]">Tasks due today</div>
        </div>
        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-color)]">
          <div className="text-2xl font-light text-[var(--text-primary)]">2</div>
          <div className="text-sm text-[var(--text-secondary)]">Meetings</div>
        </div>
        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-color)]">
          <div className="text-2xl font-light text-[var(--text-primary)]">5</div>
          <div className="text-sm text-[var(--text-secondary)]">AI suggestions</div>
        </div>
      </div>
    </div>
  );
}

function TaskView() {
  return (
    <div className="max-w-4xl">
      {/* Task Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">&#128203;</span>
            <h1 className="text-xl font-medium text-[var(--text-primary)]">API Design</h1>
            <span className="px-2 py-0.5 text-xs rounded bg-blue-900/30 text-blue-400">
              In Progress
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
            <span>&#128197; Due: Dec 10, 2024</span>
            <span>&#128100; @John</span>
            <span>&#128337; Est: 8h</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 text-sm bg-[var(--accent-primary)] text-white rounded hover:bg-[var(--accent-secondary)]">
            Complete
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="bg-[var(--bg-secondary)] rounded-lg p-5 mb-6 border border-[var(--border-color)]">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-3">Description</h2>
        <div className="text-[var(--text-primary)] leading-relaxed">
          <p>Design the REST API for the new task management system.</p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Define endpoints for CRUD operations</li>
            <li>Design request/response schemas</li>
            <li>Document authentication methods</li>
          </ul>
        </div>
      </div>

      {/* Subtasks */}
      <div className="bg-[var(--bg-secondary)] rounded-lg p-5 mb-6 border border-[var(--border-color)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide">Subtasks</h2>
          <button className="text-sm text-[var(--accent-primary)] hover:underline">+ Add subtask</button>
        </div>
        <div className="space-y-2">
          {[
            { name: 'Endpoint definition', hours: 3, status: 'completed' },
            { name: 'Schema design', hours: 3, status: 'in-progress' },
            { name: 'Auth method decision', hours: 2, status: 'pending' },
          ].map((subtask, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded hover:bg-[var(--bg-hover)]">
              <input
                type="checkbox"
                checked={subtask.status === 'completed'}
                readOnly
                className="w-4 h-4 rounded border-[var(--border-color)]"
              />
              <span className={`flex-1 ${subtask.status === 'completed' ? 'line-through text-[var(--text-muted)]' : ''}`}>
                {subtask.name}
              </span>
              <span className="text-sm text-[var(--text-muted)]">{subtask.hours}h</span>
            </div>
          ))}
        </div>
      </div>

      {/* AI Activity */}
      <div className="bg-[var(--bg-secondary)] rounded-lg p-5 border border-[var(--accent-primary)]/30">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">&#129302;</span>
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide">AI Activity</h2>
          <span className="px-2 py-0.5 text-xs rounded bg-yellow-900/30 text-yellow-400">
            Pending
          </span>
        </div>

        <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 mb-4">
          <p className="text-sm text-[var(--text-primary)] mb-3">
            Based on similar tasks, I suggest adding dependency tracking to &quot;Auth method decision&quot;:
          </p>
          <div className="text-sm text-[var(--text-secondary)] mb-3">
            <span className="text-[var(--status-warning)]">&#8592;</span> Blocked by: Security Team Review
          </div>
        </div>

        <div className="flex gap-2">
          <button className="px-3 py-1.5 text-sm bg-[var(--status-success)] text-white rounded hover:opacity-80">
            &#10003; Apply
          </button>
          <button className="px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded hover:bg-[var(--bg-hover)]">
            &#10007; Dismiss
          </button>
          <button className="px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded hover:bg-[var(--bg-hover)]">
            &#9998; Edit
          </button>
        </div>
      </div>
    </div>
  );
}
