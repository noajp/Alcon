'use client';

type ActivityItem = {
  id: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
};

// Home icon
const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

// Object icon (3D cube - isometric view)
const ObjectIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M12 4 L20 8 L12 12 L4 8 Z" />
    <path d="M4 8 L4 15 L12 19 L12 12" />
    <path d="M20 8 L20 15 L12 19 L12 12" />
  </svg>
);

// Docs icon (document)
const DocsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <line x1="10" y1="9" x2="8" y2="9"/>
  </svg>
);

// Communication icon (chat bubbles)
const CommunicationIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

// Mail icon
const MailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);

// Settings icon
const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

// Help icon
const HelpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

// Alcon Logo
const AlconLogo = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
  </svg>
);

const activities: ActivityItem[] = [
  {
    id: 'home',
    icon: <HomeIcon />,
    label: 'Home',
  },
  {
    id: 'objects',
    icon: <ObjectIcon />,
    label: 'Objects',
  },
  {
    id: 'docs',
    icon: <DocsIcon />,
    label: 'Docs',
  },
  {
    id: 'communication',
    icon: <CommunicationIcon />,
    label: 'Communication',
  },
  {
    id: 'mail',
    icon: <MailIcon />,
    label: 'Mail',
  },
];

const bottomActivities: ActivityItem[] = [
  {
    id: 'settings',
    icon: <SettingsIcon />,
    label: 'Settings',
  },
  {
    id: 'help',
    icon: <HelpIcon />,
    label: 'Help',
  },
];

interface ActivityBarProps {
  activeId: string;
  onActivityChange: (id: string) => void;
}

export function ActivityBar({ activeId, onActivityChange }: ActivityBarProps) {
  return (
    <div className="flex flex-col h-full w-10 bg-[#f8f7f4] border-r border-[#e8e8e8]">
      {/* Logo */}
      <div className="flex items-center justify-center py-2">
        <div className="w-6 h-6 bg-gradient-to-br from-[#22c55e] to-[#16a34a] rounded-md flex items-center justify-center text-white">
          <AlconLogo />
        </div>
      </div>

      {/* Top Activities */}
      <div className="flex flex-col items-center gap-0.5 px-1">
        {activities.map((activity) => {
          const isActive = activeId === activity.id;

          return (
            <button
              key={activity.id}
              onClick={() => onActivityChange(activity.id)}
              className={`
                group relative w-8 h-8 flex items-center justify-center rounded-md
                transition-all duration-150 ease-out
                ${isActive
                  ? 'bg-black/[0.08] text-[#1a1a1a]'
                  : 'text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-black/[0.05]'
                }
              `}
              title={activity.label}
            >
              {activity.icon}

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
      <div className="flex flex-col items-center gap-0.5 px-1">
        {bottomActivities.map((activity) => {
          const isActive = activeId === activity.id;

          return (
            <button
              key={activity.id}
              onClick={() => onActivityChange(activity.id)}
              className={`
                group relative w-8 h-8 flex items-center justify-center rounded-md
                transition-all duration-150 ease-out
                ${isActive
                  ? 'bg-black/[0.08] text-[#1a1a1a]'
                  : 'text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-black/[0.05]'
                }
              `}
              title={activity.label}
            >
              {activity.icon}

              {/* Tooltip */}
              <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 shadow-lg">
                {activity.label}
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
              </div>
            </button>
          );
        })}
      </div>

      {/* User Avatar */}
      <div className="flex items-center justify-center py-3">
        <button
          className="group relative w-7 h-7 bg-gradient-to-br from-[#f97316] to-[#ea580c] rounded-full flex items-center justify-center text-white text-[11px] font-medium hover:ring-2 hover:ring-[#f97316]/30 transition-all"
          title="User"
        >
          U
          {/* Tooltip */}
          <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 shadow-lg">
            <div>User</div>
            <div className="text-[10px] text-gray-400">user@example.com</div>
            <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
          </div>
        </button>
      </div>
    </div>
  );
}
