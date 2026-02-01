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
    <aside className="flex flex-col items-center h-full w-14 bg-background border-r border-border py-3">
      {/* Top Activities */}
      {activities.map((activity) => {
        const isActive = activeId === activity.id;

        return (
          <button
            key={activity.id}
            type="button"
            onClick={() => onActivityChange(activity.id)}
            className={`
              group relative w-10 h-10 flex items-center justify-center rounded-lg cursor-pointer
              transition-all duration-150 mb-1
              ${isActive
                ? 'bg-sidebar-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
              }
            `}
            title={activity.label}
          >
            {activity.icon}

            {/* Tooltip */}
            <span className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 shadow-lg pointer-events-none border border-border">
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
              group relative w-10 h-10 flex items-center justify-center rounded-lg cursor-pointer
              transition-all duration-150 mb-1
              ${isActive
                ? 'bg-sidebar-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
              }
            `}
            title={activity.label}
          >
            {activity.icon}

            {/* Tooltip */}
            <span className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 shadow-lg pointer-events-none border border-border">
              {activity.label}
            </span>
          </button>
        );
      })}
    </aside>
  );
}
