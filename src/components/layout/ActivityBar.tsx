'use client';

type ActivityItem = {
  id: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
};

const activities: ActivityItem[] = [
  {
    id: 'home',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    label: 'Home',
  },
  {
    id: 'projects',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    label: 'Projects',
  },
  {
    id: 'tasks',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    label: 'My Tasks',
    badge: 3,
  },
  {
    id: 'inbox',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
    label: 'Inbox',
    badge: 5,
  },
  {
    id: 'agents',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <circle cx="9" cy="10" r="1" fill="currentColor" />
        <circle cx="15" cy="10" r="1" fill="currentColor" />
      </svg>
    ),
    label: 'AI Agents',
  },
  {
    id: 'version',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="4" />
        <line x1="1.05" y1="12" x2="7" y2="12" />
        <line x1="17.01" y1="12" x2="22.96" y2="12" />
        <line x1="12" y1="1" x2="12" y2="8" />
        <line x1="12" y1="16" x2="12" y2="23" />
      </svg>
    ),
    label: 'Version',
  },
];

const bottomActivities: ActivityItem[] = [
  {
    id: 'team',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    label: 'Team',
  },
  {
    id: 'settings',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    label: 'Settings',
  },
];

interface ActivityBarProps {
  activeId: string;
  onActivityChange: (id: string) => void;
}

export function ActivityBar({ activeId, onActivityChange }: ActivityBarProps) {
  return (
    <div className="flex flex-col h-full w-12 bg-[var(--activity-bar-bg)] border-r border-[var(--border-color)]">
      {/* Logo */}
      <div className="w-12 h-12 flex items-center justify-center border-b border-[var(--border-color)]">
        <span className="text-xl font-bold text-[var(--accent-primary)]">◆</span>
      </div>

      {/* Top Activities */}
      <div className="flex flex-col items-center pt-1">
        {activities.map((activity) => (
          <button
            key={activity.id}
            onClick={() => onActivityChange(activity.id)}
            className={`
              w-12 h-12 flex items-center justify-center
              text-[var(--text-secondary)] hover:text-[var(--text-primary)]
              transition-colors relative
              ${activeId === activity.id ? 'text-[var(--text-primary)]' : ''}
            `}
            title={activity.label}
          >
            {activity.icon}
            {activeId === activity.id && (
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--accent-primary)]" />
            )}
            {activity.badge && (
              <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-medium bg-[var(--accent-primary)] text-white rounded-full">
                {activity.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom Activities */}
      <div className="flex flex-col items-center pb-2">
        {bottomActivities.map((activity) => (
          <button
            key={activity.id}
            onClick={() => onActivityChange(activity.id)}
            className={`
              w-12 h-12 flex items-center justify-center
              text-[var(--text-secondary)] hover:text-[var(--text-primary)]
              transition-colors relative
              ${activeId === activity.id ? 'text-[var(--text-primary)]' : ''}
            `}
            title={activity.label}
          >
            {activity.icon}
            {activeId === activity.id && (
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--accent-primary)]" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
