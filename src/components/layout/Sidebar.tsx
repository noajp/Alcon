'use client';

import { useState } from 'react';

// Sample tree data
const sampleProjects = [
  {
    id: 'proj-1',
    name: 'Website Redesign',
    status: 'on-track',
    sections: [
      {
        id: 'sec-1',
        name: 'Design Phase',
        tasks: [
          { id: 'task-1', name: 'Create wireframes', assignee: 'John', dueDate: '12/5', status: 'completed' },
          { id: 'task-2', name: 'Design review', assignee: 'Sarah', dueDate: '12/8', status: 'in-progress' },
          { id: 'task-3', name: 'Finalize mockups', assignee: null, dueDate: '12/10', status: 'pending' },
        ],
      },
      {
        id: 'sec-2',
        name: 'Development Phase',
        tasks: [
          { id: 'task-4', name: 'Setup React', assignee: 'Mike', dueDate: '12/12', status: 'blocked' },
          { id: 'task-5', name: 'API Integration', assignee: null, dueDate: '12/15', status: 'pending' },
        ],
      },
    ],
  },
  {
    id: 'proj-2',
    name: 'Mobile App',
    status: 'at-risk',
    sections: [],
  },
];

interface TreeItemProps {
  icon: React.ReactNode;
  label: string;
  suffix?: React.ReactNode;
  depth?: number;
  isExpanded?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  children?: React.ReactNode;
}

function TreeItem({ icon, label, suffix, depth = 0, isExpanded, onToggle, onClick, children }: TreeItemProps) {
  const hasChildren = !!children;

  return (
    <div>
      <div
        className="flex items-center h-[22px] px-2 cursor-pointer hover:bg-[var(--bg-hover)] group"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          if (hasChildren && onToggle) onToggle();
          if (onClick) onClick();
        }}
      >
        {hasChildren && (
          <span className="w-4 h-4 flex items-center justify-center mr-1 text-[var(--text-secondary)]">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="currentColor"
              className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            >
              <path d="M4 2l4 4-4 4z" />
            </svg>
          </span>
        )}
        {!hasChildren && <span className="w-4 h-4 mr-1" />}
        <span className="mr-1.5 flex-shrink-0">{icon}</span>
        <span className="truncate flex-1 text-[13px]">{label}</span>
        {suffix && <span className="ml-2 text-[var(--text-muted)] text-xs">{suffix}</span>}
      </div>
      {isExpanded && children && (
        <div>{children}</div>
      )}
    </div>
  );
}

function TaskIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <span className="text-[var(--status-success)]">&#10003;</span>;
    case 'in-progress':
      return <span className="text-[var(--accent-primary)]">&#9711;</span>;
    case 'blocked':
      return <span className="text-[var(--status-error)]">&#9888;</span>;
    default:
      return <span className="text-[var(--text-muted)]">&#9675;</span>;
  }
}

interface SidebarProps {
  activeActivity: string;
}

export function Sidebar({ activeActivity }: SidebarProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(['proj-1', 'sec-1']));

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="h-full w-[var(--sidebar-width)] bg-[var(--bg-secondary)] border-r border-[var(--border-color)] flex flex-col">
      {/* Sidebar Header */}
      <div className="h-9 flex items-center px-4 text-[11px] uppercase tracking-wide text-[var(--text-secondary)] font-semibold border-b border-[var(--border-color)]">
        {activeActivity === 'home' && 'Home'}
        {activeActivity === 'work' && 'Work Graph'}
        {activeActivity === 'agents' && 'AI Agents'}
        {activeActivity === 'version' && 'Version Control'}
        {activeActivity === 'team' && 'Team'}
        {activeActivity === 'settings' && 'Settings'}
      </div>

      {/* Sidebar Content */}
      <div className="flex-1 overflow-y-auto py-2">
        {activeActivity === 'work' && (
          <>
            {/* Projects Section */}
            <div className="mb-2">
              <div className="flex items-center justify-between px-4 py-1 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                <span>Projects</span>
                <button className="hover:text-[var(--text-primary)]">+</button>
              </div>
              {sampleProjects.map((project) => (
                <TreeItem
                  key={project.id}
                  icon={<span>&#128194;</span>}
                  label={project.name}
                  suffix={
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      project.status === 'on-track' ? 'bg-green-900/30 text-green-400' :
                      project.status === 'at-risk' ? 'bg-red-900/30 text-red-400' :
                      'bg-gray-700 text-gray-400'
                    }`}>
                      {project.status}
                    </span>
                  }
                  depth={0}
                  isExpanded={expandedItems.has(project.id)}
                  onToggle={() => toggleExpand(project.id)}
                >
                  {project.sections.map((section) => (
                    <TreeItem
                      key={section.id}
                      icon={<span className="text-[var(--text-muted)]">&#128196;</span>}
                      label={section.name}
                      depth={1}
                      isExpanded={expandedItems.has(section.id)}
                      onToggle={() => toggleExpand(section.id)}
                    >
                      {section.tasks.map((task) => (
                        <TreeItem
                          key={task.id}
                          icon={<TaskIcon status={task.status} />}
                          label={task.name}
                          suffix={task.dueDate}
                          depth={2}
                        />
                      ))}
                    </TreeItem>
                  ))}
                </TreeItem>
              ))}
            </div>
          </>
        )}

        {activeActivity === 'home' && (
          <div className="px-4 py-2">
            <div className="text-[var(--text-secondary)] text-sm">
              Welcome back! Select your focus for today.
            </div>
          </div>
        )}

        {activeActivity === 'agents' && (
          <div className="px-4 py-2">
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)] mb-2">
              Active Agents
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 rounded bg-[var(--bg-tertiary)]">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm">Task Analyzer</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-[var(--bg-tertiary)]">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm">Schedule Optimizer</span>
              </div>
            </div>
          </div>
        )}

        {activeActivity === 'version' && (
          <div className="px-4 py-2">
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)] mb-2">
              Recent Changes
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2 p-2 rounded hover:bg-[var(--bg-hover)] cursor-pointer">
                <span className="text-blue-400">&#9679;</span>
                <span>v24 - Task breakdown (AI)</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded hover:bg-[var(--bg-hover)] cursor-pointer">
                <span className="text-green-400">&#9679;</span>
                <span>v23 - Document edit</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
