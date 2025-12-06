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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    label: 'Home',
  },
  {
    id: 'projects',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    label: 'Projects',
  },
  {
    id: 'tasks',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
    label: 'Inbox',
    badge: 5,
  },
  {
    id: 'agents',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
        <circle cx="8.5" cy="14.5" r="1.5" fill="currentColor" />
        <circle cx="15.5" cy="14.5" r="1.5" fill="currentColor" />
      </svg>
    ),
    label: 'AI Agents',
  },
  {
    id: 'insights',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9" />
        <path d="M12 12l4-4" />
        <path d="M17 3l4 4" />
        <path d="M21 3v4h-4" />
      </svg>
    ),
    label: 'Insights',
  },
];

const bottomActivities: ActivityItem[] = [
  {
    id: 'team',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
    <div className="flex flex-col h-full w-[var(--activity-bar-width)] bg-[var(--activity-bar-bg)] border-r border-[var(--border-subtle)]">
      {/* Logo */}
      <div className="w-[var(--activity-bar-width)] h-14 flex items-center justify-center">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
          <span className="text-white font-bold text-sm">A</span>
        </div>
      </div>

      {/* Top Activities */}
      <div className="flex flex-col items-center gap-1 pt-2">
        {activities.map((activity) => (
          <button
            key={activity.id}
            onClick={() => onActivityChange(activity.id)}
            className={`
              group relative w-10 h-10 flex items-center justify-center rounded-xl
              transition-all duration-200 ease-out
              ${activeId === activity.id
                ? 'bg-[var(--bg-active)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }
            `}
            title={activity.label}
          >
            {activity.icon}
            {activeId === activity.id && (
              <div className="absolute left-0 w-1 h-5 bg-[var(--accent-primary)] rounded-r-full" />
            )}
            {activity.badge && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-semibold bg-[var(--accent-primary)] text-white rounded-full shadow-md">
                {activity.badge}
              </span>
            )}

            {/* Tooltip */}
            <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 shadow-lg border border-[var(--border-color)]">
              {activity.label}
            </div>
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom Activities */}
      <div className="flex flex-col items-center gap-1 pb-4">
        {bottomActivities.map((activity) => (
          <button
            key={activity.id}
            onClick={() => onActivityChange(activity.id)}
            className={`
              group relative w-10 h-10 flex items-center justify-center rounded-xl
              transition-all duration-200 ease-out
              ${activeId === activity.id
                ? 'bg-[var(--bg-active)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }
            `}
            title={activity.label}
          >
            {activity.icon}
            {activeId === activity.id && (
              <div className="absolute left-0 w-1 h-5 bg-[var(--accent-primary)] rounded-r-full" />
            )}

            {/* Tooltip */}
            <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-xs font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 shadow-lg border border-[var(--border-color)]">
              {activity.label}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
