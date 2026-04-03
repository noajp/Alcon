'use client';

import {
  Home,
  Cube,
  Workspace,
  UserAvatar,
  Settings,
} from '@carbon/icons-react';

type ActivityItem = {
  id: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
};

const activities: ActivityItem[] = [
  {
    id: 'home',
    icon: <Home size={20} />,
    label: 'Home',
  },
  {
    id: 'actions',
    icon: <Workspace size={20} />,
    label: 'Actions',
  },
  {
    id: 'projects',
    icon: <Cube size={20} />,
    label: 'Objects',
  },
];

const bottomActivities: ActivityItem[] = [
  {
    id: 'account',
    icon: <UserAvatar size={20} />,
    label: 'Account',
  },
  {
    id: 'settings',
    icon: <Settings size={20} />,
    label: 'Settings',
  },
];

interface ActivityBarProps {
  activeId: string;
  onActivityChange: (id: string) => void;
}

export function ActivityBar({ activeId, onActivityChange }: ActivityBarProps) {
  return (
    <aside className="flex flex-col items-center h-full w-16 bg-[#1a1a2e] py-4 gap-1">
      {/* Logo */}
      <div className="w-9 h-9 flex items-center justify-center mb-4">
        <img src="/logo.png" alt="Alcon" className="w-7 h-7 rounded-lg object-cover" />
      </div>

      {/* Top Activities */}
      {activities.map((activity) => {
        const isActive = activeId === activity.id;

        return (
          <button
            key={activity.id}
            type="button"
            onClick={() => onActivityChange(activity.id)}
            className={`
              group relative w-10 h-10 flex items-center justify-center rounded-xl cursor-pointer
              transition-all duration-200 mb-1
              ${isActive
                ? 'bg-white/15 text-white shadow-lg shadow-white/5'
                : 'text-white/40 hover:text-white/80 hover:bg-white/8'
              }
            `}
            title={activity.label}
          >
            {activity.icon}

            {/* Active indicator dot */}
            {isActive && (
              <span className="absolute -left-1 w-1 h-5 bg-white rounded-full" />
            )}

            {/* Tooltip */}
            <span className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 shadow-xl pointer-events-none border border-white/10">
              {activity.label}
            </span>
          </button>
        );
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom Activities */}
      {bottomActivities.map((activity) => {
        const isActive = activeId === activity.id;

        return (
          <button
            key={activity.id}
            type="button"
            onClick={() => onActivityChange(activity.id)}
            className={`
              group relative w-10 h-10 flex items-center justify-center rounded-xl cursor-pointer
              transition-all duration-200 mb-1
              ${isActive
                ? 'bg-white/15 text-white shadow-lg shadow-white/5'
                : 'text-white/40 hover:text-white/80 hover:bg-white/8'
              }
            `}
            title={activity.label}
          >
            {activity.icon}

            {/* Tooltip */}
            <span className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 shadow-xl pointer-events-none border border-white/10">
              {activity.label}
            </span>
          </button>
        );
      })}
    </aside>
  );
}
