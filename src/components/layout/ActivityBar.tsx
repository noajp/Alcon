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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    label: 'Home',
  },
  {
    id: 'projects',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    label: 'Projects',
  },
];

const bottomActivities: ActivityItem[] = [];

interface ActivityBarProps {
  activeId: string;
  onActivityChange: (id: string) => void;
}

export function ActivityBar({ activeId, onActivityChange }: ActivityBarProps) {
  return (
    <div className="flex flex-col h-full w-[var(--activity-bar-width)] bg-[var(--bg-surface)] border-r border-[var(--border-default)]">
      {/* Top Activities */}
      <div className="flex flex-col items-center gap-0.5 pt-2">
        {activities.map((activity) => {
          const isActive = activeId === activity.id;

          return (
            <button
              key={activity.id}
              onClick={() => onActivityChange(activity.id)}
              className={`
                group relative w-10 h-10 flex items-center justify-center rounded-md
                transition-colors
                ${isActive
                  ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]'
                }
              `}
              title={activity.label}
            >
              {activity.icon}

              {/* Active indicator */}
              {isActive && (
                <div className="absolute left-0 w-0.5 h-5 rounded-r-full bg-[var(--text-primary)]" />
              )}

              {/* Badge */}
              {activity.badge && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-medium rounded-full bg-[var(--text-primary)] text-[var(--bg-base)]">
                  {activity.badge}
                </span>
              )}

              {/* Tooltip */}
              <div className="absolute left-full ml-2 px-2 py-1 bg-[var(--bg-overlay)] text-[var(--text-primary)] text-xs rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity whitespace-nowrap z-50 border border-[var(--border-default)]">
                {activity.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom Activities */}
      <div className="flex flex-col items-center gap-0.5 pb-3">
        {bottomActivities.map((activity) => {
          const isActive = activeId === activity.id;

          return (
            <button
              key={activity.id}
              onClick={() => onActivityChange(activity.id)}
              className={`
                group relative w-10 h-10 flex items-center justify-center rounded-md
                transition-colors
                ${isActive
                  ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]'
                }
              `}
              title={activity.label}
            >
              {activity.icon}

              {isActive && (
                <div className="absolute left-0 w-0.5 h-5 rounded-r-full bg-[var(--text-primary)]" />
              )}

              {/* Tooltip */}
              <div className="absolute left-full ml-2 px-2 py-1 bg-[var(--bg-overlay)] text-[var(--text-primary)] text-xs rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity whitespace-nowrap z-50 border border-[var(--border-default)]">
                {activity.label}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
