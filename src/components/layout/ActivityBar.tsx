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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    label: 'Home',
  },
  {
    id: 'projects',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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
    <div className="flex flex-col h-full w-[var(--activity-bar-width)] bg-[var(--bg-base)] border-r border-[var(--border-default)]">
      {/* Top Activities */}
      <div className="flex flex-col items-center gap-1 pt-3 px-2">
        {activities.map((activity) => {
          const isActive = activeId === activity.id;

          return (
            <button
              key={activity.id}
              onClick={() => onActivityChange(activity.id)}
              className={`
                group relative w-10 h-10 flex items-center justify-center rounded-lg
                transition-all duration-150 ease-out
                ${isActive
                  ? 'bg-gray-100 text-gray-900 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }
              `}
              title={activity.label}
            >
              {activity.icon}

              {/* Active indicator */}
              {isActive && (
                <div className="absolute left-0 w-[3px] h-5 rounded-r-full bg-gray-900" />
              )}

              {/* Badge */}
              {activity.badge && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-semibold rounded-full bg-gray-900 text-white shadow-sm">
                  {activity.badge}
                </span>
              )}

              {/* Tooltip */}
              <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 shadow-lg">
                {activity.label}
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom Activities */}
      <div className="flex flex-col items-center gap-1 pb-3 px-2">
        {bottomActivities.map((activity) => {
          const isActive = activeId === activity.id;

          return (
            <button
              key={activity.id}
              onClick={() => onActivityChange(activity.id)}
              className={`
                group relative w-10 h-10 flex items-center justify-center rounded-lg
                transition-all duration-150 ease-out
                ${isActive
                  ? 'bg-gray-100 text-gray-900 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }
              `}
              title={activity.label}
            >
              {activity.icon}

              {isActive && (
                <div className="absolute left-0 w-[3px] h-5 rounded-r-full bg-gray-900" />
              )}

              {/* Tooltip */}
              <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 shadow-lg">
                {activity.label}
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
